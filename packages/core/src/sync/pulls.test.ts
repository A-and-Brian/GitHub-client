import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createCollections } from "../collections"
import type { Group } from "../domain/types"
import { GraphQLClient } from "../github/graphql"
import { RestClient } from "../github/rest"
import { fakeGitHub } from "../test/fake-github"
import { tempDatabase } from "../test/persistence"
import { type SearchPullNode, syncGroupPulls } from "./pulls"

const pullNode = (number: number, overrides: Partial<SearchPullNode> = {}): SearchPullNode => ({
  id: `PR_${number}`,
  number,
  title: `Change ${number}`,
  url: `https://github.com/acme/api/pull/${number}`,
  isDraft: false,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  headRefName: `feature-${number}`,
  baseRefName: "main",
  reviewDecision: "REVIEW_REQUIRED",
  additions: 10,
  deletions: 2,
  repository: { nameWithOwner: "acme/api" },
  author: { login: "octo", avatarUrl: "https://avatars/octo" },
  labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
  comments: { totalCount: 3 },
  reviewRequests: {
    nodes: [
      { requestedReviewer: { login: "yi" } },
      { requestedReviewer: { combinedSlug: "acme/core" } },
    ],
  },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
  ...overrides,
})

const searchResponse = (nodes: SearchPullNode[]) => ({
  data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } },
})

const org: Group = { id: "org:acme", kind: "org", name: "acme", org: "acme", order: 1 }
const me: Group = { id: "me", kind: "me", name: "Involving me", order: 0 }

let db: ReturnType<typeof tempDatabase>
beforeEach(() => {
  db = tempDatabase()
})
afterEach(() => db.close())

function setup(persistence = db.open()) {
  const gh = fakeGitHub()
  const rest = new RestClient({ fetch: gh.fetch, getToken: () => "t" })
  return { gh, graphql: new GraphQLClient(rest), collections: createCollections(persistence) }
}

describe("syncGroupPulls", () => {
  test("maps search results into pull request rows", async () => {
    const { gh, graphql, collections } = setup()
    gh.set({ method: "POST", path: "/graphql", body: searchResponse([pullNode(1)]) })

    await syncGroupPulls(graphql, org, collections.pulls)

    expect(collections.pulls.collection.get("org:acme:PR_1")).toMatchObject({
      groupId: "org:acme",
      repo: "acme/api",
      number: 1,
      author: "octo",
      checkState: "FAILURE",
      reviewRequests: ["yi", "acme/core"],
      labels: [{ name: "bug", color: "d73a4a" }],
    })
    expect(gh.graphqlCalls()[0]!.body).toMatchObject({
      variables: { q: "is:pr is:open archived:false org:acme sort:updated-desc" },
    })
  })

  test("removes pull requests that left the group, without touching other groups", async () => {
    const { gh, graphql, collections } = setup()
    gh.set({ method: "POST", path: "/graphql", body: searchResponse([pullNode(1), pullNode(2)]) })
    await syncGroupPulls(graphql, org, collections.pulls)
    await syncGroupPulls(graphql, me, collections.pulls)

    gh.set({ method: "POST", path: "/graphql", body: searchResponse([pullNode(2)]) })
    await syncGroupPulls(graphql, org, collections.pulls)

    const keys = [...collections.pulls.collection.keys()].sort()
    expect(keys).toEqual(["me:PR_1", "me:PR_2", "org:acme:PR_2"])
  })

  test("an unchanged result does not rewrite rows", async () => {
    const { gh, graphql, collections } = setup()
    gh.set({ method: "POST", path: "/graphql", body: searchResponse([pullNode(1)]) })
    await syncGroupPulls(graphql, org, collections.pulls)

    const changes: unknown[] = []
    const subscription = collections.pulls.collection.subscribeChanges((c) => changes.push(...c))
    await syncGroupPulls(graphql, org, collections.pulls)
    subscription.unsubscribe()
    expect(changes).toEqual([])
  })

  test("rows survive a restart and render before the first sync", async () => {
    const first = setup()
    first.gh.set({ method: "POST", path: "/graphql", body: searchResponse([pullNode(7)]) })
    await syncGroupPulls(first.graphql, org, first.collections.pulls)
    await first.collections.pulls.collection.cleanup()
    db.close()

    const second = setup()
    await second.collections.pulls.collection.preload()
    expect(second.collections.pulls.collection.get("org:acme:PR_7")?.title).toBe("Change 7")
    expect(second.gh.requests).toHaveLength(0)
  })
})
