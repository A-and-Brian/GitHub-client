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
