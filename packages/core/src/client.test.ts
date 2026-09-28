import Database from "better-sqlite3"
import { expect, test, vi } from "vitest"
import { GitHubClient, jobKeys } from "./client"
import type { PullRequest, PullRequestDetail } from "./domain/types"
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

test("prepareSync removes only legacy starred rows and is safe to repeat", async () => {
  const client = new GitHubClient(platform("stored", null))
  const orgPull = { ...pull, key: "org:acme:PR_1", groupId: "org:acme" }
  const personalPull = { ...pull, key: "me:PR_1", groupId: "me" }
  const starredPull = { ...pull, key: "starred:PR_1", groupId: "starred" }
  const starredOnlyPull = {
    ...pull,
    key: "starred:PR_2",
    groupId: "starred",
    id: "PR_2",
    number: 2,
  }
  await client.collections.groups.upsert([
    { id: "me", kind: "me", name: "Involving me", order: 0 },
    { id: "org:acme", kind: "org", name: "acme", org: "acme", order: 100 },
    { id: "starred", kind: "starred", name: "Starred", order: 10000, repos: ["acme/api"] },
  ])
  await client.collections.pulls.upsert([orgPull, personalPull, starredPull, starredOnlyPull])
  await client.collections.repos.upsert([
    {
      fullName: "acme/api",
      owner: "acme",
      name: "api",
      private: false,
      archived: false,
      defaultBranch: "main",
      pushedAt: null,
    },
  ])
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
  await client.collections.pullFiles.upsert([{ key: "acme/api#1", headOid: "abc", files: [] }])
  client.addDraft({
    prKey: "acme/api#1",
    path: "src/index.ts",
    line: 1,
    startLine: null,
    side: "RIGHT",
    body: "Keep this draft",
  })

  await client.prepareSync()
  await client.prepareSync()

  expect(client.collections.groups.collection.has("starred")).toBe(false)
  expect(client.collections.groups.collection.has("org:acme")).toBe(true)
  expect(client.collections.pulls.collection.has("starred:PR_1")).toBe(false)
  expect(client.collections.pulls.collection.has("starred:PR_2")).toBe(false)
  expect(client.collections.pulls.collection.has("org:acme:PR_1")).toBe(true)
  expect(client.collections.pulls.collection.has("me:PR_1")).toBe(true)
  expect(client.collections.repos.collection.has("acme/api")).toBe(true)
  expect(client.collections.inboxPreferences.collection.has("yi:PR_1")).toBe(true)
  expect(client.collections.pullFiles.collection.has("acme/api#1")).toBe(true)
  expect([...client.collections.drafts.values()].map((draft) => draft.body)).toEqual([
    "Keep this draft",
  ])
})

test("prepareSync persists legacy starred cleanup before a new client loads", async () => {
  const db = tempDatabase()
  try {
    const client = new GitHubClient(platform("stored", null, db.open()))
    await client.collections.groups.upsert([
      { id: "starred", kind: "starred", name: "Starred", order: 10000, repos: ["oss/lib"] },
      { id: "org:acme", kind: "org", name: "acme", org: "acme", order: 100 },
    ])
    await client.collections.pulls.upsert([
      { ...pull, key: "starred:PR_1", groupId: "starred" },
      { ...pull, key: "org:acme:PR_1", groupId: "org:acme" },
    ])

    await client.prepareSync()

    const reloaded = new GitHubClient(platform(null, null, db.open()))
    await Promise.all([
      reloaded.collections.groups.collection.preload(),
      reloaded.collections.pulls.collection.preload(),
    ])
    expect(reloaded.collections.groups.collection.has("starred")).toBe(false)
    expect(reloaded.collections.groups.collection.has("org:acme")).toBe(true)
    expect(reloaded.collections.pulls.collection.has("starred:PR_1")).toBe(false)
    expect(reloaded.collections.pulls.collection.has("org:acme:PR_1")).toBe(true)
  } finally {
    db.close()
  }
})

test("legacy starred groups never register, watch, or refresh a pull search", async () => {
  const github = fakeGitHub([
    { path: "/user/orgs?per_page=100", status: 500 },
    { path: "/user/teams?per_page=100", status: 500 },
  ])
  const client = new GitHubClient({ ...platform("stored", null), fetch: github.fetch })
  await client.collections.groups.upsert([
    { id: "starred", kind: "starred", name: "Starred", order: 10000, repos: ["oss/lib"] },
  ])
  await client.auth.restore()

  client.startSync()
  const release = client.watchGroup("starred")
  await client.refresh(jobKeys.groupPulls("starred"))
  await client.refresh(jobKeys.groups)
  client.poller.stop()
  release()

  expect(github.graphqlCalls().map((request) => request.body)).toEqual([])
  expect(github.requests.some((request) => request.path.startsWith("/user/starred"))).toBe(false)
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

function mergeDetail(): PullRequestDetail {
  return {
    key: "acme/api#1",
    id: "PR_1",
    repo: "acme/api",
    number: 1,
    title: "Change one",
    url: "https://github.com/acme/api/pull/1",
    state: "OPEN",
    isDraft: false,
    author: { login: "octo", avatarUrl: "" },
    bodyHTML: "",
    createdAt: pull.createdAt,
    headRef: pull.headRef,
    headOid: "head-1",
    baseRef: pull.baseRef,
    baseOid: "base-1",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "REVIEW_REQUIRED",
    mergeMethods: ["merge"],
    viewerCanUpdate: true,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    timeline: [],
    threads: [],
    checks: [],
  }
}

test("confirmed merge settles the current account immediately; rejected merge does not", async () => {
  const github = fakeGitHub([{ method: "PUT", path: "/repos/acme/api/pulls/1/merge", status: 204 }])
  const client = new GitHubClient({ ...platform("stored", null), fetch: github.fetch })
  await client.auth.restore()
  await client.collections.pulls.upsert([pull])
  await client.collections.pullDetails.upsert([mergeDetail()])
  await client.ensureInboxOrder("Yi", [{ pull, state: "active" }])

  expect(await client.merge("acme/api", 1, "merge", "Yi")).toEqual({})
  expect(client.collections.pulls.collection.get(pull.key)?.state).toBe("MERGED")
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")).toMatchObject({
    accountLogin: "yi",
    state: "settled",
    terminalState: "MERGED",
  })

  const rejected = fakeGitHub([
    {
      method: "PUT",
      path: "/repos/acme/api/pulls/1/merge",
      status: 409,
      body: { message: "head moved" },
    },
  ])
  const second = new GitHubClient({ ...platform("stored", null), fetch: rejected.fetch })
  await second.auth.restore()
  await second.collections.pulls.upsert([pull])
  await second.collections.pullDetails.upsert([mergeDetail()])
  await second.ensureInboxOrder("yi", [{ pull, state: "active" }])
  await expect(second.merge("acme/api", 1, "merge", "yi")).rejects.toThrow("head moved")
  expect(second.collections.pulls.collection.get(pull.key)?.state ?? "OPEN").toBe("OPEN")
  expect(second.collections.inboxPreferences.collection.get("yi:PR_1")?.state).toBe("active")
})

test("merge reports local save failures and exposes its confirmed state in memory", async () => {
  const db = tempDatabase()
  try {
    const github = fakeGitHub([
      { method: "PUT", path: "/repos/acme/api/pulls/1/merge", status: 204 },
    ])
    const client = new GitHubClient({ ...platform("stored", null, db.open()), fetch: github.fetch })
    await client.auth.restore()
    await client.collections.pulls.upsert([pull])
    await client.collections.pullDetails.upsert([mergeDetail()])
    await client.ensureInboxOrder("yi", [{ pull, state: "active" }])
    const connection = new Database(db.file)
    const { table_name: table } = connection
      .prepare("SELECT table_name FROM collection_registry WHERE collection_id = ?")
      .get("inbox-preferences") as { table_name: string }
    const { table_name: pullTable } = connection
      .prepare("SELECT table_name FROM collection_registry WHERE collection_id = ?")
      .get("pulls") as { table_name: string }
    connection.exec(
      `CREATE TRIGGER fail_inbox_update BEFORE INSERT ON "${table}" BEGIN SELECT RAISE(ABORT, 'inbox save failed'); END;`,
    )
    connection.exec(
      `CREATE TRIGGER fail_pull_update BEFORE INSERT ON "${pullTable}" BEGIN SELECT RAISE(ABORT, 'pull save failed'); END;`,
    )

    let lifecycleNotified = false
    const unsubscribe = client.subscribeInboxLifecycle(() => {
      lifecycleNotified = true
    })
    const result = await client.merge("acme/api", 1, "merge", "yi")
    expect(result.inboxError).toBeInstanceOf(Error)
    expect((result.inboxError as Error).message).toContain("pull save failed")
    expect(github.requests.filter((request) => request.method === "PUT")).toHaveLength(1)
    expect(client.collections.pulls.collection.get(pull.key)?.state ?? "OPEN").toBe("OPEN")
    expect(client.applyConfirmedInboxLifecycles([pull])[0]?.state).toBe("MERGED")
    expect(lifecycleNotified).toBe(true)
    unsubscribe()
    connection.close()
  } finally {
    db.close()
  }
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

function approvalClient() {
  const requests: Array<{ method: string; path: string }> = []
  let rejectApproval = false
  const base = platform(null, null)
  const client = new GitHubClient({
    ...base,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname
      const method = init?.method ?? "GET"
      requests.push({ method, path })
      if (method === "POST") {
        return rejectApproval
          ? new Response(JSON.stringify({ message: "Approval forbidden" }), { status: 403 })
          : new Response(null, { status: 201 })
      }
      return new Response(
        JSON.stringify(path.endsWith("/jobs") ? { jobs: [] } : { workflow_runs: [] }),
      )
    },
  })
  return {
    client,
    requests,
    reject() {
      rejectApproval = true
    },
  }
}

test("approval refreshes repository runs and run jobs after success", async () => {
  const { client, requests } = approvalClient()
  const stopRuns = client.watchRuns("acme/api")
  const stopJobs = client.watchRunJobs("acme/api", 42)
  await Promise.all([client.refresh("runs:acme/api"), client.refresh("run-jobs:42")])
  requests.length = 0

  await client.approveRun("acme/api", 42)

  expect(requests).toEqual(
    expect.arrayContaining([
      { method: "POST", path: "/repos/acme/api/actions/runs/42/approve" },
      { method: "GET", path: "/repos/acme/api/actions/runs" },
      { method: "GET", path: "/repos/acme/api/actions/runs/42/jobs" },
    ]),
  )
  stopRuns()
  stopJobs()
})

test("approval failure does not refresh runs or jobs", async () => {
  const { client, requests, reject } = approvalClient()
  const stopRuns = client.watchRuns("acme/api")
  const stopJobs = client.watchRunJobs("acme/api", 42)
  await Promise.all([client.refresh("runs:acme/api"), client.refresh("run-jobs:42")])
  requests.length = 0
  reject()

  await expect(client.approveRun("acme/api", 42)).rejects.toThrow("Approval forbidden")

  expect(requests).toEqual([{ method: "POST", path: "/repos/acme/api/actions/runs/42/approve" }])
  stopRuns()
  stopJobs()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("a slow group search leaves local settlement responsive and cannot restore data after sign-out", async () => {
  const started = deferred<void>()
  const response = deferred<Response>()
  const client = new GitHubClient({
    ...platform("stored", null),
    fetch: async (input, init) => {
      if (String(input).endsWith("/graphql") && String(init?.body).includes("SearchPulls")) {
        started.resolve()
        return response.promise
      }
      return new Response("{}", { status: 404 })
    },
  })
  await client.auth.restore()
  await client.collections.groups.upsert([
    { id: "org:acme", kind: "org", name: "acme", org: "acme", order: 0 },
  ])
  await client.collections.pulls.upsert([pull])
  await client.ensureInboxOrder("yi", [{ pull, state: "active" }])
  const release = client.watchGroup("org:acme")
  const refresh = client.refresh(jobKeys.groupPulls("org:acme"))
  await started.promise

  await client.settleInboxPull("yi", pull)
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")?.state).toBe("settled")
  await client.signOut()
  response.resolve(
    new Response(
      JSON.stringify({
        data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
      }),
    ),
  )
  await refresh
  release()
  expect(client.collections.pulls.collection.size).toBe(0)
  expect(client.collections.inboxPreferences.collection.size).toBe(0)
})

test("a stale repository open page cannot undo closure, while a later one reopens it", async () => {
  const client = new GitHubClient(platform("stored", null))
  await client.auth.restore()
  const closedAt = "2026-09-28T11:00:00.000Z"
  const closed = { ...pull, state: "CLOSED" as const, stateObservedAt: closedAt }
  await client.collections.pulls.upsert([closed])
  await client.settleInboxPull("yi", closed)

  await client.syncRepositoryInbox("yi", "acme/api", [{ ...pull, state: "OPEN" }], {
    complete: false,
    observedAt: "2026-09-28T10:00:00.000Z",
  })
  expect(client.collections.pulls.collection.get("repo:acme/api:PR_1")?.state).toBe("CLOSED")

  await client.syncRepositoryInbox("yi", "acme/api", [{ ...pull, state: "OPEN" }], {
    complete: false,
    observedAt: "2026-09-28T12:00:00.000Z",
  })
  expect(client.collections.pulls.collection.get("repo:acme/api:PR_1")).toMatchObject({
    state: "OPEN",
    stateObservedAt: "2026-09-28T12:00:00.000Z",
  })
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")?.state).toBe("active")
})

test("detail and file requests leave local actions responsive and discard a signed-out file response", async () => {
  const detailStarted = deferred<void>()
  const detailResponse = deferred<Response>()
  const filesStarted = deferred<void>()
  const filesResponse = deferred<Response>()
  const client = new GitHubClient({
    ...platform("stored", null),
    fetch: async (input, init) => {
      const url = String(input)
      if (url.endsWith("/graphql") && String(init?.body).includes("PullDetail")) {
        detailStarted.resolve()
        return detailResponse.promise
      }
      if (url.includes("/pulls/1/files")) {
        filesStarted.resolve()
        return filesResponse.promise
      }
      return new Response("{}", { status: 404 })
    },
  })
  await client.auth.restore()
  await client.collections.pulls.upsert([pull])
  await client.ensureInboxOrder("yi", [{ pull, state: "active" }])
  const prefetch = client.prefetchPull("acme/api", 1)
  await detailStarted.promise
  await client.settleInboxPull("yi", pull)
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")?.state).toBe("settled")

  const detail = mergeDetail()
  detailResponse.resolve(
    new Response(
      JSON.stringify({
        data: {
          repository: {
            mergeCommitAllowed: true,
            squashMergeAllowed: true,
            rebaseMergeAllowed: true,
            pullRequest: {
              ...detail,
              headRefName: detail.headRef,
              headRefOid: detail.headOid,
              baseRefName: detail.baseRef,
              baseRefOid: detail.baseOid,
              timelineItems: { nodes: [] },
              reviewThreads: { nodes: [] },
              commits: { nodes: [] },
            },
          },
        },
      }),
    ),
  )
  await filesStarted.promise
  await client.restoreInboxPull("yi", pull)
  expect(client.collections.inboxPreferences.collection.get("yi:PR_1")?.state).toBe("active")

  await client.signOut()
  filesResponse.resolve(new Response("[]"))
  await prefetch
  expect(client.collections.pullDetails.collection.size).toBe(0)
  expect(client.collections.pullFiles.collection.size).toBe(0)
})
