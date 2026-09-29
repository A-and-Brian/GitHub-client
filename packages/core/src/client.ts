import * as reviews from "./actions/reviews"
import * as workflows from "./actions/workflows"
import { checkToken, TokenAuthProvider, type TokenCheck } from "./auth/auth"
import { type Collections, createCollections, type SyncedCollection } from "./collections"
import { Contributions } from "./contributions"
import type { Group, MergeMethod, PullRequest, PullRequestDetail } from "./domain/types"
import { prKey } from "./domain/types"
import { GraphQLClient } from "./github/graphql"
import { RestClient } from "./github/rest"
import {
  deriveInboxPulls,
  ensureInboxOrder as ensureInboxOrderState,
  type InboxMoveTarget,
  type InboxMutationResult,
  type InboxPreference,
  type InboxPull,
  type InboxUndoToken,
  inboxPreferenceKey,
  moveInboxPull as moveInboxPullState,
  pinInboxPull as pinInboxPullState,
  reconcileInboxState as reconcileInboxPreferences,
  restoreInboxPreference as restoreInboxPreferenceRow,
  restoreInboxPull as restoreInboxPullState,
  setInboxSnoozed as setInboxSnoozedState,
  settleInboxPull as settleInboxPullState,
  unpinInboxPull as unpinInboxPullState,
  wakeInboxPull as wakeInboxPullState,
} from "./inbox"
import type { Platform } from "./platform"
import { RepositoryCache } from "./repository-cache"
import {
  fetchPendingPullRequestApprovals as fetchPendingApprovals,
  syncRunJobs,
  syncWorkflowRuns,
  syncWorkflows,
  toWorkflowRun,
} from "./sync/actions"
import { syncGroups } from "./sync/groups"
import { Poller } from "./sync/poller"
import { fetchPullDetail, fetchPullFiles } from "./sync/pull-detail"
import {
  applyGroupPulls,
  fetchGroupPulls,
  preserveTerminalPulls,
  updatePullLifecycleCopies,
  verifyMissingPulls,
} from "./sync/pulls"

const ACTIVE_MS = 15_000
const IDLE_MS = 2 * 60_000
const GROUPS_IDLE_MS = 15 * 60_000

function observationTime(value?: string): number {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

export const jobKeys = {
  groups: "groups",
  groupPulls: (groupId: string) => `pulls:${groupId}`,
  pull: (repo: string, number: number) => `pull:${prKey(repo, number)}`,
  runs: (repo: string) => `runs:${repo}`,
  runJobs: (runId: number) => `run-jobs:${runId}`,
  workflows: (repo: string) => `workflows:${repo}`,
}

interface InboxUndoSnapshot {
  token: InboxUndoToken
  before: Array<{ pullId: string; preference?: InboxPreference }>
  after: Array<{ pullId: string; preference?: InboxPreference }>
}

const INBOX_UNDO_TTL_MS = 5_000
const MAX_INBOX_UNDO_TOKENS = 100

/**
 * The GitHub client: auth, API clients, collections, sync scheduling, and
 * write actions. One instance per app.
 */
export class GitHubClient {
  readonly auth: TokenAuthProvider
  readonly rest: RestClient
  readonly graphql: GraphQLClient
  readonly contributions: Contributions
  readonly poller: Poller
  readonly collections: Collections
  readonly repositoryCache: RepositoryCache
  readonly platform: Platform
  private syncing = false
  private authGeneration = 0
  private activeInboxAccount: string | null = null
  private inboxQueue: Promise<unknown> = Promise.resolve()
  private nextInboxUndoId = 0
  private inboxUndoTokens = new Map<number, InboxUndoSnapshot>()
  private readonly confirmedPullStates = new Map<
    string,
    { state: "OPEN" | "CLOSED" | "MERGED"; observedAt: string }
  >()
  private inboxLifecycleRevision = 0
  private readonly inboxLifecycleListeners = new Set<() => void>()

  constructor(platform: Platform) {
    this.platform = platform
    this.auth = new TokenAuthProvider(platform)
    this.rest = new RestClient({ fetch: platform.fetch, getToken: () => this.auth.getToken() })
    this.graphql = new GraphQLClient(this.rest)
    this.contributions = new Contributions(this.graphql)
    this.poller = new Poller(this.rest.rateLimits)
    this.collections = createCollections(platform.persistence)
    this.repositoryCache = new RepositoryCache(
      this.collections.repositoryResources,
      Boolean(platform.persistence),
      this.rest.rateLimits,
    )
  }

  /** Validates `token` and stores it. Throws when GitHub rejects it. */
  async signIn(token: string): Promise<TokenCheck> {
    const probe = new RestClient({ fetch: this.platform.fetch, getToken: () => token })
    const check = await checkToken(probe)
    await this.enqueueInbox(async () => {
      this.authGeneration++
      await this.auth.signIn(token)
      this.inboxUndoTokens.clear()
      this.confirmedPullStates.clear()
      this.activeInboxAccount = null
      this.notifyInboxLifecycle()
      this.contributions.reset()
    })
    return check
  }

  /** Forgets the token and deletes cached data, which belongs to the signed-out account. */
  async signOut(): Promise<void> {
    await this.enqueueInbox(async () => {
      this.authGeneration++
      this.poller.stop()
      await this.repositoryCache.clearAll()
      await this.auth.signOut()
      this.contributions.reset()
      this.inboxUndoTokens.clear()
      this.confirmedPullStates.clear()
      this.notifyInboxLifecycle()
      this.activeInboxAccount = null
      await this.collections.database.clear()
    })
  }

  setInboxSnoozed(
    accountLogin: string,
    pull: PullRequest,
    until: string,
  ): Promise<InboxMutationResult> {
    return this.mutateInbox(accountLogin, pull, () =>
      setInboxSnoozedState(this.collections.inboxPreferences, accountLogin, pull, until),
    )
  }

  settleInboxPull(accountLogin: string, pull: PullRequest): Promise<InboxMutationResult> {
    return this.mutateInbox(accountLogin, pull, () =>
      settleInboxPullState(this.collections.inboxPreferences, accountLogin, pull),
    )
  }

  restoreInboxPull(accountLogin: string, pull: PullRequest): Promise<InboxMutationResult> {
    return this.mutateInbox(accountLogin, pull, () =>
      restoreInboxPullState(this.collections.inboxPreferences, accountLogin, pull),
    )
  }

  pinInboxPull(accountLogin: string, pull: PullRequest): Promise<InboxMutationResult> {
    return this.mutateInbox(accountLogin, pull, () =>
      pinInboxPullState(this.collections.inboxPreferences, accountLogin, pull),
    )
  }

  unpinInboxPull(accountLogin: string, pull: PullRequest): Promise<InboxMutationResult> {
    return this.mutateInbox(accountLogin, pull, () =>
      unpinInboxPullState(this.collections.inboxPreferences, accountLogin, pull),
    )
  }

  wakeInboxPull(accountLogin: string, pull: PullRequest): Promise<InboxMutationResult> {
    return this.mutateInbox(accountLogin, pull, () =>
      wakeInboxPullState(this.collections.inboxPreferences, accountLogin, pull),
    )
  }

  moveInboxPull(
    accountLogin: string,
    pull: PullRequest,
    target: InboxMoveTarget,
  ): Promise<InboxMutationResult> {
    return this.mutateInbox(accountLogin, pull, () =>
      moveInboxPullState(this.collections.inboxPreferences, accountLogin, pull, target.section, {
        beforePullId: target.beforePullId,
        afterPullId: target.afterPullId,
      }),
    )
  }

  ensureInboxOrder(accountLogin: string, orderedEntries: readonly InboxPull[]): Promise<void> {
    return this.enqueueInbox(async () => {
      await this.preloadInboxCollections()
      const before = this.accountPreferenceMap(accountLogin)
      await ensureInboxOrderState(this.collections.inboxPreferences, accountLogin, orderedEntries)
      this.invalidateUndoForChangedRows(accountLogin, before)
    })
  }

  /** Restores one recent inbox action only if its captured rows have not changed. */
  undoInboxMutation(token: InboxUndoToken, now?: number): Promise<boolean> {
    return this.enqueueInbox(async () => {
      await this.preloadInboxCollections()
      const currentTime = now ?? Date.now()
      this.pruneInboxUndoTokens(currentTime)
      const current = this.inboxUndoTokens.get(token.id)
      const account = token.accountLogin.trim().toLowerCase()
      if (
        !current ||
        current.token.expiresAt !== token.expiresAt ||
        current.token.accountLogin !== account ||
        currentTime > current.token.expiresAt
      ) {
        return false
      }
      for (const snapshot of current.after) {
        if (
          !samePreference(
            this.collections.inboxPreferences.collection.get(
              inboxPreferenceKey(account, snapshot.pullId),
            ),
            snapshot.preference,
          )
        ) {
          this.inboxUndoTokens.delete(token.id)
          return false
        }
      }
      const restores = current.before.flatMap((snapshot) =>
        snapshot.preference ? [snapshot.preference] : [],
      )
      const affectedKeys = new Set(
        current.before.map((snapshot) => inboxPreferenceKey(account, snapshot.pullId)),
      )
      await this.collections.inboxPreferences.replace(restores, (row) => affectedKeys.has(row.key))
      this.inboxUndoTokens.delete(token.id)
      this.invalidateUndoTokens(account, new Set(current.after.map(({ pullId }) => pullId)))
      return true
    })
  }

  restoreInboxPreference(accountLogin: string, pullId: string, previous?: InboxPreference) {
    return this.enqueueInbox(async () => {
      await this.preloadInboxCollections()
      await restoreInboxPreferenceRow(
        this.collections.inboxPreferences,
        accountLogin,
        pullId,
        previous,
      )
      this.invalidateUndoTokens(accountLogin, new Set([pullId]))
    })
  }

  reconcileInboxState(
    accountLogin: string,
    pulls: readonly PullRequest[],
    now = Date.now(),
    groups?: readonly Group[],
  ) {
    this.activeInboxAccount = accountLogin.trim().toLowerCase()
    return this.enqueueInbox(async () => {
      await this.preloadInboxCollections()
      const before = this.accountPreferenceMap(accountLogin)
      const currentGroups = groups ?? [...this.collections.groups.collection.values()]
      const currentPulls = [...pulls]
      await reconcileInboxPreferences(
        this.collections.inboxPreferences,
        accountLogin,
        currentPulls,
        now,
        currentGroups,
      )
      this.invalidateUndoForChangedRows(accountLogin, before)
    })
  }

  getInboxLifecycleRevision = (): number => {
    return this.inboxLifecycleRevision
  }

  subscribeInboxLifecycle = (listener: () => void): (() => void) => {
    this.inboxLifecycleListeners.add(listener)
    return () => this.inboxLifecycleListeners.delete(listener)
  }

  applyConfirmedInboxLifecycles(pulls: readonly PullRequest[]): PullRequest[] {
    return pulls.map((pull) => {
      const confirmed = this.confirmedPullStates.get(pull.id)
      if (!confirmed) return pull
      if (confirmed.state === "MERGED") {
        return { ...pull, state: "MERGED", stateObservedAt: confirmed.observedAt }
      }
      const rowObservedAt = pull.stateObservedAt
        ? Date.parse(pull.stateObservedAt)
        : Number.NEGATIVE_INFINITY
      if (confirmed.state === "OPEN") {
        if (pull.state === "MERGED" || rowObservedAt > Date.parse(confirmed.observedAt)) return pull
        return { ...pull, state: "OPEN", stateObservedAt: confirmed.observedAt }
      }
      if (pull.state === "MERGED") return pull
      return rowObservedAt > Date.parse(confirmed.observedAt)
        ? pull
        : { ...pull, state: "CLOSED", stateObservedAt: confirmed.observedAt }
    })
  }

  private notifyInboxLifecycle(): void {
    this.inboxLifecycleRevision++
    for (const listener of this.inboxLifecycleListeners) listener()
  }

  private async observePullLifecycle(
    detail: PullRequestDetail,
    observedAt: string,
    accountLogin?: string,
  ): Promise<boolean> {
    const copies = [...this.collections.pulls.collection.values()].filter(
      (row) => row.id === detail.id,
    )
    const preferences = [...this.collections.inboxPreferences.collection.values()].filter(
      (row) =>
        row.pullId === detail.id &&
        (!accountLogin || row.accountLogin === accountLogin.toLowerCase()),
    )
    const overlay = this.confirmedPullStates.get(detail.id)
    if (
      detail.state !== "MERGED" &&
      (overlay?.state === "MERGED" ||
        copies.some((row) => row.state === "MERGED") ||
        preferences.some((row) => row.terminalState === "MERGED"))
    )
      return false
    const latestObservedAt = Math.max(
      ...copies.map((row) => Date.parse(row.stateObservedAt ?? "")).filter(Number.isFinite),
      ...preferences
        .filter((row) => row.terminalState)
        .map((row) => Date.parse(row.terminalObservedAt ?? row.changedAt))
        .filter(Number.isFinite),
      ...(overlay ? [Date.parse(overlay.observedAt)] : []),
    )
    if (detail.state !== "MERGED" && Date.parse(observedAt) < latestObservedAt) return false
    if (detail.state === "MERGED") {
      const mergedAt = new Date(Math.max(Date.parse(observedAt), latestObservedAt)).toISOString()
      this.confirmedPullStates.set(detail.id, { state: "MERGED", observedAt: mergedAt })
      this.notifyInboxLifecycle()
      await updatePullLifecycleCopies(this.collections.pulls, detail.id, "MERGED", mergedAt)
    } else if (detail.state === "CLOSED") {
      this.confirmedPullStates.set(detail.id, { state: "CLOSED", observedAt })
      this.notifyInboxLifecycle()
      await updatePullLifecycleCopies(this.collections.pulls, detail.id, "CLOSED", observedAt)
    } else {
      const hasClosedObservation =
        copies.some((row) => row.state === "CLOSED") ||
        preferences.some((row) => row.terminalState === "CLOSED") ||
        this.confirmedPullStates.get(detail.id)?.state === "CLOSED"
      const priorClosedTimes = [
        ...copies
          .filter((row) => row.state === "CLOSED")
          .map((row) => Date.parse(row.stateObservedAt ?? "")),
        ...preferences
          .filter((row) => row.terminalState === "CLOSED")
          .map((row) => Date.parse(row.terminalObservedAt ?? row.changedAt)),
        ...(this.confirmedPullStates.get(detail.id)?.state === "CLOSED"
          ? [Date.parse(this.confirmedPullStates.get(detail.id)!.observedAt)]
          : []),
      ].filter(Number.isFinite)
      const priorClosedAt =
        priorClosedTimes.length > 0 ? Math.max(...priorClosedTimes) : Number.NEGATIVE_INFINITY
      if (hasClosedObservation && Date.parse(observedAt) <= priorClosedAt) return false
      if (hasClosedObservation && Date.parse(observedAt) > priorClosedAt) {
        this.confirmedPullStates.set(detail.id, { state: "OPEN", observedAt })
        this.notifyInboxLifecycle()
        await updatePullLifecycleCopies(this.collections.pulls, detail.id, "OPEN", observedAt)
      }
    }
    if (accountLogin) {
      await reconcileInboxPreferences(
        this.collections.inboxPreferences,
        accountLogin,
        [...this.collections.pulls.collection.values()],
        Date.now(),
        [...this.collections.groups.collection.values()],
      )
    }
    return true
  }

  syncRepositoryInbox(
    accountLogin: string,
    repo: string,
    rows: readonly PullRequest[],
    options: { complete: boolean; observedAt?: string },
  ): Promise<void> {
    this.activeInboxAccount = accountLogin.trim().toLowerCase()
    const authGeneration = this.authGeneration
    const groupId = `repo:${repo}`
    const observedAt =
      options.observedAt ??
      rows
        .map((row) => row.syncedAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ??
      new Date().toISOString()
    return (async () => {
      if (!this.auth.getToken()) return
      await this.collections.pulls.collection.preload()
      if (authGeneration !== this.authGeneration) return
      const priorRows = [...this.collections.pulls.collection.values()].filter(
        (row) => row.groupId === groupId,
      )
      const verified = options.complete
        ? await verifyMissingPulls(this.graphql, priorRows, rows, groupId)
        : undefined
      await this.enqueueInbox(async () => {
        if (authGeneration !== this.authGeneration || !this.auth.getToken()) return
        await this.collections.inboxPreferences.collection.preload()
        const currentPriorRows = [...this.collections.pulls.collection.values()].filter(
          (row) => row.groupId === groupId,
        )
        const normalized: PullRequest[] = rows.map((row) => {
          const existing = [...this.collections.pulls.collection.values()].find(
            (copy) => copy.id === row.id,
          )
          return {
            ...existing,
            ...row,
            key: `${groupId}:${row.id}`,
            groupId,
            reviewDecision: row.reviewDecision ?? existing?.reviewDecision ?? null,
            checkState: row.checkState ?? existing?.checkState ?? null,
            labels: row.labels.length > 0 ? row.labels : (existing?.labels ?? row.labels),
            additions: row.additions || existing?.additions || 0,
            deletions: row.deletions || existing?.deletions || 0,
            comments: row.comments || existing?.comments || 0,
            checkSnapshotComplete: existing ? existing.checkSnapshotComplete !== false : false,
            state: "OPEN" as const,
          }
        })
        for (const row of normalized) {
          const overlay = this.confirmedPullStates.get(row.id)
          const observations = [
            ...[...this.collections.pulls.collection.values()]
              .filter((copy) => copy.id === row.id && copy.state)
              .map((copy) => ({ state: copy.state!, observedAt: copy.stateObservedAt })),
            ...(overlay ? [{ state: overlay.state, observedAt: overlay.observedAt }] : []),
          ]
          const merged = observations.find((observation) => observation.state === "MERGED")
          if (merged) {
            row.state = "MERGED"
            row.stateObservedAt = merged.observedAt
            continue
          }
          const latest = observations.sort((a, b) => {
            const freshness = observationTime(b.observedAt) - observationTime(a.observedAt)
            return !Number.isNaN(freshness) && freshness !== 0
              ? freshness
              : Number(b.state === "CLOSED") - Number(a.state === "CLOSED")
          })[0]
          if (latest && observationTime(latest.observedAt) >= Date.parse(observedAt)) {
            row.state = latest.state
            row.stateObservedAt = latest.observedAt
            continue
          }
          row.state = "OPEN"
          row.stateObservedAt = observedAt
          if (latest?.state === "CLOSED") {
            this.confirmedPullStates.set(row.id, { state: "OPEN", observedAt })
            this.notifyInboxLifecycle()
            await updatePullLifecycleCopies(this.collections.pulls, row.id, "OPEN", observedAt)
          }
        }
        let nextRows = normalized
        if (options.complete) {
          nextRows = await preserveTerminalPulls(
            this.collections.pulls,
            this.collections.pullDetails,
            currentPriorRows,
            normalized,
            observedAt,
            verified,
          )
        }
        if (options.complete) {
          await this.collections.pulls.replace(nextRows, (row) => row.groupId === groupId)
        } else {
          await this.collections.pulls.upsert(nextRows)
        }
        const groups = [...this.collections.groups.collection.values()]
        await reconcileInboxPreferences(
          this.collections.inboxPreferences,
          accountLogin,
          [...this.collections.pulls.collection.values()],
          Date.now(),
          groups,
        )
      })
    })()
  }

  private enqueueInbox<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.inboxQueue.then(operation)
    this.inboxQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async preloadInboxCollections(): Promise<void> {
    await Promise.all([
      this.collections.inboxPreferences.collection.preload(),
      this.collections.pulls.collection.preload(),
      this.collections.groups.collection.preload(),
    ])
  }

  private accountPreferenceMap(accountLogin: string): Map<string, InboxPreference> {
    const account = accountLogin.trim().toLowerCase()
    return new Map(
      [...this.collections.inboxPreferences.collection.values()]
        .filter((row) => row.accountLogin.trim().toLowerCase() === account)
        .map((row) => [row.pullId, plainPreference(row)]),
    )
  }

  private async prepareInbox(accountLogin: string, extraPull?: PullRequest): Promise<void> {
    await this.preloadInboxCollections()
    const pulls: PullRequest[] = [...this.collections.pulls.collection.values()].map((pull) => ({
      ...pull,
    }))
    if (extraPull && !pulls.some((pull) => pull.id === extraPull.id)) pulls.push(extraPull)
    const groups = [...this.collections.groups.collection.values()]
    const preferences = [...this.collections.inboxPreferences.collection.values()]
    const entries = deriveInboxPulls(
      pulls,
      groups,
      accountLogin,
      preferences,
      Date.now(),
      "all",
    ).sort(compareInboxRecency)
    const before = this.accountPreferenceMap(accountLogin)
    await ensureInboxOrderState(this.collections.inboxPreferences, accountLogin, entries)
    this.invalidateUndoForChangedRows(accountLogin, before)
  }

  private mutateInbox(
    accountLogin: string,
    pull: PullRequest,
    operation: () => Promise<InboxPreference>,
  ): Promise<InboxMutationResult> {
    return this.enqueueInbox(() => this.mutateInboxNow(accountLogin, pull, operation))
  }

  private async mutateInboxNow(
    accountLogin: string,
    pull: PullRequest,
    operation: () => Promise<InboxPreference>,
  ): Promise<InboxMutationResult> {
    await this.prepareInbox(accountLogin, pull)
    const before = this.accountPreferenceMap(accountLogin)
    const preference = await operation()
    const after = this.accountPreferenceMap(accountLogin)
    const changedIds = new Set<string>()
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (!samePreference(before.get(id), after.get(id))) changedIds.add(id)
    }
    if (changedIds.size === 0) return { preference, undo: null }

    const account = accountLogin.trim().toLowerCase()
    const snapshots = (source: Map<string, InboxPreference>) =>
      [...changedIds].map((pullId) => {
        const row = source.get(pullId)
        return { pullId, ...(row ? { preference: plainPreference(row) } : {}) }
      })
    const token: InboxUndoToken = {
      id: ++this.nextInboxUndoId,
      accountLogin: account,
      expiresAt: Date.now() + INBOX_UNDO_TTL_MS,
    }
    this.pruneInboxUndoTokens(Date.now())
    this.invalidateUndoTokens(account, changedIds)
    this.inboxUndoTokens.set(token.id, {
      token,
      before: snapshots(before),
      after: snapshots(after),
    })
    while (this.inboxUndoTokens.size > MAX_INBOX_UNDO_TOKENS) {
      const oldest = this.inboxUndoTokens.keys().next().value
      if (oldest === undefined) break
      this.inboxUndoTokens.delete(oldest)
    }
    return { preference, undo: token }
  }

  private invalidateUndoForChangedRows(
    accountLogin: string,
    before: Map<string, InboxPreference>,
  ): void {
    const after = this.accountPreferenceMap(accountLogin)
    const changedIds = new Set(
      [...new Set([...before.keys(), ...after.keys()])].filter(
        (id) => !samePreference(before.get(id), after.get(id)),
      ),
    )
    if (changedIds.size > 0) this.invalidateUndoTokens(accountLogin, changedIds)
  }

  private pruneInboxUndoTokens(now: number): void {
    for (const [id, snapshot] of this.inboxUndoTokens) {
      if (now > snapshot.token.expiresAt) this.inboxUndoTokens.delete(id)
    }
  }

  private invalidateUndoTokens(accountLogin: string, changedIds: ReadonlySet<string>): void {
    const account = accountLogin.trim().toLowerCase()
    for (const [id, snapshot] of this.inboxUndoTokens) {
      if (
        snapshot.token.accountLogin === account &&
        snapshot.after.some(({ pullId }) => changedIds.has(pullId))
      ) {
        this.inboxUndoTokens.delete(id)
      }
    }
  }

  /** Removes persisted Starred data before startup can expose or poll it. */
  async prepareSync(): Promise<void> {
    const { groups, pulls } = this.collections
    await Promise.all([groups.collection.preload(), pulls.collection.preload()])
    if (groups.collection.has("starred")) await groups.remove(["starred"])
    const starredPullKeys = [...pulls.collection.values()]
      .filter((pull) => pull.groupId === "starred")
      .map((pull) => pull.key)
    if (starredPullKeys.length > 0) await pulls.remove(starredPullKeys)
  }

  /** Selects the signed-in namespace before any cached view is exposed. */
  async activateAccount(login: string): Promise<void> {
    this.authGeneration++
    await this.enqueueInbox(async () => {
      this.activeInboxAccount = login.toLowerCase()
      await this.collections.database.setScope(this.rest.url("/"), login)
      await this.prepareSync()
    })
  }

  private scopedWriter<T extends object, K extends string | number>(
    source: SyncedCollection<T, K>,
  ): SyncedCollection<T, K> {
    const generation = this.authGeneration
    const namespace = this.collections.database.scope
    const current = () =>
      generation === this.authGeneration && namespace === this.collections.database.scope
    return {
      collection: source.collection,
      upsert: (rows) => (current() ? source.upsert(rows) : Promise.resolve()),
      replace: (rows, scope) => (current() ? source.replace(rows, scope) : Promise.resolve()),
      remove: (keys) => (current() ? source.remove(keys) : Promise.resolve()),
    }
  }

  /** Starts background sync of groups and of every group's pull requests. */
  startSync(): void {
    if (this.syncing) return
    this.syncing = true
    this.poller.register({
      key: jobKeys.groups,
      activeMs: ACTIVE_MS,
      idleMs: GROUPS_IDLE_MS,
      resource: "core",
      run: async () => {
        await syncGroups(
          this.rest,
          this.scopedWriter(this.collections.groups),
          this.scopedWriter(this.collections.repos),
        )
        this.registerGroupJobs()
      },
    })
    // Groups restored from SQLite start polling before the first groups sync finishes.
    this.registerGroupJobs()
  }

  private readonly groupJobs = new Set<string>()

  private registerGroupJobs(): void {
    const current = new Set<string>()
    for (const group of this.collections.groups.collection.values()) {
      if (group.kind === "starred") continue
      const key = jobKeys.groupPulls(group.id)
      current.add(key)
      this.poller.register(this.groupPullsJob(group.id))
      // A view may already watch a group that just appeared; load it now, not on its next tick.
      if (!this.groupJobs.has(key)) void this.poller.refresh(key)
    }
    for (const key of this.groupJobs) if (!current.has(key)) this.poller.unregister(key)
    this.groupJobs.clear()
    for (const key of current) this.groupJobs.add(key)
  }

  private groupPullsJob(groupId: string) {
    return {
      key: jobKeys.groupPulls(groupId),
      activeMs: ACTIVE_MS,
      idleMs: IDLE_MS,
      resource: "graphql" as const,
      run: async () => {
        // Read the group when the job runs: it may not be loaded yet, and team repos change.
        const group = this.collections.groups.collection.get(groupId)
        if (!this.auth.getToken() || !group) return
        const authGeneration = this.authGeneration
        await this.collections.pulls.collection.preload()
        if (authGeneration !== this.authGeneration) return
        const result = await fetchGroupPulls(this.graphql, group)
        if (authGeneration !== this.authGeneration) return
        const priorRows = [...this.collections.pulls.collection.values()].filter(
          (row) => row.groupId === groupId,
        )
        const verified = result.complete
          ? await verifyMissingPulls(this.graphql, priorRows, result.rows, groupId)
          : undefined
        await this.enqueueInbox(async () => {
          if (authGeneration !== this.authGeneration || !this.auth.getToken()) return
          await applyGroupPulls(
            group,
            result,
            this.collections.pulls,
            this.collections.pullDetails,
            verified,
          )
          for (const [pullId, state] of this.confirmedPullStates) {
            if ([...this.collections.pulls.collection.values()].some((row) => row.id === pullId)) {
              await updatePullLifecycleCopies(
                this.collections.pulls,
                pullId,
                state.state,
                state.observedAt,
              )
            }
          }
          const account = this.activeInboxAccount
          if (account) {
            await reconcileInboxPreferences(
              this.collections.inboxPreferences,
              account,
              [...this.collections.pulls.collection.values()],
              Date.now(),
              [...this.collections.groups.collection.values()],
            )
          }
        })
      },
    }
  }

  watchGroup(groupId: string): () => void {
    if (groupId === "starred") return () => {}
    return this.poller.watch(this.groupPullsJob(groupId))
  }

  /** Keeps a pull request's detail and files fresh while a view shows it. */
  watchPull(repo: string, number: number, accountLogin?: string): () => void {
    if (accountLogin) this.activeInboxAccount = accountLogin.trim().toLowerCase()
    return this.poller.watch({
      key: jobKeys.pull(repo, number),
      activeMs: ACTIVE_MS,
      idleMs: Number.POSITIVE_INFINITY,
      resource: "graphql",
      run: async () => {
        if (!this.auth.getToken()) return
        const authGeneration = this.authGeneration
        const observedAt = new Date().toISOString()
        const detail = await fetchPullDetail(this.graphql, repo, number)
        let committed = false
        await this.enqueueInbox(async () => {
          if (authGeneration !== this.authGeneration || !this.auth.getToken()) return
          const accepted = await this.observePullLifecycle(
            detail,
            observedAt,
            accountLogin ?? this.activeInboxAccount ?? undefined,
          )
          if (!accepted) return
          await this.collections.pullDetails.upsert([detail])
          committed = true
        })
        if (!committed) return
        if (authGeneration !== this.authGeneration) return
        const files = await fetchPullFiles(this.rest, repo, number, detail.headOid)
        if (!files) return
        await this.enqueueInbox(async () => {
          if (authGeneration !== this.authGeneration || !this.auth.getToken()) return
          await this.collections.pullFiles.upsert([files])
        })
      },
    })
  }

  /** Loads a pull request before navigation, using the same cache and sync job as its page. */
  async prefetchPull(repo: string, number: number): Promise<void> {
    const key = prKey(repo, number)
    const detail = this.collections.pullDetails.collection.get(key)
    const files = this.collections.pullFiles.collection.get(key)
    if (detail && files?.headOid === detail.headOid) return

    const release = this.watchPull(repo, number)
    try {
      await this.refresh(jobKeys.pull(repo, number))
    } finally {
      release()
    }
  }

  watchRuns(repo: string): () => void {
    return this.poller.watch({
      key: jobKeys.runs(repo),
      activeMs: ACTIVE_MS,
      idleMs: Number.POSITIVE_INFINITY,
      resource: "core",
      run: () =>
        syncWorkflowRuns(this.rest, repo, this.scopedWriter(this.collections.workflowRuns)),
    })
  }

  watchRunJobs(repo: string, runId: number): () => void {
    return this.poller.watch({
      key: jobKeys.runJobs(runId),
      activeMs: ACTIVE_MS,
      idleMs: Number.POSITIVE_INFINITY,
      resource: "core",
      run: () => syncRunJobs(this.rest, repo, runId, this.scopedWriter(this.collections.jobs)),
    })
  }

  watchWorkflows(repo: string): () => void {
    return this.poller.watch({
      key: jobKeys.workflows(repo),
      activeMs: 5 * 60_000,
      idleMs: Number.POSITIVE_INFINITY,
      resource: "core",
      run: () => syncWorkflows(this.rest, repo, this.scopedWriter(this.collections.workflows)),
    })
  }

  refresh(key: string): Promise<void> {
    if (key === jobKeys.groupPulls("starred")) return Promise.resolve()
    return this.poller.refresh(key)
  }

  // Write actions. Each one refreshes the data it changed.

  async submitReview(
    repo: string,
    number: number,
    event: reviews.ReviewEvent,
    body: string,
  ): Promise<void> {
    const authGeneration = this.authGeneration
    const key = prKey(repo, number)
    const detail = this.collections.pullDetails.collection.get(key)
    if (!detail) throw new Error(`Pull request ${key} is not loaded`)
    const drafts = [...this.collections.drafts.values()].filter((d) => d.prKey === key)
    // One review has one commit; drafts from different pushes cannot be sent together.
    const commits = new Set(drafts.map((d) => d.commitId ?? detail.headOid))
    if (commits.size > 1) {
      throw new Error(
        "Draft comments were written on different commits. Delete or rewrite the outdated drafts.",
      )
    }
    await reviews.submitReview(this.rest, {
      repo,
      number,
      commitId: [...commits][0] ?? detail.headOid,
      event,
      body,
      comments: drafts,
    })
    await this.enqueueInbox(async () => {
      if (authGeneration !== this.authGeneration) return
      if (drafts.length > 0)
        await this.collections.drafts.delete(drafts.map((d) => d.id)).isPersisted.promise
    })
    if (authGeneration === this.authGeneration) await this.refresh(jobKeys.pull(repo, number))
  }

  addDraft(draft: Omit<reviews.DraftComment, "id" | "createdAt" | "commitId">): void {
    // The diff on screen comes from the files list, which can lag behind the detail.
    const files = this.collections.pullFiles.collection.get(draft.prKey)
    if (!files) throw new Error(`Files of ${draft.prKey} are not loaded`)
    this.collections.drafts.insert({
      ...draft,
      commitId: files.headOid,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    })
  }

  updateDraft(id: string, body: string): void {
    this.collections.drafts.update(id, (d) => {
      d.body = body
    })
  }

  deleteDraft(id: string): void {
    this.collections.drafts.delete(id)
  }

  async reply(repo: string, number: number, commentDatabaseId: number, body: string) {
    await reviews.replyToThread(this.rest, repo, number, commentDatabaseId, body)
    await this.refresh(jobKeys.pull(repo, number))
  }

  async comment(repo: string, number: number, body: string) {
    await reviews.commentOnPull(this.rest, repo, number, body)
    await this.refresh(jobKeys.pull(repo, number))
  }

  async setThreadResolved(repo: string, number: number, threadId: string, resolved: boolean) {
    await reviews.setThreadResolved(this.graphql, threadId, resolved)
    await this.refresh(jobKeys.pull(repo, number))
  }

  async merge(
    repo: string,
    number: number,
    method: MergeMethod,
    accountLogin: string,
  ): Promise<{ inboxError?: unknown }> {
    const authGeneration = this.authGeneration
    const detail = this.collections.pullDetails.collection.get(prKey(repo, number))
    if (!detail) throw new Error("Pull request is not loaded")
    await reviews.mergePull(this.rest, repo, number, method, detail.headOid)
    const inboxError = await this.enqueueInbox(async () => {
      if (authGeneration !== this.authGeneration) {
        return new Error("The account changed after GitHub merged the pull request")
      }
      const observedAt = new Date().toISOString()
      this.confirmedPullStates.set(detail.id, { state: "MERGED", observedAt })
      this.notifyInboxLifecycle()
      try {
        await this.collections.pulls.collection.preload()
      } catch (error) {
        return error
      }
      const known = [...this.collections.pulls.collection.values()].find(
        (pull) => pull.id === detail.id,
      )
      const merged = known
        ? { ...known, state: "MERGED" as const, stateObservedAt: observedAt }
        : pullFromDetail(detail, observedAt)
      let saveError: unknown
      try {
        await updatePullLifecycleCopies(
          this.collections.pulls,
          detail.id,
          "MERGED",
          observedAt,
          merged,
        )
      } catch (error) {
        saveError = error
      }
      try {
        await this.mutateInboxNow(accountLogin, merged, () =>
          settleInboxPullState(this.collections.inboxPreferences, accountLogin, merged),
        )
      } catch (error) {
        saveError ??= error
      }
      return saveError
    })
    try {
      await this.refresh(jobKeys.pull(repo, number))
    } catch {
      // The remote merge already succeeded; refresh status is reported by the poller.
    }
    return inboxError === undefined ? {} : { inboxError }
  }

  async rerunRun(repo: string, runId: number, onlyFailed: boolean) {
    await (onlyFailed
      ? workflows.rerunFailedJobs(this.rest, repo, runId)
      : workflows.rerunRun(this.rest, repo, runId))
    await Promise.all([this.refresh(jobKeys.runs(repo)), this.refresh(jobKeys.runJobs(runId))])
  }

  async rerunJob(repo: string, runId: number, jobId: number) {
    await workflows.rerunJob(this.rest, repo, jobId)
    await this.refresh(jobKeys.runJobs(runId))
  }

  async cancelRun(repo: string, runId: number) {
    await workflows.cancelRun(this.rest, repo, runId)
    await Promise.all([this.refresh(jobKeys.runs(repo)), this.refresh(jobKeys.runJobs(runId))])
  }

  async approveRun(repo: string, runId: number) {
    await workflows.approveRun(this.rest, repo, runId)
    await Promise.all([this.refresh(jobKeys.runs(repo)), this.refresh(jobKeys.runJobs(runId))])
  }

  fetchPendingPullRequestApprovals(repo: string, number: number, headSha: string) {
    return fetchPendingApprovals(this.rest, repo, number, headSha)
  }

  /** One run, for runs older than the latest ones kept in `collections.workflowRuns`. */
  async fetchRun(repo: string, runId: number) {
    return toWorkflowRun(repo, await this.rest.get(`/repos/${repo}/actions/runs/${runId}`))
  }

  fetchJobLog(repo: string, jobId: number): Promise<string> {
    return workflows.fetchJobLog(this.rest, repo, jobId)
  }

  fetchDispatchInputs(repo: string, path: string, ref: string) {
    return workflows.fetchDispatchInputs(this.rest, repo, path, ref)
  }

  async dispatchWorkflow(
    repo: string,
    workflowId: number,
    ref: string,
    inputs: Record<string, string | boolean | number>,
  ) {
    await workflows.dispatchWorkflow(this.rest, repo, workflowId, ref, inputs)
    await this.refresh(jobKeys.runs(repo))
  }
}

function compareInboxRecency(a: InboxPull, b: InboxPull): number {
  return (
    b.pull.updatedAt.localeCompare(a.pull.updatedAt) ||
    a.pull.repo.localeCompare(b.pull.repo) ||
    a.pull.number - b.pull.number
  )
}

function plainPreference(row: InboxPreference): InboxPreference
function plainPreference(row: InboxPreference | undefined): InboxPreference | undefined
function plainPreference(row: InboxPreference | undefined): InboxPreference | undefined {
  if (!row) return undefined
  return {
    key: row.key,
    accountLogin: row.accountLogin,
    pullId: row.pullId,
    state: row.state,
    snoozedUntil: row.snoozedUntil,
    snapshot: {
      headOid: row.snapshot.headOid,
      reviewRequests: [...row.snapshot.reviewRequests],
      failed: row.snapshot.failed,
    },
    terminalState: row.terminalState,
    terminalObservedAt: row.terminalObservedAt,
    changedAt: row.changedAt,
    activeOrder: row.activeOrder,
    pinOrder: row.pinOrder,
  }
}

function pullFromDetail(detail: PullRequestDetail, observedAt: string): PullRequest {
  return {
    key: `me:${detail.id}`,
    groupId: "me",
    id: detail.id,
    repo: detail.repo,
    number: detail.number,
    title: detail.title,
    url: detail.url,
    author: detail.author?.login ?? null,
    authorAvatarUrl: detail.author?.avatarUrl ?? null,
    isDraft: detail.isDraft,
    createdAt: detail.createdAt,
    updatedAt: detail.createdAt,
    syncedAt: observedAt,
    state: "MERGED",
    stateObservedAt: observedAt,
    headOid: detail.headOid,
    headRef: detail.headRef,
    baseRef: detail.baseRef,
    reviewDecision: detail.reviewDecision,
    checkState: null,
    labels: [],
    reviewRequests: [],
    comments: 0,
    additions: detail.additions,
    deletions: detail.deletions,
  }
}

function samePreference(
  left: InboxPreference | undefined,
  right: InboxPreference | undefined,
): boolean {
  return JSON.stringify(plainPreference(left)) === JSON.stringify(plainPreference(right))
}
