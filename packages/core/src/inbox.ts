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
}

export interface InboxPull {
  pull: PullRequest
  state: InboxState
  preference?: InboxPreference
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
  const preference = createPreference(
    accountLogin,
    pull,
    "snoozed",
    validateSnoozeExpiry(until, now),
    now,
  )
  await preferences.upsert([preference])
  return preference
}

export async function settleInboxPull(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  now = Date.now(),
): Promise<InboxPreference> {
  const preference = createPreference(accountLogin, pull, "settled", null, now)
  await preferences.upsert([preference])
  return preference
}

export async function restoreInboxPull(
  preferences: InboxPreferenceStore,
  accountLogin: string,
  pull: PullRequest,
  now = Date.now(),
): Promise<InboxPreference> {
  const preference = createPreference(accountLogin, pull, "active", null, now)
  await preferences.upsert([preference])
  return preference
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
  await preferences.upsert([{ ...previous, key, accountLogin: account, pullId }])
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
  const teamRequests = new Set(
    groups
      .filter((group) => group.kind === "team")
      .map((group) =>
        (group.id.startsWith("team:") ? group.id.slice(5) : group.name).toLowerCase(),
      ),
  )
  for (const preference of preferences.collection.values()) {
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
      updates.push(createPreference(account, pull, "active", null, now))
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
      updates.push(createPreference(account, pull, "active", null, now))
    } else if (JSON.stringify(current) !== JSON.stringify(preference.snapshot)) {
      // Record removals, recovery, and newly available baseline data. This
      // prevents an old request or failure from looking new if it returns.
      updates.push({ ...preference, snapshot: current })
    }
  }
  if (updates.length > 0) await preferences.upsert(updates)
}
