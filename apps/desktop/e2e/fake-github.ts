import type { Page, Route } from "@playwright/test"

const user = { login: "octo", name: "Octo Cat", avatar_url: "" }

const pullNode = {
  id: "PR_1",
  number: 7,
  title: "Speed up the diff view",
  url: "https://github.com/acme/api/pull/7",
  isDraft: false,
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-25T10:00:00Z",
  headRefName: "fast-diff",
  baseRefName: "main",
  reviewDecision: "REVIEW_REQUIRED",
  additions: 12,
  deletions: 3,
  repository: { nameWithOwner: "acme/api" },
  author: { login: "hubot", avatarUrl: "" },
  labels: { nodes: [{ name: "perf", color: "0e8a16" }] },
  comments: { totalCount: 1 },
  reviewRequests: { nodes: [{ requestedReviewer: { login: "octo" } }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
}

const pullDetail = {
  mergeCommitAllowed: true,
  squashMergeAllowed: true,
  rebaseMergeAllowed: false,
  pullRequest: {
    id: "PR_1",
    number: 7,
    title: "Speed up the diff view",
    url: "https://github.com/acme/api/pull/7",
    state: "OPEN",
    isDraft: false,
    bodyHTML: "<p>Virtualizes the diff rows.</p>",
    createdAt: "2026-09-20T10:00:00Z",
    headRefName: "fast-diff",
    headRefOid: "abc123",
    baseRefName: "main",
    baseRefOid: "def456",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "REVIEW_REQUIRED",
    viewerCanUpdate: true,
    additions: 12,
    deletions: 3,
    changedFiles: 1,
    author: { login: "hubot", avatarUrl: "" },
    timelineItems: {
      nodes: [
        {
          __typename: "IssueComment",
          id: "C_1",
          databaseId: 1,
          bodyHTML: "<p>Looks promising.</p>",
          createdAt: "2026-09-21T10:00:00Z",
          author: { login: "octo", avatarUrl: "" },
        },
      ],
    },
    reviewThreads: { nodes: [] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "test",
                    status: "COMPLETED",
                    conclusion: "SUCCESS",
                    detailsUrl: "https://github.com/acme/api/actions/runs/9/job/99",
                    checkSuite: { workflowRun: { databaseId: 9, workflow: { name: "CI" } } },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
}

const files = [
  {
    filename: "src/diff.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch:
      '@@ -1,3 +1,4 @@\n import { a } from "a"\n-const rows = all()\n+const rows = visible()\n+const size = 24\n export { rows }',
  },
]

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

/** Serves a small, fixed GitHub account so UI tests need no network or token. */
export async function fakeGitHub(
  page: Page,
  options: {
    hierarchy?: boolean
    checkState?: string
    admin?: boolean
    settingsError?: number
    draft?: boolean
    mergeable?: string
    mergeMethods?: Array<"squash" | "merge" | "rebase">
    mergeError?: number
    mergeGate?: Promise<void>
    headOid?: string
  } = {},
) {
  const settings = {
    description: "API service",
    homepage: "https://example.com",
    has_issues: true,
    has_wiki: true,
    allow_squash_merge: true,
    allow_rebase_merge: true,
    allow_merge_commit: true,
    delete_branch_on_merge: false,
    permissions: { admin: options.admin ?? true },
  }

  const requests: Array<{ method: string; path: string; body: unknown }> = []
  let merged = false
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postDataJSON?.() ?? null
    requests.push({ method: request.method(), path: url.pathname, body })
    if (url.pathname === "/user") return json(route, user)
    if (url.pathname === "/user/orgs") return json(route, [{ login: "acme" }])
    if (url.pathname === "/user/teams")
      return json(
        route,
        options.hierarchy
          ? [
              {
                name: "Engineering",
                slug: "engineering",
                organization: { login: "acme" },
                parent: null,
              },
              {
                name: "Backend",
                slug: "backend",
                organization: { login: "acme" },
                parent: { slug: "engineering", name: "Engineering" },
              },
            ]
          : [],
      )
    if (/^\/orgs\/acme\/teams\/[^/]+\/repos$/.test(url.pathname))
      return json(route, [
        {
          full_name: "acme/api",
          name: "api",
          owner: { login: "acme" },
          private: true,
          archived: false,
          default_branch: "main",
          pushed_at: null,
        },
      ])
    if (url.pathname === "/repos/acme/api") {
      if (request.method() === "PATCH") {
        if (options.settingsError)
          return route.fulfill({
            status: options.settingsError,
            contentType: "application/json",
            body: JSON.stringify({ message: "Organization policy prevents this change" }),
          })
        Object.assign(settings, body)
      }
      return json(route, settings)
    }
    if (url.pathname === "/user/starred") return json(route, [])
    if (url.pathname === "/graphql") {
      const query = String((body as { query?: string })?.query ?? "")
      if (query.includes("SearchPulls")) {
        return json(route, {
          data: {
            search: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  ...pullNode,
                  headRefOid: options.headOid ?? "abc123",
                  commits: {
                    nodes: [
                      {
                        commit: {
                          oid: options.headOid ?? "abc123",
                          statusCheckRollup: { state: options.checkState ?? "SUCCESS" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        })
      }
      if (query.includes("PullDetail")) {
        const detail = structuredClone(pullDetail)
        detail.squashMergeAllowed = options.mergeMethods
          ? options.mergeMethods.includes("squash")
          : detail.squashMergeAllowed
        detail.mergeCommitAllowed = options.mergeMethods
          ? options.mergeMethods.includes("merge")
          : detail.mergeCommitAllowed
        detail.rebaseMergeAllowed = options.mergeMethods
          ? options.mergeMethods.includes("rebase")
          : detail.rebaseMergeAllowed
        detail.pullRequest.isDraft = options.draft ?? detail.pullRequest.isDraft
        detail.pullRequest.headRefOid = options.headOid ?? detail.pullRequest.headRefOid
        detail.pullRequest.mergeable = options.mergeable ?? detail.pullRequest.mergeable
        if (merged) detail.pullRequest.state = "MERGED"
        return json(route, { data: { repository: detail } })
      }
    }
    if (url.pathname === "/repos/acme/api/pulls/7/merge" && request.method() === "PUT") {
      await options.mergeGate
      if (options.mergeError)
        return route.fulfill({
          status: options.mergeError,
          contentType: "application/json",
          body: JSON.stringify({ message: "Merge is blocked by repository policy" }),
        })
      merged = true
      return json(route, {
        sha: "merge123",
        merged: true,
        message: "Pull Request successfully merged",
      })
    }
    if (url.pathname === "/repos/acme/api/pulls/7/files") return json(route, files)
    if (url.pathname === "/repos/acme/api/pulls/7/reviews" && request.method() === "POST") {
      return json(route, { id: 1 })
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"message":"Not Found"}',
    })
  })
  return requests
}
