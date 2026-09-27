import { expect, test } from "vitest"
import { GitHubClient } from "./client"
import type { Platform } from "./platform"
import { fakeGitHub } from "./test/fake-github"

function platform(stored: string | null, env: string | null): Platform {
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
  }
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
