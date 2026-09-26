import type { SyncedCollection } from "../collections/synced"
import type { Job, Workflow, WorkflowRun } from "../domain/types"
import type { RestClient } from "../github/rest"

interface RestRun {
  id: number
  workflow_id: number
  name: string
  display_title: string
  run_number: number
  run_attempt: number
  event: string
  status: string
  conclusion: string | null
  head_branch: string | null
  head_sha: string
  actor: { login: string } | null
  created_at: string
  updated_at: string
  html_url: string
}

interface RestJob {
  id: number
  run_id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
  html_url: string
  steps?: Array<{
    number: number
    name: string
    status: string
    conclusion: string | null
    started_at: string | null
    completed_at: string | null
  }>
}

export const toWorkflowRun = (repo: string, r: RestRun): WorkflowRun => ({
  id: r.id,
  repo,
  workflowId: r.workflow_id,
  name: r.name,
  displayTitle: r.display_title,
  runNumber: r.run_number,
  runAttempt: r.run_attempt,
  event: r.event,
  status: r.status,
  conclusion: r.conclusion,
  headBranch: r.head_branch,
  headSha: r.head_sha,
  actor: r.actor?.login ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  url: r.html_url,
})

export const toJob = (repo: string, j: RestJob): Job => ({
  id: j.id,
  runId: j.run_id,
  repo,
  name: j.name,
  status: j.status,
  conclusion: j.conclusion,
  startedAt: j.started_at,
  completedAt: j.completed_at,
  url: j.html_url,
  steps: (j.steps ?? []).map((s) => ({
    number: s.number,
    name: s.name,
    status: s.status,
    conclusion: s.conclusion,
    startedAt: s.started_at,
    completedAt: s.completed_at,
  })),
})

const RUNS_PER_REPO = 50

/** Keeps the latest workflow runs of a repo. Older runs drop out of the collection. */
export async function syncWorkflowRuns(
  rest: RestClient,
  repo: string,
  runs: SyncedCollection<WorkflowRun, number>,
): Promise<number | undefined> {
  const result = await rest.poll<{ workflow_runs: RestRun[] }>(`/repos/${repo}/actions/runs`, {
    per_page: RUNS_PER_REPO,
  })
  if (result.status === "ok") {
    await runs.replace(
      result.data.workflow_runs.map((r) => toWorkflowRun(repo, r)),
      (row) => row.repo === repo,
    )
  }
  return result.pollIntervalSec
}

export async function syncRunJobs(
  rest: RestClient,
  repo: string,
  runId: number,
  jobs: SyncedCollection<Job, number>,
): Promise<void> {
  const result = await rest.pollAll<RestJob>(
    `/repos/${repo}/actions/runs/${runId}/jobs`,
    { filter: "latest" },
    { pick: (page) => (page as { jobs: RestJob[] }).jobs },
  )
  if (result.status === "ok") {
    await jobs.replace(
      result.data.map((j) => toJob(repo, j)),
      (row) => row.runId === runId,
    )
  }
}

export async function syncWorkflows(
  rest: RestClient,
  repo: string,
  workflows: SyncedCollection<Workflow, number>,
): Promise<void> {
  const result = await rest.pollAll<{ id: number; name: string; path: string; state: string }>(
    `/repos/${repo}/actions/workflows`,
    {},
    { pick: (page) => (page as { workflows: never[] }).workflows },
  )
  if (result.status === "ok") {
    await workflows.replace(
      result.data.map((w) => ({ id: w.id, repo, name: w.name, path: w.path, state: w.state })),
      (row) => row.repo === repo,
    )
  }
}
