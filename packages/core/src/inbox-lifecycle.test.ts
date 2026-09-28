import { expect, test } from "vitest"
import { createCollections } from "./collections"
import type { PullRequest } from "./domain/types"
import {
  deriveInboxPulls,
  inboxPreferenceKey,
  pinInboxPull,
  reconcileInboxState,
  restoreInboxPull,
  setInboxSnoozed,
  settleInboxPull,
} from "./inbox"

const openedAt = "2026-09-28T10:00:00.000Z"
const closedAt = "2026-09-28T11:00:00.000Z"
const reopenedAt = "2026-09-28T12:00:00.000Z"
const pull = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  key: "me:PR_1",
  groupId: "me",
  id: "PR_1",
  repo: "acme/api",
  number: 1,
  title: "Change one",
  url: "https://github.com/acme/api/pull/1",
  author: "yi",
  authorAvatarUrl: null,
  isDraft: false,
  createdAt: openedAt,
  updatedAt: openedAt,
  syncedAt: openedAt,
  state: "OPEN",
  stateObservedAt: openedAt,
  headOid: "head-one",
  headRef: "feature",
  baseRef: "main",
  reviewDecision: "REVIEW_REQUIRED",
  checkState: "SUCCESS",
  labels: [],
  reviewRequests: [],
  comments: 0,
  additions: 1,
  deletions: 0,
  ...overrides,
})

for (const state of ["CLOSED", "MERGED"] as const) {
  test(`${state} is settled without a pre-existing local preference`, () => {
    const entries = deriveInboxPulls(
      [pull({ state, stateObservedAt: closedAt })],
      [],
      "yi",
      [],
      Date.parse(closedAt),
      "all",
    )
    expect(entries[0]?.state).toBe("settled")
  })

  test(`${state} overrides an expiring snooze and later check changes`, async () => {
    const { inboxPreferences } = createCollections()
    const open = pull()
    await setInboxSnoozed(inboxPreferences, "yi", open, closedAt, Date.parse(openedAt))
    const terminal = pull({ state, stateObservedAt: closedAt, syncedAt: closedAt })
    await reconcileInboxState(inboxPreferences, "yi", [terminal], Date.parse(closedAt))
    expect(inboxPreferences.collection.get(inboxPreferenceKey("yi", open.id))?.state).toBe(
      "settled",
    )
    await reconcileInboxState(
      inboxPreferences,
      "yi",
      [
        {
          ...terminal,
          headOid: "new-head",
          checkState: "FAILURE",
          reviewRequests: ["yi"],
          syncedAt: reopenedAt,
        },
      ],
      Date.parse(reopenedAt),
    )
    expect(inboxPreferences.collection.get(inboxPreferenceKey("yi", open.id))?.state).toBe(
      "settled",
    )
  })

  test(`${state} cannot be restored, pinned, or snoozed locally`, async () => {
    const { inboxPreferences } = createCollections()
    const terminal = pull({ state, stateObservedAt: closedAt })
    await settleInboxPull(inboxPreferences, "yi", terminal, Date.parse(closedAt))
    expect((await restoreInboxPull(inboxPreferences, "yi", terminal)).state).toBe("settled")
    await expect(pinInboxPull(inboxPreferences, "yi", terminal)).rejects.toThrow()
    await expect(
      setInboxSnoozed(inboxPreferences, "yi", terminal, reopenedAt, Date.parse(closedAt)),
    ).rejects.toThrow()
    expect(inboxPreferences.collection.get(inboxPreferenceKey("yi", terminal.id))?.state).toBe(
      "settled",
    )
  })
}

test("a stale group copy cannot revive a closed PR, but a confirmed reopening can", async () => {
  const { inboxPreferences } = createCollections()
  const closed = pull({ state: "CLOSED", stateObservedAt: closedAt, syncedAt: closedAt })
  await settleInboxPull(inboxPreferences, "yi", closed, Date.parse(closedAt))
  const stale = pull({ key: "org:acme:PR_1", groupId: "org:acme", updatedAt: reopenedAt })
  expect(
    deriveInboxPulls(
      [closed, stale],
      [],
      "yi",
      [...inboxPreferences.collection.values()],
      Date.parse(reopenedAt),
      "all",
    )[0]?.state,
  ).toBe("settled")
  const reopened = pull({ stateObservedAt: reopenedAt, syncedAt: reopenedAt })
  await reconcileInboxState(inboxPreferences, "yi", [reopened], Date.parse(reopenedAt))
  expect(inboxPreferences.collection.get(inboxPreferenceKey("yi", closed.id))?.state).toBe("active")
})

test("terminal reconciliation does not modify another account's preference", async () => {
  const { inboxPreferences } = createCollections()
  const open = pull()
  await setInboxSnoozed(inboxPreferences, "other", open, reopenedAt, Date.parse(openedAt))
  const before = JSON.parse(
    JSON.stringify(inboxPreferences.collection.get(inboxPreferenceKey("other", open.id))),
  )
  await reconcileInboxState(
    inboxPreferences,
    "yi",
    [pull({ state: "MERGED", stateObservedAt: closedAt })],
    Date.parse(closedAt),
  )
  expect(inboxPreferences.collection.get(inboxPreferenceKey("other", open.id))).toMatchObject(
    before,
  )
})

test("same-lifecycle copies use the freshest check and head snapshot", () => {
  const repositoryCopy = pull({
    key: "repo:acme/api:PR_1",
    groupId: "repo:acme/api",
    stateObservedAt: closedAt,
    syncedAt: closedAt,
  })
  const freshGroupCopy = pull({
    stateObservedAt: undefined,
    syncedAt: reopenedAt,
    headOid: "new-head",
    checkState: "FAILURE",
  })
  const entries = deriveInboxPulls(
    [repositoryCopy, freshGroupCopy],
    [],
    "yi",
    [],
    Date.parse(reopenedAt),
    "all",
  )
  expect(entries[0]?.pull).toMatchObject({ headOid: "new-head", checkState: "FAILURE" })
})

test("a fresher open snapshot retains another copy's newer lifecycle observation", async () => {
  const { inboxPreferences } = createCollections()
  const observedOpen = pull({ stateObservedAt: reopenedAt, syncedAt: reopenedAt })
  const freshSnapshot = pull({
    key: "org:acme:PR_1",
    groupId: "org:acme",
    stateObservedAt: undefined,
    syncedAt: "2026-09-28T13:00:00.000Z",
    headOid: "new-head",
  })
  const staleClosed = pull({
    key: "repo:acme/api:PR_1",
    groupId: "repo:acme/api",
    state: "CLOSED",
    stateObservedAt: closedAt,
  })
  await settleInboxPull(inboxPreferences, "yi", staleClosed, Date.parse(closedAt))
  for (const copies of [
    [observedOpen, freshSnapshot, staleClosed],
    [staleClosed, freshSnapshot, observedOpen],
  ]) {
    const entry = deriveInboxPulls(copies, [], "yi", [], Date.parse(reopenedAt), "all")[0]
    expect(entry?.pull).toMatchObject({
      state: "OPEN",
      stateObservedAt: reopenedAt,
      headOid: "new-head",
    })
    expect(entry?.state).toBe("active")
    await reconcileInboxState(inboxPreferences, "yi", copies, Date.parse(reopenedAt))
    expect(inboxPreferences.collection.get(inboxPreferenceKey("yi", observedOpen.id))?.state).toBe(
      "active",
    )
  }
})
