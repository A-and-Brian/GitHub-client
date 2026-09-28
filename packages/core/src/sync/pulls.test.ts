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

function detailResponse(state: "OPEN" | "CLOSED" | "MERGED", number = 1) {
  return {
    data: {
      repository: {
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        pullRequest: {
          id: `PR_${number}`,
          number,
          title: `Change ${number}`,
          url: `https://github.com/acme/api/pull/${number}`,
          state,
          isDraft: false,
          bodyHTML: "",
          createdAt: "2026-09-01T10:00:00Z",
          headRefName: "feature-1",
          headRefOid: "head-1",
          baseRefName: "main",
          baseRefOid: "base-1",
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          reviewDecision: "REVIEW_REQUIRED",
          viewerCanUpdate: true,
          additions: 10,
          deletions: 2,
          changedFiles: 1,
          author: { login: "octo", avatarUrl: "" },
          timelineItems: { nodes: [] },
          reviewThreads: { nodes: [] },
          commits: { nodes: [] },
        },
      },
    },
  }
}

function graphClient(search: () => unknown, detail: (number: number) => unknown) {
  const gh = fakeGitHub()
  const rest = new RestClient({
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string
        variables: { number?: number }
      }
      const isDetail = request.query.includes("query PullDetail")
      return new Response(
        JSON.stringify(isDetail ? detail(request.variables.number ?? 1) : search()),
        { status: 200 },
      )
    },
    getToken: () => "t",
  })
  return { graphql: new GraphQLClient(rest), gh }
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

  test("a complete open search verifies and retains a known closed PR", async () => {
    const collections = createCollections(db.open())
    const first = graphClient(
      () => searchResponse([pullNode(1)]),
      () => detailResponse("OPEN"),
    )
    await syncGroupPulls(first.graphql, org, collections.pulls, collections.pullDetails)

    const next = graphClient(
      () => searchResponse([]),
      () => detailResponse("CLOSED"),
    )
    await syncGroupPulls(next.graphql, org, collections.pulls, collections.pullDetails)

    expect(collections.pulls.collection.get("org:acme:PR_1")).toMatchObject({ state: "CLOSED" })
    await syncGroupPulls(next.graphql, org, collections.pulls, collections.pullDetails)
    expect(collections.pulls.collection.get("org:acme:PR_1")).toMatchObject({ state: "CLOSED" })
  })

  test("partial searches and failed detail verification never infer closure", async () => {
    const collections = createCollections(db.open())
    const first = graphClient(
      () => searchResponse([pullNode(1)]),
      () => detailResponse("OPEN"),
    )
    await syncGroupPulls(first.graphql, org, collections.pulls, collections.pullDetails)

    const partial = graphClient(
      () => ({
        data: { search: { pageInfo: { hasNextPage: true, endCursor: "next" }, nodes: [] } },
      }),
      () => detailResponse("CLOSED"),
    )
    const result = await syncGroupPulls(
      partial.graphql,
      org,
      collections.pulls,
      collections.pullDetails,
    )
    expect(result.complete).toBe(false)
    expect(collections.pulls.collection.get("org:acme:PR_1")?.state).toBe("OPEN")

    const failed = graphClient(
      () => searchResponse([]),
      () => ({ errors: [{ message: "detail unavailable" }] }),
    )
    await syncGroupPulls(failed.graphql, org, collections.pulls, collections.pullDetails)
    expect(collections.pulls.collection.get("org:acme:PR_1")?.state).toBe("OPEN")
  })

  test("rotates bounded detail verification past inaccessible early candidates", async () => {
    const collections = createCollections(db.open())
    const numbered = [
      ...Array.from({ length: 10 }, (_, index) => pullNode(index + 1)),
      pullNode(99),
    ]
    const rotatingGroup: Group = { ...org, id: "org:rotating" }
    const first = graphClient(
      () => searchResponse(numbered),
      (number) => detailResponse("OPEN", number),
    )
    await syncGroupPulls(first.graphql, rotatingGroup, collections.pulls, collections.pullDetails)

    const verifiedNumbers: number[] = []
    const next = graphClient(
      () => searchResponse([]),
      (number) => {
        verifiedNumbers.push(number)
        return number === 99
          ? detailResponse("CLOSED", number)
          : { errors: [{ message: "temporarily inaccessible" }] }
      },
    )
    await syncGroupPulls(next.graphql, rotatingGroup, collections.pulls, collections.pullDetails)
    expect(verifiedNumbers).not.toContain(99)
    expect(collections.pulls.collection.get("org:rotating:PR_99")).toMatchObject({ state: "OPEN" })
    await syncGroupPulls(next.graphql, rotatingGroup, collections.pulls, collections.pullDetails)
    expect(collections.pulls.collection.get("org:rotating:PR_99")).toMatchObject({
      state: "CLOSED",
    })
  })
})
