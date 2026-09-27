import { type Job, jobKeys, type WorkflowRun } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { Link } from "@tanstack/react-router"
import { ArrowLeftIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useClient, useJobStatus, useWatch } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { useShortcuts } from "@/app/shortcuts"
import { RepositoryContext } from "@/components/repository-context"
import { runState, StateIcon } from "@/components/status"
import { duration, RelativeTime } from "@/components/time"
import { openExternal } from "@/platform"
import { ConfirmButton } from "./confirm-button"
import { LogViewer } from "./log-viewer"

export function RunContent({
  owner,
  name,
  runId,
  job: jobParam,
  onJobChange,
  onBack,
  embedded = false,
}: {
  owner: string
  name: string
  runId: number
  job?: number
  onJobChange: (id: number) => void
  onBack: () => void
  embedded?: boolean
}) {
  const client = useClient()
  const repo = `${owner}/${name}`

  useWatch((c) => c.watchRunJobs(repo, runId), [repo, runId])
  useWatch((c) => c.watchRuns(repo), [repo])
  const jobsStatus = useJobStatus(jobKeys.runJobs(runId))
  const runsStatus = useJobStatus(jobKeys.runs(repo))
  useErrorToast(jobsStatus?.error, {
    id: `actions-run-jobs-error:${runId}`,
    title: `Could not refresh jobs for run ${runId}`,
  })
  useErrorToast(runsStatus?.error, {
    id: `actions-runs-error:${repo}`,
    title: `Could not refresh ${repo} workflow runs`,
  })
  const run = useRun(repo, runId, jobsStatus?.lastSuccess)
  const jobs = useLiveQuery(
    (q) =>
      q
        .from({ j: client.collections.jobs.collection })
        .where(({ j }) => eq(j.runId, runId))
        .orderBy(({ j }) => j.id, "asc"),
    [runId],
  ).data

  const failed = jobs.filter((j) => runState(j.status, j.conclusion) === "failure")
  const job = jobs.find((j) => j.id === jobParam) ?? failed[0] ?? jobs[0]

  const refresh = () =>
    Promise.all([client.refresh(jobKeys.runJobs(runId)), client.refresh(jobKeys.runs(repo))])

  const moveJob = (delta: number) => {
    const at = job ? jobs.indexOf(job) : -1
    const next = jobs[Math.min(Math.max(at + delta, 0), jobs.length - 1)]
    if (next) onJobChange(next.id)
  }

  useShortcuts(
    {
      Escape: onBack,
      j: () => moveJob(1),
      k: () => moveJob(-1),
      o: () => run && void openExternal(job?.url ?? run.url),
      r: () => void refresh(),
    },
    !embedded,
  )

  const completed = run?.status === "completed"
  const approvalCandidate =
    run?.conclusion === "action_required" &&
    (run.event === "pull_request" || run.event === "pull_request_target")

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!embedded && <RepositoryContext owner={owner} repo={name} location={`Run ${runId}`} />}
      <header
        className={cn("flex flex-wrap items-start gap-2 border-b px-4 py-3", embedded && "pr-12")}
      >
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        {run && <StateIcon state={runState(run.status, run.conclusion)} className="mt-1.5" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-snug">
            {run?.displayTitle ?? `Run ${runId}`}
          </h1>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <Link
              to="/actions/$owner/$repo"
              params={{ owner, repo: name }}
              className="hover:underline"
            >
              {repo}
            </Link>
            {run && <RunFacts run={run} />}
          </p>
        </div>
        {run && approvalCandidate && (
          <ConfirmButton
            title="Approve workflow"
            description={`Approving "${run.name}" on ${run.headBranch ?? "this branch"} allows its PR code to execute.`}
            confirmLabel="Approve workflow"
            success="Approval requested"
            action={() => client.approveRun(repo, runId)}
          >
            Approve workflow
          </ConfirmButton>
        )}
        {run && completed && !approvalCandidate && (
          <ConfirmButton
            title="Re-run all jobs"
            description={`Starts attempt ${run.runAttempt + 1} of "${run.name}" with every job.`}
            confirmLabel="Re-run all jobs"
            success="Re-run requested"
            action={() => client.rerunRun(repo, runId, false)}
          >
            Re-run all jobs
          </ConfirmButton>
        )}
        {run && completed && !approvalCandidate && failed.length > 0 && (
          <ConfirmButton
            title="Re-run failed jobs"
            description={`Re-runs ${failed.length} failed job${failed.length === 1 ? "" : "s"} and the jobs that depend on them.`}
            confirmLabel="Re-run failed jobs"
            success="Re-run requested"
            action={() => client.rerunRun(repo, runId, true)}
          >
            Re-run failed jobs
          </ConfirmButton>
        )}
        {run && !completed && (
          <ConfirmButton
            destructive
            title="Cancel run"
            description={`Cancels "${run.displayTitle}". Jobs still running are stopped.`}
            confirmLabel="Cancel run"
            success="Cancel requested"
            action={() => client.cancelRun(repo, runId)}
          >
            Cancel
          </ConfirmButton>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => void refresh()}>
          <RefreshCwIcon className={cn(jobsStatus?.running && "animate-spin")} />
        </Button>
        {run && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open on GitHub"
            onClick={() => openExternal(run.url)}
          >
            <ExternalLinkIcon />
          </Button>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside className="max-h-[30%] w-full shrink-0 overflow-y-auto border-b sm:max-h-none sm:w-72 sm:border-r sm:border-b-0">
          <ul>
            {jobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                selected={j.id === job?.id}
                canRerun={completed && j.status === "completed"}
                onSelect={() => onJobChange(j.id)}
              />
            ))}
          </ul>
          {jobs.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {jobsStatus?.error
                ? "Could not load jobs. Use Refresh to try again."
                : jobsStatus?.lastSuccess
                  ? approvalCandidate
                    ? "This run has no jobs yet. Approve the workflow to allow its PR code to execute."
                    : "This run has no jobs."
                  : "Loading jobs…"}
            </p>
          )}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {job && (
            <>
              <JobHeader job={job} />
              <StepTree job={job} />
              <LogViewer key={job.id} job={job} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/** The run from the synced list, or fetched directly when it is older than the latest runs. */
function useRun(repo: string, runId: number, jobsSyncedAt: number | undefined) {
  const client = useClient()
  const synced = useLiveQuery(
    (q) =>
      q.from({ r: client.collections.workflowRuns.collection }).where(({ r }) => eq(r.id, runId)),
    [runId],
  ).data[0]
  const [fetched, setFetched] = useState<WorkflowRun>()
  const [fetchFailure, setFetchFailure] = useState<{ runId: number; error: unknown }>()
  const runsSynced = useJobStatus(jobKeys.runs(repo))?.lastSuccess !== undefined
  useErrorToast(synced || fetchFailure?.runId !== runId ? undefined : fetchFailure.error, {
    id: `actions-run-detail-error:${repo}:${runId}`,
    title: `Could not load workflow run ${runId}`,
  })

  // Follows the jobs poll so that the fallback run status stays current too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on each jobs sync
  useEffect(() => {
    if (synced || !runsSynced) return
    let cancelled = false
    client.fetchRun(repo, runId).then(
      (run) => {
        if (cancelled) return
        setFetched(run)
        setFetchFailure(undefined)
      },
      (error) => !cancelled && setFetchFailure({ runId, error }),
    )
    return () => {
      cancelled = true
    }
  }, [client, repo, runId, synced, runsSynced, jobsSyncedAt])

  return synced ?? (fetched?.id === runId ? fetched : undefined)
}

function RunFacts({ run }: { run: WorkflowRun }) {
  return (
    <>
      <span>·</span>
      <span className="font-medium text-foreground">{run.name}</span>
      <span>
        #{run.runNumber}
        {run.runAttempt > 1 && ` attempt ${run.runAttempt}`}
      </span>
      <span>·</span>
      {run.headBranch && <code>{run.headBranch}</code>}
      <code>{run.headSha.slice(0, 7)}</code>
      <span>·</span>
      <span>{run.event}</span>
      {run.actor && <span>by {run.actor}</span>}
      <span>·</span>
      <RelativeTime iso={run.createdAt} />
      {run.status === "completed" && <span>· {duration(run.createdAt, run.updatedAt)}</span>}
    </>
  )
}

function JobRow({
  job,
  selected,
  canRerun,
  onSelect,
}: {
  job: Job
  selected: boolean
  canRerun: boolean
  onSelect: () => void
}) {
  const client = useClient()
  return (
    <li
      className={cn(
        "group flex items-center gap-2 border-b px-3 py-2 text-sm",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={onSelect}
      >
        <StateIcon state={runState(job.status, job.conclusion)} />
        <span className="truncate">{job.name}</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {duration(job.startedAt, job.completedAt)}
        </span>
      </button>
      {canRerun && (
        <span className={cn(!selected && "hidden group-hover:inline")}>
          <ConfirmButton
            size="xs"
            title="Re-run job"
            description={`Re-runs "${job.name}" and the jobs that depend on it.`}
            confirmLabel="Re-run job"
            success="Re-run requested"
            action={() => client.rerunJob(job.repo, job.runId, job.id)}
          >
            Re-run
          </ConfirmButton>
        </span>
      )}
    </li>
  )
}

function JobHeader({ job }: { job: Job }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <StateIcon state={runState(job.status, job.conclusion)} />
      <h2 className="truncate text-sm font-semibold">{job.name}</h2>
      <span className="text-xs text-muted-foreground">
        {job.conclusion ?? job.status.replace("_", " ")}
        {job.startedAt && ` · ${duration(job.startedAt, job.completedAt)}`}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="ml-auto"
        aria-label="Open job on GitHub"
        onClick={() => openExternal(job.url)}
      >
        <ExternalLinkIcon />
      </Button>
    </div>
  )
}

function StepTree({ job }: { job: Job }) {
  if (job.steps.length === 0) return null
  return (
    <ol className="max-h-[30%] shrink-0 overflow-y-auto border-b py-1">
      {job.steps.map((step) => (
        <li key={step.number} className="flex items-center gap-2 px-3 py-0.5 text-xs">
          <StateIcon state={runState(step.status, step.conclusion)} className="size-3.5" />
          <span className="w-5 text-right tabular-nums text-muted-foreground">{step.number}</span>
          <span className="truncate">{step.name}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">
            {duration(step.startedAt, step.completedAt)}
          </span>
        </li>
      ))}
    </ol>
  )
}
