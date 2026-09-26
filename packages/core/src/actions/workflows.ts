import { parse } from "yaml"
import type { RestClient } from "../github/rest"

export const rerunRun = (rest: RestClient, repo: string, runId: number) =>
  rest.request("POST", `/repos/${repo}/actions/runs/${runId}/rerun`)

export const rerunFailedJobs = (rest: RestClient, repo: string, runId: number) =>
  rest.request("POST", `/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`)

export const cancelRun = (rest: RestClient, repo: string, runId: number) =>
  rest.request("POST", `/repos/${repo}/actions/runs/${runId}/cancel`)

export const rerunJob = (rest: RestClient, repo: string, jobId: number) =>
  rest.request("POST", `/repos/${repo}/actions/jobs/${jobId}/rerun`)

/** Plain-text log of one job. GitHub answers with a redirect to blob storage. */
export const fetchJobLog = (rest: RestClient, repo: string, jobId: number) =>
  rest.getText(`/repos/${repo}/actions/jobs/${jobId}/logs`)

export interface DispatchInput {
  name: string
  type: "string" | "boolean" | "choice" | "number" | "environment"
  description: string | null
  required: boolean
  default: string | boolean | number | null
  options: string[]
}

/** Reads `on.workflow_dispatch.inputs` from workflow YAML. Null when the workflow has no manual trigger. */
export function parseDispatchInputs(source: string): DispatchInput[] | null {
  const doc = parse(source) as { on?: unknown; true?: unknown } | null
  // YAML 1.1 parsers read a bare `on` key as boolean true; accept both spellings.
  const on = doc?.on ?? doc?.true
  if (on === "workflow_dispatch") return []
  if (Array.isArray(on)) return on.includes("workflow_dispatch") ? [] : null
  if (!on || typeof on !== "object" || !("workflow_dispatch" in on)) return null
  const dispatch = (on as Record<string, unknown>).workflow_dispatch as {
    inputs?: Record<string, Record<string, unknown>>
  } | null
  return Object.entries(dispatch?.inputs ?? {}).map(([name, spec]) => ({
    name,
    type: (spec.type as DispatchInput["type"]) ?? "string",
    description: (spec.description as string) ?? null,
    required: spec.required === true,
    default: (spec.default as DispatchInput["default"]) ?? null,
    options: Array.isArray(spec.options) ? spec.options.map(String) : [],
  }))
}

export async function fetchDispatchInputs(
  rest: RestClient,
  repo: string,
  path: string,
  ref: string,
): Promise<DispatchInput[] | null> {
  const source = await rest.getText(
    `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { Accept: "application/vnd.github.raw+json" },
  )
  return parseDispatchInputs(source)
}

export const dispatchWorkflow = (
  rest: RestClient,
  repo: string,
  workflowId: number,
  ref: string,
  inputs: Record<string, string | boolean | number>,
) =>
  rest.request("POST", `/repos/${repo}/actions/workflows/${workflowId}/dispatches`, {
    ref,
    inputs,
  })
