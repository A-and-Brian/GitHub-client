import { afterEach, expect, test, vi } from "vitest"
import { GitHubClient } from "./client"
import type { PullRequest, PullRequestDetail } from "./domain/types"
import type { Platform } from "./platform"
import { fakeGitHub } from "./test/fake-github"
import { tempDatabase } from "./test/persistence"

const databases: ReturnType<typeof tempDatabase>[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) database.close()
})

function platform(persistence: Platform["persistence"]): Platform {
  let token: string | null = "token"
  return {
    fetch: fakeGitHub().fetch,
    secrets: {
      get: async () => token,
      set: async (value) => {
        token = value
      },
      clear: async () => {
        token = null
      },
    },
    envToken: async () => null,
    persistence,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const pull: PullRequest = {
  key: "repo:acme/api:PR_1",
  groupId: "repo:acme/api",
  id: "PR_1",
  repo: "acme/api",
  number: 1,
  title: "Old account result",
  url: "https://github.com/acme/api/pull/1",
  author: "octo",
  authorAvatarUrl: null,
  isDraft: false,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  headRef: "feature",
  baseRef: "main",
  reviewDecision: null,
  checkState: null,
  labels: [],
  reviewRequests: [],
  comments: 0,
  additions: 1,
  deletions: 0,
}

test("a deferred repository inbox sync finishes in its original account scope", async () => {
  const file = tempDatabase()
  databases.push(file)
  const client = new GitHubClient(platform(file.open()))
  await client.auth.restore()
  await client.activateAccount("yi")

  const enteredPreload = deferred<void>()
  const releasePreload = deferred<void>()
  const collection = client.collections.inboxPreferences.collection
  const preload = collection.preload.bind(collection)
  vi.spyOn(collection, "preload").mockImplementation(async () => {
    enteredPreload.resolve()
    await releasePreload.promise
    return preload()
  })

  const sync = client.syncRepositoryInbox("yi", "acme/api", [pull], { complete: false })
  await enteredPreload.promise
  const switched = client.activateAccount("bob")
  releasePreload.resolve()
  await Promise.all([sync, switched])

  expect(client.collections.pulls.collection.size).toBe(0)
  await client.activateAccount("yi")
  expect(client.collections.pulls.collection.get("repo:acme/api:PR_1")?.title).toBe(
    "Old account result",
  )
})

test("a review response cannot delete the new account's draft with the same ID", async () => {
  const file = tempDatabase()
  databases.push(file)
  const requestStarted = deferred<void>()
  const response = deferred<Response>()
  const client = new GitHubClient({
    ...platform(file.open()),
    fetch: async (input) => {
      if (String(input).endsWith("/repos/acme/api/pulls/1/reviews")) {
        requestStarted.resolve()
        return response.promise
      }
      return new Response("{}", { status: 404 })
    },
  })
  await client.auth.restore()
  await client.activateAccount("yi")

  const repo = {
    fullName: "acme/api",
    owner: "acme",
    name: "api",
    private: false,
    archived: false,
    defaultBranch: "main",
    pushedAt: null,
  }
  const detail: PullRequestDetail = {
    key: "acme/api#1",
    id: "PR_1",
    repo: "acme/api",
    number: 1,
    title: "Change one",
    url: "https://github.com/acme/api/pull/1",
    state: "OPEN",
    isDraft: false,
    author: null,
    bodyHTML: "",
    createdAt: "2026-09-01T10:00:00Z",
    headRef: "feature",
    headOid: "head-1",
    baseRef: "main",
    baseOid: "base-1",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    mergeMethods: ["squash"],
    viewerCanUpdate: true,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    timeline: [],
    threads: [],
    checks: [],
  }
  const draft = {
    id: "shared-draft-id",
    prKey: "acme/api#1",
    path: "src/index.ts",
    line: 12,
    startLine: null,
    side: "RIGHT" as const,
    body: "Yi's draft",
    commitId: "head-1",
    createdAt: "2026-09-29T10:01:00Z",
  }
  await client.collections.repos.upsert([repo])
  await client.collections.pulls.upsert([pull])
  await client.collections.pullDetails.upsert([detail])
  await client.collections.drafts.insert(draft).isPersisted.promise
  const refresh = vi.spyOn(client, "refresh").mockResolvedValue()

  const submission = client.submitReview("acme/api", 1, "COMMENT", "Review")
  await requestStarted.promise
  await client.activateAccount("bob")
  await client.collections.repos.upsert([repo])
  await client.collections.pulls.upsert([pull])
  await client.collections.drafts.insert({ ...draft, body: "Bob's draft" }).isPersisted.promise

  response.resolve(new Response(null, { status: 204 }))
  await submission

  expect(client.collections.drafts.get("shared-draft-id")?.body).toBe("Bob's draft")
  expect(refresh).not.toHaveBeenCalled()
  await client.activateAccount("yi")
  expect(client.collections.drafts.get("shared-draft-id")?.body).toBe("Yi's draft")
})
