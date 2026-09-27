import Database from "better-sqlite3"
import { expect, test, vi } from "vitest"
import { GitHubClient } from "./client"
import type { PullRequest } from "./domain/types"
import type { Platform } from "./platform"
import { fakeGitHub } from "./test/fake-github"
import { tempDatabase } from "./test/persistence"

function platform(
  stored: string | null,
  env: string | null,
  persistence?: Platform["persistence"],
): Platform {
  let token = stored
  return {
    fetch: fakeGitHub().fetch,
    secrets: {
      get: async () => token,
      set: async (t) => {
        token = t
      },
      clear: async () => {
        token = null
      },
    },
    envToken: async () => env,
    persistence,
  }
}

const pull: PullRequest = {
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
}

test("restore prefers the stored token and can skip GITHUB_TOKEN", async () => {
  expect(await new GitHubClient(platform("stored", "env")).auth.restore()).toBe(true)

  const envOnly = new GitHubClient(platform(null, "env"))
  expect(await envOnly.auth.restore({ allowEnv: false })).toBe(false)
  expect(await envOnly.auth.restore()).toBe(true)
  expect(envOnly.auth.getToken()).toBe("env")
})

test("sign-out forgets the token and deletes cached data and drafts", async () => {
  const client = new GitHubClient(platform("stored", null))
  await client.auth.restore()
  await client.collections.repos.upsert([
    {
      fullName: "a/b",
      owner: "a",
      name: "b",
      private: false,
      archived: false,
      defaultBranch: "main",
      pushedAt: null,
    },
  ])
  await client.collections.pullFiles.upsert([{ key: "a/b#1", headOid: "abc", files: [] }])
  await client.collections.inboxPreferences.upsert([
    {
      key: "yi:PR_1",
      accountLogin: "yi",
      pullId: "PR_1",
      state: "settled",
      snoozedUntil: null,
      snapshot: { headOid: null, reviewRequests: [], failed: false },
      changedAt: "2026-09-26T00:00:00Z",
    },
  ])
  client.addDraft({ prKey: "a/b#1", path: "x", line: 1, startLine: null, side: "RIGHT", body: "?" })

  await client.signOut()

  expect(client.auth.getToken()).toBeNull()
  expect(await client.platform.secrets.get()).toBeNull()
  expect(client.collections.repos.collection.size).toBe(0)
  expect(client.collections.inboxPreferences.collection.size).toBe(0)
  expect(client.collections.drafts.size).toBe(0)
})

test("pull hover prefetch joins the page sync and skips a completed cache", async () => {
  const github = fakeGitHub([
    {
      method: "POST",
      path: "/graphql",
      body: {
        data: {
          repository: {
            mergeCommitAllowed: true,
            squashMergeAllowed: true,
            rebaseMergeAllowed: false,
            pullRequest: {
              id: "PR_1",
              number: 7,
              title: "Prefetched",
              url: "https://github.com/acme/api/pull/7",
              state: "OPEN",
              isDraft: false,
              bodyHTML: "",
              createdAt: "2026-09-25T00:00:00Z",
              headRefName: "feature",
              headRefOid: "abc123",
              baseRefName: "main",
              baseRefOid: "def456",
              mergeable: "MERGEABLE",
              mergeStateStatus: "CLEAN",
              reviewDecision: null,
              viewerCanUpdate: true,
              additions: 1,
              deletions: 0,
              changedFiles: 0,
              author: null,
              timelineItems: { nodes: [] },
              reviewThreads: { nodes: [] },
              commits: { nodes: [] },
            },
          },
        },
      },
    },
    { path: "/repos/acme/api/pulls/7/files?per_page=100", body: [] },
  ])
  const client = new GitHubClient({
    ...platform("stored", null),
    fetch: github.fetch,
  })
  await client.auth.restore()

  await client.prefetchPull("acme/api", 7)
  expect(client.poller.status("pull:acme/api#7")).toBeUndefined()
  await Promise.all([
    client.collections.pullDetails.remove(["acme/api#7"]),
    client.collections.pullFiles.remove(["acme/api#7"]),
  ])

  const prefetch = client.prefetchPull("acme/api", 7)
  const releasePageWatch = client.watchPull("acme/api", 7)
  await prefetch
  await client.prefetchPull("acme/api", 7)

  expect(github.graphqlCalls()).toHaveLength(2)
  expect(client.collections.pullDetails.collection.get("acme/api#7")?.title).toBe("Prefetched")
  expect(client.collections.pullFiles.collection.get("acme/api#7")?.headOid).toBe("abc123")
  releasePageWatch()
  expect(client.poller.status("pull:acme/api#7")).toBeUndefined()
})

test("inbox mutations issue exact account-scoped undo tokens", async () => {
  const client = new GitHubClient(platform("stored", null))
  await client.ensureInboxOrder("yi", [{ pull, state: "active" }])
  await client.ensureInboxOrder("someone-else", [{ pull, state: "active" }])
  const otherBefore = client.collections.inboxPreferences.collection.get("someone-else:PR_1")
  const result = await client.pinInboxPull("yi", pull)

  expect(result.undo).toBeTruthy()
  expect(result.preference.pinOrder).toBe(0)
  expect(await client.undoInboxMutation(result.undo!)).toBe(true)
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")).toMatchObject({
    activeOrder: 0,
    pinOrder: undefined,
  })
  expect(client.collections.inboxPreferences.collection.get("someone-else:PR_1")).toMatchObject({
    accountLogin: otherBefore?.accountLogin,
    activeOrder: otherBefore?.activeOrder,
    pinOrder: otherBefore?.pinOrder,
  })
})

test("undo restores every row shifted by a reorder", async () => {
  const client = new GitHubClient(platform("stored", null))
  const pulls = [1, 2, 3].map((number) => ({
    ...pull,
    id: `PR_${number}`,
    key: `org:acme:PR_${number}`,
    number,
  }))
  await client.ensureInboxOrder(
    "yi",
    pulls.map((item) => ({ pull: item, state: "active" })),
  )
  const moved = await client.moveInboxPull("yi", pulls[2]!, {
    section: "active",
    beforePullId: pulls[0]!.id,
  })
  expect(
    [...client.collections.inboxPreferences.collection.values()]
      .filter((row) => row.accountLogin === "yi")
      .sort((a, b) => a.activeOrder! - b.activeOrder!)
      .map((row) => row.pullId),
  ).toEqual(["PR_3", "PR_1", "PR_2"])

  expect(await client.undoInboxMutation(moved.undo!)).toBe(true)
  expect(
    [...client.collections.inboxPreferences.collection.values()]
      .filter((row) => row.accountLogin === "yi")
      .sort((a, b) => a.activeOrder! - b.activeOrder!)
      .map((row) => row.pullId),
  ).toEqual(["PR_1", "PR_2", "PR_3"])
})

test("recent inbox actions for different pulls keep independent undo tokens", async () => {
  const client = new GitHubClient(platform("stored", null))
  const firstPull = { ...pull, id: "PR_1", key: "org:acme:PR_1", number: 1 }
  const secondPull = { ...pull, id: "PR_2", key: "org:acme:PR_2", number: 2 }
  await client.ensureInboxOrder("yi", [
    { pull: firstPull, state: "active" },
    { pull: secondPull, state: "active" },
  ])

  const first = await client.setInboxSnoozed(
    "yi",
    firstPull,
    new Date(Date.now() + 60_000).toISOString(),
  )
  const second = await client.setInboxSnoozed(
    "yi",
    secondPull,
    new Date(Date.now() + 120_000).toISOString(),
  )

  expect(first.undo).toBeTruthy()
  expect(second.undo).toBeTruthy()
  expect(await client.undoInboxMutation(first.undo!)).toBe(true)
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")?.state).toBe("active")
  expect(client.collections.inboxPreferences.collection.get("yi:PR_2")?.state).toBe("snoozed")
  expect(await client.undoInboxMutation(second.undo!)).toBe(true)
  expect(client.collections.inboxPreferences.collection.get("yi:PR_2")?.state).toBe("active")
})

test("a later edit to the same pull invalidates its earlier undo token", async () => {
  const client = new GitHubClient(platform("stored", null))
  await client.ensureInboxOrder("yi", [{ pull, state: "active" }])
  const first = await client.setInboxSnoozed(
    "yi",
    pull,
    new Date(Date.now() + 60_000).toISOString(),
  )
  const second = await client.setInboxSnoozed(
    "yi",
    pull,
    new Date(Date.now() + 120_000).toISOString(),
  )

  expect(await client.undoInboxMutation(first.undo!)).toBe(false)
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")?.snoozedUntil).toBe(
    second.preference.snoozedUntil,
  )
  expect(await client.undoInboxMutation(second.undo!)).toBe(true)
})

test("stale and expired queued inbox undo tokens are rejected", async () => {
  const client = new GitHubClient(platform("stored", null))
  await client.ensureInboxOrder("yi", [{ pull: { ...pull, headOid: "old-head" }, state: "active" }])
  const settled = await client.settleInboxPull("yi", { ...pull, headOid: "old-head" })
  await client.reconcileInboxState("yi", [
    { ...pull, headOid: "new-head", syncedAt: new Date(Date.now() + 1_000).toISOString() },
  ])
  expect(await client.undoInboxMutation(settled.undo!)).toBe(false)
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")?.state).toBe("active")

  await client.settleInboxPull("yi", { ...pull, headOid: "new-head" })
  const next = await client.restoreInboxPull("yi", { ...pull, headOid: "new-head" })
  let unblock!: () => void
  const gate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  const internals = client as unknown as {
    enqueueInbox<T>(operation: () => Promise<T>): Promise<T>
  }
  const blocked = internals.enqueueInbox(() => gate)
  const queuedUndo = client.undoInboxMutation(next.undo!)
  const clock = vi.spyOn(Date, "now").mockReturnValue(next.undo!.expiresAt + 1)
  unblock()
  await blocked
  try {
    expect(await queuedUndo).toBe(false)
  } finally {
    clock.mockRestore()
  }
})

test("failed durable inbox writes roll back the visible preference and can retry", async () => {
  const db = tempDatabase()
  try {
    const client = new GitHubClient(platform("stored", null, db.open()))
    await client.ensureInboxOrder("yi", [{ pull, state: "active" }])
    const triggerDb = new Database(db.file)
    const table = triggerDb
      .prepare("SELECT table_name FROM collection_registry WHERE collection_id = ?")
      .get("inbox-preferences") as { table_name: string }
    triggerDb.exec(
      `CREATE TRIGGER fail_inbox_update BEFORE INSERT ON "${table.table_name}" BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;`,
    )
    const observedStates: string[] = []
    const subscription = client.collections.inboxPreferences.collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.key === "yi:PR_1" && change.type !== "delete") {
            observedStates.push(change.value.state)
          }
        }
      },
    )

    const error = await client.settleInboxPull("yi", pull).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("injected persistence failure")
    expect(client.collections.inboxPreferences.collection.get("yi:PR_1")).toMatchObject({
      state: "active",
      activeOrder: 0,
    })
    expect(observedStates).toContain("settled")
    expect(observedStates.at(-1)).toBe("active")

    const reloaded = new GitHubClient(platform(null, null, db.open()))
    await reloaded.collections.inboxPreferences.collection.preload()
    expect(reloaded.collections.inboxPreferences.collection.get("yi:PR_1")).toMatchObject({
      state: "active",
      activeOrder: 0,
    })
    subscription.unsubscribe()

    triggerDb.exec("DROP TRIGGER fail_inbox_update")
    triggerDb.close()
    const retried = await client.settleInboxPull("yi", pull)
    expect(retried.preference.state).toBe("settled")
    expect(client.collections.inboxPreferences.collection.get("yi:PR_1")?.state).toBe("settled")
  } finally {
    db.close()
  }
})
