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
    checks?: Array<{ status: string; conclusion: string | null }>
    contributionsError?: boolean
    contributionsZero?: boolean
    lastContributionDays?: number
    pullCount?: number
    pullStates?: Record<number, "OPEN" | "CLOSED" | "MERGED">
    pullTitle?: string
    pullUpdatedAt?: Record<string, string>
    workflowRun?: boolean
    draft?: boolean
    mergeable?: string
    mergeMethods?: Array<"squash" | "merge" | "rebase">
    mergeError?: number
    mergeGate?: Promise<void>
    headOid?: string
    headOids?: Record<number, string>
    checks?: Array<{
      name: string
      status: string
      conclusion: string | null
      detailsUrl?: string
      workflowRunId?: number | null
      workflowName?: string | null
    }>
    commentCount?: number
    repositoryReadme?: boolean
    releasesError?: number
  } = {},
) {
  const settings = {
    id: 1,
    full_name: "acme/api",
    name: "api",
    owner: { login: "acme" },
    private: true,
    archived: false,
    default_branch: "main",
    html_url: "https://github.com/acme/api",
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
  const pullState = (number: number) =>
    number === 7 && merged ? "MERGED" : (options.pullStates?.[number] ?? "OPEN")
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
    if (url.pathname === "/repos/acme/api/pulls")
      return json(
        route,
        pullState(7) !== "OPEN"
          ? []
          : [
              {
                node_id: "PR_1",
                number: 7,
                title: options.pullTitle ?? pullNode.title,
                html_url: pullNode.url,
                user: { login: "hubot", avatar_url: "" },
                draft: false,
                created_at: pullNode.createdAt,
                updated_at: pullNode.updatedAt,
                head: { ref: "fast-diff", sha: options.headOid ?? "abc123" },
                base: { ref: "main" },
                requested_reviewers: [{ login: "octo" }],
              },
            ],
      )
    if (url.pathname === "/repos/acme/api/releases") {
      if (options.releasesError)
        return route.fulfill({
          status: options.releasesError,
          contentType: "application/json",
          body: JSON.stringify({ message: "Contents access is required to view releases" }),
        })
      return json(route, [
        {
          id: 101,
          name: "Repository release with an intentionally long name that should wrap on narrow screens",
          tag_name: "v1.2.0",
          body: "Release notes\n\nThis note includes a very-long-unbroken-sequence-that-should-wrap-within-the-release-card-on-a-narrow-screen-without-causing-horizontal-overflow.",
          draft: false,
          prerelease: true,
          published_at: "2026-09-26T10:00:00Z",
          html_url: "https://github.com/acme/api/releases/tag/v1.2.0",
          assets: [
            {
              name: "desktop-installer-with-a-long-name-x64.zip",
              size: 2048,
              browser_download_url:
                "https://github.com/acme/api/releases/download/v1.2.0/desktop-installer-with-a-long-name-x64.zip",
            },
          ],
        },
      ])
    }
    if (url.pathname === "/repos/acme/api/branches")
      return json(route, [{ name: "main" }, { name: "feature" }])
    if (url.pathname === "/repos/acme/api/readme") {
      if (options.repositoryReadme === false)
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: '{"message":"Not Found"}',
        })
      if (request.headers().accept?.includes("application/vnd.github.html+json"))
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<h1>Repository guide</h1>",
        })
      return json(route, {
        name: "README.md",
        path: "README.md",
        type: "file",
        size: 20,
        html_url: "https://github.com/acme/api/blob/main/README.md",
      })
    }
    if (url.pathname.startsWith("/repos/acme/api/contents")) {
      const contentPath = decodeURIComponent(
        url.pathname.slice("/repos/acme/api/contents".length).replace(/^\//, ""),
      )
      if (contentPath === "")
        return json(route, [
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            size: 20,
            html_url: "https://github.com/acme/api/blob/main/README.md",
          },
          {
            name: "src",
            path: "src",
            type: "dir",
            size: 0,
            html_url: "https://github.com/acme/api/tree/main/src",
          },
        ])
      if (contentPath === "src")
        return json(route, [
          {
            name: "index.ts",
            path: "src/index.ts",
            type: "file",
            size: 14,
            html_url: "https://github.com/acme/api/blob/main/src/index.ts",
          },
        ])
      if (contentPath === "README.md")
        return json(route, {
          name: "README.md",
          path: "README.md",
          type: "file",
          size: 20,
          encoding: "base64",
          content: "IyBSZXBvc2l0b3J5IGd1aWRlCg==",
          html_url: "https://github.com/acme/api/blob/main/README.md",
        })
      if (contentPath === "src/index.ts")
        return json(route, {
          name: "index.ts",
          path: "src/index.ts",
          type: "file",
          size: 14,
          encoding: "base64",
          content: "ZXhwb3J0IHsgfSA=",
          html_url: "https://github.com/acme/api/blob/main/src/index.ts",
        })
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"message":"Not Found"}',
      })
    }
    if (url.pathname === "/user/starred") return json(route, [])
    if (url.pathname === "/graphql") {
      const query = String((body as { query?: string })?.query ?? "")
      if (query.includes("SearchPulls")) {
        return json(route, {
          data: {
            search: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: Array.from({ length: options.pullCount ?? 1 }, (_, index) => ({
                ...pullNode,
                id: index === 0 ? "PR_1" : `PR_${index + 1}`,
                updatedAt: options.pullUpdatedAt?.[`PR_${index + 1}`] ?? pullNode.updatedAt,
                number: 7 + index,
                title:
                  index === 0
                    ? (options.pullTitle ?? pullNode.title)
                    : `Follow-up pull request ${index}`,
                headRefOid: options.headOids?.[7 + index] ?? options.headOid ?? "abc123",
                commits: {
                  nodes: [
                    {
                      commit: {
                        oid: options.headOids?.[7 + index] ?? options.headOid ?? "abc123",
                        statusCheckRollup: { state: options.checkState ?? "SUCCESS" },
                      },
                    },
                  ],
                },
              })).filter((pull) => pullState(pull.number) === "OPEN"),
            },
          },
        })
      }
      if (query.includes("PullDetail")) {
        const detail = structuredClone(pullDetail)
        const number = Number((body as { variables: { number: number } }).variables.number)
        detail.pullRequest.number = number
        detail.pullRequest.id = `PR_${number - 6}`
        detail.pullRequest.title =
          number === 7
            ? (options.pullTitle ?? pullNode.title)
            : `Follow-up pull request ${number - 7}`
        if (options.checks) {
          const nodes = detail.pullRequest.commits.nodes[0]!.commit.statusCheckRollup.contexts.nodes
          const original = nodes[0]!
          detail.pullRequest.commits.nodes[0]!.commit.statusCheckRollup.contexts.nodes =
            options.checks.map((check, index) => ({
              ...original,
              ...check,
              conclusion: check.conclusion as string,
              name: `check-${index}`,
            }))
        }
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
        detail.pullRequest.headRefOid =
          options.headOids?.[number] ?? options.headOid ?? detail.pullRequest.headRefOid
        detail.pullRequest.mergeable = options.mergeable ?? detail.pullRequest.mergeable
        if (options.commentCount !== undefined) {
          detail.pullRequest.timelineItems.nodes = Array.from(
            { length: options.commentCount },
            (_, i) => ({
              __typename: "IssueComment",
              id: `C_${i + 1}`,
              databaseId: i + 1,
              bodyHTML: `<p>Conversation entry ${i + 1}</p>`,
              createdAt: "2026-09-21T10:00:00Z",
              author: { login: "octo", avatarUrl: "" },
            }),
          )
        }
        if (options.checks) {
          detail.pullRequest.commits.nodes[0]!.commit.statusCheckRollup.contexts.nodes =
            options.checks.map((check, index) => ({
              __typename: "CheckRun",
              name: check.name,
              status: check.status,
              conclusion: check.conclusion,
              detailsUrl:
                check.detailsUrl ??
                `https://github.com/acme/api/actions/runs/${9 + index}/job/${99 + index}`,
              checkSuite:
                check.workflowRunId === null
                  ? { workflowRun: null }
                  : {
                      workflowRun: {
                        databaseId: check.workflowRunId ?? 9 + index,
                        workflow: { name: check.workflowName ?? "CI" },
                      },
                    },
            }))
        }
        detail.pullRequest.state = pullState(number)
        return json(route, { data: { repository: detail } })
      }
      if (query.includes("query Contributions")) {
        if (options.contributionsError)
          return json(route, { errors: [{ message: "Contribution data unavailable" }] })
        const weeks = Array.from({ length: 52 }, (_, week) => ({
          contributionDays: Array.from(
            { length: week === 51 ? (options.lastContributionDays ?? 7) : 7 },
            (_, weekday) => {
              const date = new Date(Date.UTC(2025, 9, 5 + week * 7 + weekday))
                .toISOString()
                .slice(0, 10)
              const contributionCount = options.contributionsZero ? 0 : (week + weekday) % 5
              return {
                date,
                weekday,
                contributionCount,
                contributionLevel: [
                  "NONE",
                  "FIRST_QUARTILE",
                  "SECOND_QUARTILE",
                  "THIRD_QUARTILE",
                  "FOURTH_QUARTILE",
                ][contributionCount],
              }
            },
          ),
        }))
        return json(route, {
          data: { viewer: { contributionsCollection: { contributionCalendar: { weeks } } } },
        })
      }
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"message":"Not Found"}',
      })
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
    if (url.pathname === "/repos/acme/api/actions/runs")
      return json(route, {
        workflow_runs: options.workflowRun
          ? [
              {
                id: 9,
                workflow_id: 1,
                name: "CI",
                display_title: "Verify navigation",
                run_number: 9,
                run_attempt: 1,
                event: "pull_request",
                status: "completed",
                conclusion: "success",
                head_branch: "navigation",
                head_sha: "abc123",
                actor: { login: "octo" },
                created_at: "2026-09-26T10:00:00Z",
                updated_at: "2026-09-26T10:05:00Z",
                html_url: "https://github.com/acme/api/actions/runs/9",
              },
            ]
          : [],
      })
    if (url.pathname === "/repos/acme/api/actions/runs/9/jobs") return json(route, { jobs: [] })
    if (url.pathname === "/repos/acme/api/actions/workflows") return json(route, { workflows: [] })
    if (/^\/repos\/acme\/api\/pulls\/\d+\/files$/.test(url.pathname)) return json(route, files)
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
