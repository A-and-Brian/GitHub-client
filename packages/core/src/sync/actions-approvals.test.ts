import { describe, expect, test } from "vitest"
import { RestClient } from "../github/rest"
import { fakeGitHub } from "../test/fake-github"
import { fetchPendingPullRequestApprovals } from "./actions"

const run = (id: number, event: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `workflow-${id}`,
  event,
  conclusion: "action_required",
  head_sha: "head-current",
  ...overrides,
})

function setup() {
  const gh = fakeGitHub()
  const rest = new RestClient({ fetch: gh.fetch, getToken: () => "token" })
  return { gh, rest }
}

describe("fetchPendingPullRequestApprovals", () => {
  test("follows every event's pages and scopes regular PR runs by exact head", async () => {
    const { gh, rest } = setup()
    gh.set({
      path: /actions\/runs\?per_page=100&status=action_required&event=pull_request&head_sha=head-current$/,
      body: {
        workflow_runs: [
          run(1, "pull_request"),
          run(2, "pull_request", { head_sha: "old-head" }),
          run(3, "pull_request", {
            pull_requests: [{ number: 99, head: { sha: "head-current" } }],
          }),
        ],
      },
      headers: {
        Link: '<https://api.github.com/repos/acme/api/actions/runs?per_page=100&status=action_required&event=pull_request&head_sha=head-current&page=2>; rel="next"',
      },
    })
    gh.set({
      path: /actions\/runs\?per_page=100&status=action_required&event=pull_request&head_sha=head-current&page=2$/,
      body: { workflow_runs: [run(4, "pull_request")] },
    })
    gh.set({
      path: /actions\/runs\?per_page=100&status=action_required&event=pull_request_target$/,
      body: { workflow_runs: [] },
    })

    const candidates = await fetchPendingPullRequestApprovals(rest, "acme/api", 7, "head-current")

    expect(candidates).toEqual([
      { id: 1, name: "workflow-1" },
      { id: 4, name: "workflow-4" },
    ])
    expect(gh.requests.map((request) => request.path)).toHaveLength(3)
  })

  test("requires target PR association and head, ignores unrelated runs, and deduplicates IDs", async () => {
    const { gh, rest } = setup()
    gh.set({
      path: /actions\/runs\?per_page=100&status=action_required&event=pull_request&head_sha=head-current$/,
      body: { workflow_runs: [] },
    })
    gh.set({
      path: /actions\/runs\?per_page=100&status=action_required&event=pull_request_target$/,
      body: {
        workflow_runs: [
          run(5, "pull_request_target", {
            head_sha: "base-sha",
            pull_requests: [{ number: 7, head: { sha: "head-current" } }],
          }),
          run(6, "pull_request_target", { head_sha: "head-current" }),
          run(7, "pull_request_target", {
            pull_requests: [{ number: 7, head: { sha: "old-head" } }],
          }),
          run(8, "pull_request_target", {
            pull_requests: [{ number: 99, head: { sha: "head-current" } }],
          }),
          run(5, "pull_request_target", {
            head_sha: "another-base",
            pull_requests: [{ number: 7, head: { sha: "head-current" } }],
          }),
          run(9, "pull_request_target", { conclusion: "failure" }),
          run(10, "push"),
        ],
      },
    })

    const candidates = await fetchPendingPullRequestApprovals(rest, "acme/api", 7, "head-current")

    expect(candidates).toEqual([{ id: 5, name: "workflow-5" }])
  })

  test("does not reuse a stale conditional response for the next refresh", async () => {
    const { gh, rest } = setup()
    gh.set({
      path: /actions\/runs\?per_page=100&status=action_required&event=pull_request&head_sha=head-current$/,
      etag: '"runs"',
      body: { workflow_runs: [run(1, "pull_request")] },
    })
    gh.set({
      path: /actions\/runs\?per_page=100&status=action_required&event=pull_request_target$/,
      body: { workflow_runs: [] },
    })

    expect(await fetchPendingPullRequestApprovals(rest, "acme/api", 7, "head-current")).toEqual([
      { id: 1, name: "workflow-1" },
    ])
    expect(await fetchPendingPullRequestApprovals(rest, "acme/api", 7, "head-current")).toEqual([
      { id: 1, name: "workflow-1" },
    ])
    expect(gh.requests).toHaveLength(4)
    expect(gh.requests.every((request) => !("if-none-match" in request.headers))).toBe(true)
  })
})
