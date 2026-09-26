import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createCollections } from "./collections"
import type { Group, PullRequest } from "./domain/types"
import type { InboxPreferenceStore } from "./inbox"
import {
  deriveInboxPulls,
  inboxPreferenceKey,
  reconcileInboxState,
  restoreInboxPreference,
  restoreInboxPull,
  setInboxSnoozed,
  settleInboxPull,
} from "./inbox"
import { tempDatabase } from "./test/persistence"

const pull = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  key: "org:acme:PR_1",
  groupId: "org:acme",
  id: "PR_1",
  repo: "acme/api",
  number: 1,
  title: "Change one",
  url: "https://github.com/acme/api/pull/1",
  author: "octo",
  authorAvatarUrl: null,
  isDraft: false,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
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

const org: Group = { id: "org:acme", kind: "org", name: "acme", org: "acme", order: 1 }
const team: Group = {
  id: "team:acme/core",
  kind: "team",
  name: "Core",
  org: "acme",
  order: 2,
  repos: [],
}

let db: ReturnType<typeof tempDatabase>
beforeEach(() => {
  db = tempDatabase()
})
afterEach(() => db.close())

describe("PR inbox", () => {
  test("deduplicates group copies and includes authored, user-requested and known team-requested PRs", () => {
    const orgCopy = pull({ checkState: "SUCCESS", syncedAt: "2026-09-26T10:00:00Z" })
    const teamCopy = pull({
      key: "team:acme/core:PR_1",
      groupId: "team:acme/core",
      checkState: "FAILURE",
      syncedAt: "2026-09-26T10:01:00Z",
    })
    const authored = pull({ id: "PR_2", key: "org:acme:PR_2", author: "Yi" })
    const requested = pull({
      id: "PR_3",
      key: "org:acme:PR_3",
      reviewRequests: ["yi"],
    })
    const teamRequested = pull({
      id: "PR_4",
      key: "org:acme:PR_4",
      reviewRequests: ["acme/core"],
    })
    const unrelated = pull({
      id: "PR_5",
      key: "org:acme:PR_5",
      reviewRequests: ["acme/design"],
    })

    const all = deriveInboxPulls(
      [orgCopy, teamCopy, authored, requested, teamRequested, unrelated],
      [org, team],
      "yi",
      [],
      Date.now(),
      "all",
    )
    expect(all).toHaveLength(5)
    expect(all.find((row) => row.pull.id === "PR_1")?.pull.checkState).toBe("FAILURE")

    const involving = deriveInboxPulls(
      [orgCopy, teamCopy, authored, requested, teamRequested, unrelated],
      [org, team],
      "yi",
      [],
      Date.now(),
      "involving",
    )
    expect(involving.map((row) => row.pull.id).sort()).toEqual(["PR_2", "PR_3", "PR_4"])
  })

  test("keeps me-group involvement when a fresher duplicate comes from another group", () => {
    const meCopy = pull({
      id: "PR_6",
      key: "me:PR_6",
      groupId: "me",
      author: "someone-else",
      syncedAt: "2026-09-26T10:00:00Z",
    })
    const orgCopy = pull({
      id: "PR_6",
      key: "org:acme:PR_6",
      author: "someone-else",
      syncedAt: "2026-09-26T10:01:00Z",
    })

    const rows = deriveInboxPulls([meCopy, orgCopy], [org], "yi", [], Date.now(), "involving")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ pull: { groupId: "org:acme" }, state: "active" })
  })

  test("uses the fresher check snapshot when duplicate rows share updatedAt", async () => {
    const collections = createCollections(db.open())
    const baseline = pull({ checkState: "SUCCESS" })
    await settleInboxPull(collections.inboxPreferences, "yi", baseline, 100)
    const staleFailure = pull({
      checkState: "FAILURE",
      syncedAt: "2026-09-26T10:00:00Z",
    })
    const freshSuccess = pull({
      checkState: "SUCCESS",
      syncedAt: "2026-09-26T10:01:00Z",
    })

    const rows = deriveInboxPulls(
      [staleFailure, freshSuccess],
      [org],
      "yi",
      [...collections.inboxPreferences.collection.values()],
      Date.now(),
      "all",
    )
    expect(rows[0]?.pull.checkState).toBe("SUCCESS")
    await reconcileInboxState(collections.inboxPreferences, "yi", [staleFailure, freshSuccess], 200)
    expect([...collections.inboxPreferences.collection.values()][0]?.state).toBe("settled")
  })

  test("persists snooze by account and returns it to Active after expiry", async () => {
    const first = createCollections(db.open())
    await setInboxSnoozed(first.inboxPreferences, "Yi", pull(), "2026-09-26T12:00:00Z", 0)
    await first.inboxPreferences.collection.cleanup()
    db.close()

    const second = createCollections(db.open())
    await second.inboxPreferences.collection.preload()
    const prefs = [...second.inboxPreferences.collection.values()]
    expect(prefs).toHaveLength(1)
    expect(prefs[0]?.key).toBe(inboxPreferenceKey("yi", "PR_1"))
    expect(
      deriveInboxPulls([pull()], [org], "yi", prefs, Date.parse("2026-09-26T11:59:59Z"), "all")[0]
        ?.state,
    ).toBe("snoozed")

    await reconcileInboxState(
      second.inboxPreferences,
      "someone-else",
      [pull()],
      Date.parse("2026-09-26T12:00:00Z"),
    )
    expect([...second.inboxPreferences.collection.values()][0]?.state).toBe("snoozed")
    await reconcileInboxState(
      second.inboxPreferences,
      "yi",
      [pull()],
      Date.parse("2026-09-26T12:00:00Z"),
    )
    expect([...second.inboxPreferences.collection.values()][0]?.state).toBe("active")
  })

  test("rejects snooze expiries that are not in the future", async () => {
    const attemptedWrites: unknown[] = []
    const preferences = {
      upsert: async (rows: unknown[]) => {
        attemptedWrites.push(...rows)
      },
    } as unknown as InboxPreferenceStore
    await expect(
      setInboxSnoozed(
        preferences,
        "yi",
        pull(),
        "2026-09-26T12:00:00Z",
        Date.parse("2026-09-26T12:00:00Z"),
      ),
    ).rejects.toThrow("future date")
    expect(attemptedWrites).toEqual([])
  })

  test("settled PRs reactivate on new head, new request or newly observed failure once", async () => {
    const collections = createCollections(db.open())
    const initial = pull({
      headOid: "abc",
      checkState: "FAILURE",
      reviewRequests: ["yi"],
    })
    await settleInboxPull(collections.inboxPreferences, "yi", initial, 100)

    await reconcileInboxState(
      collections.inboxPreferences,
      "yi",
      [pull({ ...initial, updatedAt: "2026-09-26T00:00:00Z" })],
      200,
    )
    expect([...collections.inboxPreferences.collection.values()][0]?.state).toBe("settled")

    await reconcileInboxState(
      collections.inboxPreferences,
      "yi",
      [pull({ ...initial, checkState: "SUCCESS" })],
      300,
    )
    expect([...collections.inboxPreferences.collection.values()][0]?.state).toBe("settled")
    await reconcileInboxState(
      collections.inboxPreferences,
      "yi",
      [pull({ ...initial, checkState: "ERROR" })],
      400,
    )
    expect([...collections.inboxPreferences.collection.values()][0]?.state).toBe("active")
    await settleInboxPull(
      collections.inboxPreferences,
      "yi",
      pull({ ...initial, checkState: "ERROR" }),
      500,
    )
    await reconcileInboxState(
      collections.inboxPreferences,
      "yi",
      [pull({ ...initial, checkState: "ERROR", headOid: "def" })],
      600,
    )
    expect([...collections.inboxPreferences.collection.values()][0]?.state).toBe("active")
  })

  test("advances the settled snapshot through unrelated requests and recovery", async () => {
    const collections = createCollections(db.open())
    const initial = pull({ headOid: "abc", reviewRequests: ["yi"] })
    await settleInboxPull(collections.inboxPreferences, "yi", initial, 100)

    const unrelatedRequest = pull({ ...initial, reviewRequests: ["yi", "acme/design"] })
    await reconcileInboxState(collections.inboxPreferences, "yi", [unrelatedRequest], 200, [team])
    expect([...collections.inboxPreferences.collection.values()][0]?.state).toBe("settled")
    expect(
      [...collections.inboxPreferences.collection.values()][0]?.snapshot.reviewRequests,
    ).toEqual(["acme/design", "yi"])

    const relevantRequest = pull({
      ...unrelatedRequest,
      reviewRequests: ["yi", "acme/design", "acme/core"],
    })
    await reconcileInboxState(collections.inboxPreferences, "yi", [relevantRequest], 300, [team])
    expect([...collections.inboxPreferences.collection.values()][0]?.state).toBe("active")
  })

  test("restore records Active locally without changing GitHub PR data", async () => {
    const collections = createCollections(db.open())
    await settleInboxPull(collections.inboxPreferences, "yi", pull(), 100)
    await restoreInboxPull(collections.inboxPreferences, "yi", pull(), 200)
    expect([...collections.inboxPreferences.collection.values()][0]).toMatchObject({
      state: "active",
      pullId: "PR_1",
    })
  })

  test("does not restore a preference captured for another account or PR", async () => {
    const collections = createCollections(db.open())
    const yiPreference = await settleInboxPull(collections.inboxPreferences, "yi", pull(), 100)
    const otherAccountPreference = await settleInboxPull(
      collections.inboxPreferences,
      "someone-else",
      pull(),
      100,
    )
    await expect(
      restoreInboxPreference(collections.inboxPreferences, "yi", "PR_1", {
        ...yiPreference,
        accountLogin: "someone-else",
        key: inboxPreferenceKey("someone-else", "PR_1"),
      }),
    ).rejects.toThrow("does not match")
    expect(
      collections.inboxPreferences.collection.get(inboxPreferenceKey("yi", "PR_1")),
    ).toMatchObject({
      accountLogin: "yi",
      state: "settled",
    })
    expect(collections.inboxPreferences.collection.get(otherAccountPreference.key)?.state).toBe(
      "settled",
    )
  })

  test("ignores a cached PR row observed before it was settled", async () => {
    const collections = createCollections(db.open())
    await settleInboxPull(collections.inboxPreferences, "yi", pull({ checkState: "SUCCESS" }), 1000)
    await reconcileInboxState(
      collections.inboxPreferences,
      "yi",
      [pull({ checkState: "FAILURE", syncedAt: "1970-01-01T00:00:00.500Z" })],
      2000,
    )
    expect([...collections.inboxPreferences.collection.values()][0]?.state).toBe("settled")
  })
})
