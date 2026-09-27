import type { SyncedCollection } from "./collections/synced"
import type { Group, PullRequest } from "./domain/types"

export type InboxState = "active" | "snoozed" | "settled"

export interface InboxPreference {
  /** Lowercased account login and stable GitHub PR node ID. */
  key: string
  accountLogin: string
  pullId: string
  state: InboxState
  /** Absolute expiry. Null outside the snoozed state. */
  snoozedUntil: string | null
  /** Source snapshot used to decide whether a settled PR has new work. */
  snapshot: {
    headOid: string | null
    reviewRequests: string[]
    failed: boolean
  }
  changedAt: string
  /** Saved position in Active, retained while pinned or snoozed. */
  activeOrder?: number
  /** Saved position in Pinned, retained while snoozed. */
  pinOrder?: number
}

export interface InboxPull {
  pull: PullRequest
  state: InboxState
  preference?: InboxPreference
}

export type InboxOrderSection = "active" | "pinned" | "settled"

export interface InboxDropPosition {
  beforePullId?: string
  afterPullId?: string
}

export interface InboxMoveTarget extends InboxDropPosition {
  section: InboxOrderSection
}

export interface InboxUndoRow {
  pullId: string
  previous?: InboxPreference
  expected?: InboxPreference
}

export interface InboxUndoToken {
  id: number
  accountLogin: string
  expiresAt: number
}

export interface InboxMutationResult {
  preference: InboxPreference
  undo: InboxUndoToken | null
}

export type InboxPreferenceStore = SyncedCollection<InboxPreference, string>

export function inboxPreferenceKey(accountLogin: string, pullId: string): string {
  return `${accountLogin.trim().toLowerCase()}:${pullId}`
}

/** Collapse group copies into one inbox row, using the most recently updated PR copy. */
export function deriveInboxPulls(
  pulls: readonly PullRequest[],
  groups: readonly Group[],
  login: string,
  preferences: readonly InboxPreference[],
  now: number,
  scope: "involving" | "all",
): InboxPull[] {
  const currentLogin = login.trim().toLowerCase()
  const teamRequests = new Set(
    groups
      .filter((group) => group.kind === "team")
      .map((group) =>
        (group.id.startsWith("team:") ? group.id.slice(5) : group.name).toLowerCase(),
      ),
  )
  const involvingMe = new Set(pulls.filter((pull) => pull.groupId === "me").map((pull) => pull.id))
  const byPull = new Map<string, PullRequest>()
  for (const pull of pulls) {
    const prior = byPull.get(pull.id)
    if (!prior || preferPull(pull, prior)) byPull.set(pull.id, pull)
  }
  const accountPreferences = new Map(
    preferences
      .filter((preference) => preference.accountLogin.toLowerCase() === currentLogin)
      .map((preference) => [preference.pullId, preference]),
  )

  return [...byPull.values()]
    .filter((pull) => {
      if (scope === "all") return true
      return (
        involvingMe.has(pull.id) ||
        pull.author?.toLowerCase() === currentLogin ||
        pull.reviewRequests.some((request) => {
          const normalized = request.toLowerCase()
          return normalized === currentLogin || teamRequests.has(normalized)
        })
      )
    })
    .map((pull) => {
      const preference = accountPreferences.get(pull.id)
      return {
        pull,
        state: effectiveState(preference, now),
        ...(preference ? { preference } : {}),
      }
    })
}

function preferPull(candidate: PullRequest, current: PullRequest): boolean {
  const candidateSync = candidate.syncedAt
    ? Date.parse(candidate.syncedAt)
    : Number.NEGATIVE_INFINITY
  const currentSync = current.syncedAt ? Date.parse(current.syncedAt) : Number.NEGATIVE_INFINITY
  if (candidateSync !== currentSync) return candidateSync > currentSync
  const freshness = candidate.updatedAt.localeCompare(current.updatedAt)
  if (freshness !== 0) return freshness > 0
  // Prefer copies with useful current data when the sync times are equal.
  if (!current.headOid && candidate.headOid) return true
  return false
}

function effectiveState(preference: InboxPreference | undefined, now: number): InboxState {
  if (!preference) return "active"
  if (
    preference.state === "snoozed" &&
    (preference.snoozedUntil === null || Date.parse(preference.snoozedUntil) <= now)
  ) {
    return "active"
  }
  return preference.state
}

function isFailure(pull: PullRequest): boolean {
  return pull.checkState === "FAILURE" || pull.checkState === "ERROR"
}

function snapshot(pull: PullRequest): InboxPreference["snapshot"] {
  return {
    headOid: pull.headOid ?? null,
    reviewRequests: [
      ...new Set(pull.reviewRequests.map((request) => request.toLowerCase())),
    ].sort(),
    failed: isFailure(pull),
  }
}

function createPreference(
  accountLogin: string,
  pull: PullRequest,
  state: InboxState,
  snoozedUntil: string | null,
  now = Date.now(),
): InboxPreference {
  const account = accountLogin.trim().toLowerCase()
  return {
    key: inboxPreferenceKey(account, pull.id),
    accountLogin: account,
    pullId: pull.id,
    state,
    snoozedUntil,
    snapshot: snapshot(pull),
    changedAt: new Date(now).toISOString(),
    activeOrder: undefined,
    pinOrder: undefined,
  }
}

function validateSnoozeExpiry(until: string, now: number): string {
  const timestamp = Date.parse(until)
  if (!Number.isFinite(timestamp) || timestamp <= now) {
    throw new Error("Snooze expiry must be a future date")
  }
  return new Date(timestamp).toISOString()
}

export async function setInboxSnoozed(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  until: string,
  now = Date.now(),
): Promise<InboxPreference> {
  const account = accountLogin.trim().toLowerCase()
  const snoozedUntil = validateSnoozeExpiry(until, now)
  const stored = preferences.collection.get(inboxPreferenceKey(account, pull.id))
  const previous = stored ? plainInboxPreference(stored) : undefined
  const preference = createPreference(account, pull, "snoozed", snoozedUntil, now)
  const next = {
    ...preference,
    ...(isRank(previous?.activeOrder) ? { activeOrder: previous.activeOrder } : {}),
    ...(isRank(previous?.pinOrder) ? { pinOrder: previous.pinOrder } : {}),
  }
  await preferences.upsert([next])
  return next
}

export async function settleInboxPull(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  now = Date.now(),
): Promise<InboxPreference> {
  const account = accountLogin.trim().toLowerCase()
  const current = accountPreferences(preferences, account)
  const preference = createPreference(account, pull, "settled", null, now)
  const updates = new Map(current.map((row) => [row.pullId, row]))
  updates.set(pull.id, preference)
  renumber(
    updates,
    rankedPullIds(current, "activeOrder").filter((id) => id !== pull.id),
    "activeOrder",
  )
  renumber(
    updates,
    rankedPullIds(current, "pinOrder").filter((id) => id !== pull.id),
    "pinOrder",
  )
  await preferences.upsert([...updates.values()].filter((row) => changedFrom(current, row)))
  return updates.get(pull.id)!
}

export async function restoreInboxPull(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  now = Date.now(),
): Promise<InboxPreference> {
  const account = accountLogin.trim().toLowerCase()
  const current = accountPreferences(preferences, account)
  const preference = createPreference(account, pull, "active", null, now)
  const updates = new Map(current.map((row) => [row.pullId, row]))
  updates.set(pull.id, preference)
  const activeOrder = [
    pull.id,
    ...rankedPullIds(current, "activeOrder").filter((id) => id !== pull.id),
  ]
  renumber(updates, activeOrder, "activeOrder")
  const pinOrder = rankedPullIds(current, "pinOrder").filter((id) => id !== pull.id)
  renumber(updates, pinOrder, "pinOrder")
  await preferences.upsert([...updates.values()].filter((row) => changedFrom(current, row)))
  return updates.get(pull.id)!
}

/** Restores a captured preference or deletes it to return to the default Active state. */
export async function restoreInboxPreference(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pullId: string,
  previous?: InboxPreference,
): Promise<void> {
  const account = accountLogin.trim().toLowerCase()
  const key = inboxPreferenceKey(account, pullId)
  if (!previous) {
    await preferences.remove([key])
    return
  }
  if (
    previous.accountLogin.trim().toLowerCase() !== account ||
    previous.pullId !== pullId ||
    previous.key !== inboxPreferenceKey(previous.accountLogin, previous.pullId)
  ) {
    throw new Error("Inbox preference does not match the account and pull request")
  }
  await preferences.upsert([
    {
      ...previous,
      key,
      accountLogin: account,
      pullId,
      activeOrder: previous.activeOrder,
      pinOrder: previous.pinOrder,
    },
  ])
}

/** Lazily seeds missing ranks and puts newly discovered active PRs first. */
export async function ensureInboxOrder(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  orderedEntries: readonly InboxPull[],
  now = Date.now(),
): Promise<void> {
  const account = accountLogin.trim().toLowerCase()
  const current = accountPreferences(preferences, account)
  const rowsById = new Map(current.map((row) => [row.pullId, row]))
  const orderedCurrent = orderedEntries.filter((entry) => {
    const stored = rowsById.get(entry.pull.id)
    const state = stored ? effectiveState(stored, now) : entry.state
    return state === "active" || state === "snoozed"
  })
  const existingOrder = rankedPullIds(current, "activeOrder")
  const missing = orderedCurrent.filter(
    (entry) => !isRank(rowsById.get(entry.pull.id)?.activeOrder),
  )
  if (missing.length === 0) return

  const updates = new Map(current.map((row) => [row.pullId, row]))
  for (const entry of missing) {
    const previous = updates.get(entry.pull.id)
    const base = previous ?? createPreference(account, entry.pull, entry.state, null, now)
    updates.set(entry.pull.id, { ...base, activeOrder: 0 })
  }
  const order =
    existingOrder.length === 0
      ? orderedCurrent.map((entry) => entry.pull.id)
      : [...missing.map((entry) => entry.pull.id), ...existingOrder]
  renumber(updates, order, "activeOrder")
  const changed = [...updates.values()].filter((row) => changedFrom(current, row))
  if (changed.length > 0) await preferences.upsert(changed)
}

/** Moves one PR by stable ID anchors against the full saved sequence. */
export async function moveInboxPull(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  section: InboxOrderSection,
  position: InboxDropPosition = {},
  now = Date.now(),
): Promise<InboxPreference> {
  const account = accountLogin.trim().toLowerCase()
  const current = accountPreferences(preferences, account)
  const prior = current.find((row) => row.pullId === pull.id)
  if (section === "settled" && prior?.state === "settled") return prior

  const updates = new Map(current.map((row) => [row.pullId, row]))
  let next = prior ?? createPreference(account, pull, "active", null, now)
  const lifecycleChanged =
    section === "settled"
      ? next.state !== "settled"
      : next.state !== "active" || next.snoozedUntil !== null
  if (section === "settled") {
    next = createPreference(account, pull, "settled", null, now)
  } else if (lifecycleChanged) {
    next = createPreference(account, pull, "active", null, now)
  }

  const activeOrder = rankedPullIds(current, "activeOrder")
  const pinOrder = rankedPullIds(current, "pinOrder")
  let updatedActive = activeOrder.filter((id) => id !== pull.id)
  const updatedPins = pinOrder.filter((id) => id !== pull.id)

  if (section === "settled") {
    // Settling deliberately releases both saved positions.
    updates.set(pull.id, next)
  } else if (section === "active") {
    const insertAt = insertionIndex(updatedActive, position)
    if (insertAt === null) return prior ?? next
    updatedActive.splice(insertAt, 0, pull.id)
    updates.set(pull.id, withoutRank(next, "pinOrder"))
  } else {
    // A pinned PR keeps its Active fallback; a restored row gets a top fallback.
    if (isRank(prior?.activeOrder)) {
      next = { ...next, activeOrder: prior.activeOrder }
      updatedActive = [...activeOrder]
    } else {
      updatedActive.unshift(pull.id)
    }
    const insertAt = insertionIndex(updatedPins, position)
    if (insertAt === null) return prior ?? next
    updatedPins.splice(insertAt, 0, pull.id)
    updates.set(pull.id, next)
  }

  renumber(updates, updatedActive, "activeOrder")
  renumber(updates, updatedPins, "pinOrder")
  const changed = [...updates.values()].filter((row) => changedFrom(current, row))
  if (changed.length > 0) await preferences.upsert(changed)
  return updates.get(pull.id)!
}

/** Pins only active PRs and preserves their saved Active slot. */
export async function pinInboxPull(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  now = Date.now(),
): Promise<InboxPreference> {
  const account = accountLogin.trim().toLowerCase()
  const current = accountPreferences(preferences, account)
  const prior = current.find((row) => row.pullId === pull.id)
  if (prior?.state === "snoozed" || prior?.state === "settled" || isRank(prior?.pinOrder)) {
    return prior ?? createPreference(account, pull, "active", null, now)
  }
  const updates = new Map(current.map((row) => [row.pullId, row]))
  const next = prior ?? createPreference(account, pull, "active", null, now)
  updates.set(pull.id, { ...next, pinOrder: 0 })
  renumber(updates, [pull.id, ...rankedPullIds(current, "pinOrder")], "pinOrder")
  const changed = [...updates.values()].filter((row) => changedFrom(current, row))
  if (changed.length > 0) await preferences.upsert(changed)
  return updates.get(pull.id)!
}

/** Unpins while retaining the Active fallback position. */
export async function unpinInboxPull(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  now = Date.now(),
): Promise<InboxPreference> {
  const account = accountLogin.trim().toLowerCase()
  const current = accountPreferences(preferences, account)
  const prior = current.find((row) => row.pullId === pull.id)
  if (!prior || !isRank(prior.pinOrder))
    return prior ?? createPreference(account, pull, "active", null, now)
  const updates = new Map(current.map((row) => [row.pullId, row]))
  updates.set(pull.id, withoutRank(prior, "pinOrder"))
  renumber(
    updates,
    rankedPullIds(current, "pinOrder").filter((id) => id !== pull.id),
    "pinOrder",
  )
  const changed = [...updates.values()].filter((row) => changedFrom(current, row))
  if (changed.length > 0) await preferences.upsert(changed)
  return updates.get(pull.id)!
}

/** Wakes a snoozed PR at its retained pin and Active positions. */
export async function wakeInboxPull(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  now = Date.now(),
): Promise<InboxPreference> {
  const account = accountLogin.trim().toLowerCase()
  const current = accountPreferences(preferences, account)
  const prior = current.find((row) => row.pullId === pull.id)
  if (prior?.state !== "snoozed")
    return prior ?? createPreference(account, pull, "active", null, now)
  const next = {
    ...createPreference(account, pull, "active", null, now),
    ...(isRank(prior.activeOrder) ? { activeOrder: prior.activeOrder } : {}),
    ...(isRank(prior.pinOrder) ? { pinOrder: prior.pinOrder } : {}),
  }
  await preferences.upsert([next])
  return next
}

type RankField = "activeOrder" | "pinOrder"

function isRank(value: number | undefined): value is number {
  return Number.isInteger(value) && value! >= 0
}

function accountPreferences(preferences: InboxPreferenceStore, account: string) {
  return [...preferences.collection.values()]
    .filter((row) => row.accountLogin.trim().toLowerCase() === account)
    .map(plainInboxPreference)
}

function plainInboxPreference(row: InboxPreference): InboxPreference {
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
    changedAt: row.changedAt,
    activeOrder: row.activeOrder,
    pinOrder: row.pinOrder,
  }
}

function rankedPullIds(rows: readonly InboxPreference[], field: RankField): string[] {
  return rows
    .filter((row) => isRank(row[field]))
    .sort((a, b) => a[field]! - b[field]! || a.pullId.localeCompare(b.pullId))
    .map((row) => row.pullId)
}

function renumber(
  rows: Map<string, InboxPreference>,
  pullIds: readonly string[],
  field: RankField,
): void {
  pullIds.forEach((pullId, index) => {
    const row = rows.get(pullId)
    if (row && row[field] !== index) rows.set(pullId, { ...row, [field]: index })
  })
}

function withoutRank(row: InboxPreference, field: RankField): InboxPreference {
  return { ...row, [field]: undefined }
}

function insertionIndex(pullIds: readonly string[], position: InboxDropPosition): number | null {
  if (position.beforePullId === position.afterPullId && position.beforePullId !== undefined) {
    return null
  }
  if (position.beforePullId !== undefined) {
    const before = pullIds.indexOf(position.beforePullId)
    if (before < 0) return null
    return before
  }
  if (position.afterPullId !== undefined) {
    const after = pullIds.indexOf(position.afterPullId)
    return after < 0 ? null : after + 1
  }
  return 0
}

function changedFrom(current: readonly InboxPreference[], candidate: InboxPreference): boolean {
  const prior = current.find((row) => row.pullId === candidate.pullId)
  return JSON.stringify(prior) !== JSON.stringify(candidate)
}

/**
 * Expire snoozes and reactivate settled PRs on concrete new work. Advancing the
 * saved snapshot makes each observed change a one-time transition.
 */
export async function reconcileInboxState(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pulls: readonly PullRequest[],
  now = Date.now(),
  groups: readonly Group[] = [],
): Promise<void> {
  const account = accountLogin.trim().toLowerCase()
  const byPull = new Map<string, PullRequest>()
  for (const pull of pulls) {
    const prior = byPull.get(pull.id)
    if (!prior || preferPull(pull, prior)) byPull.set(pull.id, pull)
  }
  const updates: InboxPreference[] = []
  const reactivated: PullRequest[] = []
  const teamRequests = new Set(
    groups
      .filter((group) => group.kind === "team")
      .map((group) =>
        (group.id.startsWith("team:") ? group.id.slice(5) : group.name).toLowerCase(),
      ),
  )
  for (const storedPreference of preferences.collection.values()) {
    const preference = plainInboxPreference(storedPreference)
    if (preference.accountLogin.toLowerCase() !== account) continue
    const pull = byPull.get(preference.pullId)
    if (!pull) continue
    if (
      preference.state === "settled" &&
      pull.syncedAt &&
      Date.parse(pull.syncedAt) < Date.parse(preference.changedAt)
    ) {
      continue
    }
    if (
      preference.state === "snoozed" &&
      preference.snoozedUntil !== null &&
      Date.parse(preference.snoozedUntil) <= now
    ) {
      updates.push({
        ...createPreference(account, pull, "active", null, now),
        ...(isRank(preference.activeOrder) ? { activeOrder: preference.activeOrder } : {}),
        ...(isRank(preference.pinOrder) ? { pinOrder: preference.pinOrder } : {}),
      })
      continue
    }
    if (preference.state !== "settled") continue
    const current = snapshot(pull)
    const changedHead = Boolean(
      preference.snapshot.headOid &&
        current.headOid &&
        preference.snapshot.headOid !== current.headOid,
    )
    const addedRequest = current.reviewRequests.some((request) => {
      const relevant = request === account || teamRequests.has(request)
      return relevant && !preference.snapshot.reviewRequests.includes(request)
    })
    const newFailure = current.failed && !preference.snapshot.failed
    if (changedHead || addedRequest || newFailure) {
      reactivated.push(pull)
    } else if (JSON.stringify(current) !== JSON.stringify(preference.snapshot)) {
      // Record removals, recovery, and newly available baseline data. This
      // prevents an old request or failure from looking new if it returns.
      updates.push({ ...preference, snapshot: current })
    }
  }
  if (reactivated.length > 0) {
    const current = accountPreferences(preferences, account)
    const byId = new Map(current.map((row) => [row.pullId, row]))
    for (const row of updates) byId.set(row.pullId, row)
    for (const pull of reactivated) {
      byId.set(pull.id, createPreference(account, pull, "active", null, now))
    }
    const newlyActive = [...new Map(reactivated.map((pull) => [pull.id, pull])).values()]
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) ||
          a.repo.localeCompare(b.repo) ||
          a.number - b.number,
      )
      .map((pull) => pull.id)
    const priorActive = rankedPullIds(current, "activeOrder").filter(
      (id) => !newlyActive.includes(id),
    )
    const allUpdates = new Map(byId)
    renumber(allUpdates, [...newlyActive, ...priorActive], "activeOrder")
    renumber(
      allUpdates,
      rankedPullIds(current, "pinOrder").filter((id) => !newlyActive.includes(id)),
      "pinOrder",
    )
    updates.push(...[...allUpdates.values()].filter((row) => changedFrom(current, row)))
  }
  if (updates.length > 0) {
    const byId = new Map(updates.map((row) => [row.pullId, row]))
    await preferences.upsert([...byId.values()])
  }
}
