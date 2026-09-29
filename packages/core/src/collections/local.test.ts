import { afterEach, expect, test } from "vitest"
import type { PullRequest } from "../domain/types"
import { tempDatabase } from "../test/persistence"
import { createCollections } from "./index"

const databases: ReturnType<typeof tempDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

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

test("local preferences, drafts, and viewed files share PR identity across restart and account scopes", async () => {
  const file = tempDatabase()
  databases.push(file)
  const first = createCollections(file.open())
  await first.database.setScope("https://api.github.com", "Yi")
  await first.database.ready()
  await first.repos.upsert([
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
  await first.pulls.upsert([pull])
  await first.inboxPreferences.upsert([
    {
      key: "yi:PR_1",
      accountLogin: "Yi",
      pullId: "PR_1",
      state: "snoozed",
      snoozedUntil: "2026-10-01T00:00:00Z",
      snapshot: { headOid: "head-1", reviewRequests: [], failed: false },
      changedAt: "2026-09-29T10:00:00Z",
      activeOrder: 3,
    },
  ])
  await first.drafts.insert({
    id: "draft-1",
    prKey: "acme/api#1",
    path: "src/index.ts",
    line: 12,
    startLine: null,
    side: "RIGHT",
    body: "Please rename this.",
    commitId: "head-1",
    createdAt: "2026-09-29T10:01:00Z",
  }).isPersisted.promise
  await first.viewedFiles.upsert([
    {
      key: JSON.stringify(["acme/api#1", "head-1", "src/index.ts"]),
      prKey: "acme/api#1",
      headOid: "head-1",
      path: "src/index.ts",
    },
    {
      key: JSON.stringify(["acme/api#1", "head-2", "src/index.ts"]),
      prKey: "acme/api#1",
      headOid: "head-2",
      path: "src/index.ts",
    },
  ])
  const transientMarker = JSON.stringify(["acme/api#1", "head-3", "src/deleted.ts"])
  await first.viewedFiles.collection.insert({
    key: transientMarker,
    prKey: "acme/api#1",
    headOid: "head-3",
    path: "src/deleted.ts",
  }).isPersisted.promise
  await first.viewedFiles.collection.delete(transientMarker).isPersisted.promise
  expect(first.viewedFiles.collection.has(transientMarker)).toBe(false)

  const reopened = createCollections(file.open())
  await reopened.database.setScope("https://api.github.com", "yi")
  await reopened.database.ready()

  expect(reopened.inboxPreferences.collection.get("yi:PR_1")).toMatchObject({
    pullId: "PR_1",
    state: "snoozed",
    activeOrder: 3,
  })
  expect(reopened.drafts.get("draft-1")).toMatchObject({ prKey: "acme/api#1", commitId: "head-1" })
  expect(
    [...reopened.viewedFiles.collection.values()]
      .filter((row) => row.headOid === "head-1")
      .map((row) => row.path),
  ).toEqual(["src/index.ts"])
  expect(
    [...reopened.viewedFiles.collection.values()]
      .filter((row) => row.headOid === "head-2")
      .map((row) => row.path),
  ).toEqual(["src/index.ts"])
  expect(reopened.viewedFiles.collection.has(transientMarker)).toBe(false)

  const otherAccount = createCollections(file.open())
  await otherAccount.database.setScope("https://api.github.com", "bob")
  await otherAccount.database.ready()
  expect(otherAccount.inboxPreferences.collection.size).toBe(0)
  expect(otherAccount.drafts.size).toBe(0)
  expect(otherAccount.viewedFiles.collection.size).toBe(0)
})
