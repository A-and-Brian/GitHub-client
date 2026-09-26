import { type Job, jobKeys, type WorkflowRun } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useClient, useJobStatus, useWatch } from "@/app/client"
import { runRoute } from "@/app/router"
import { useShortcuts } from "@/app/shortcuts"
import { RepositoryContext } from "@/components/repository-context"
import { runState, StateIcon } from "@/components/status"
import { duration, RelativeTime } from "@/components/time"
import { openExternal } from "@/platform"
import { ConfirmButton } from "./confirm-button"
import { LogViewer } from "./log-viewer"

export function RunPage() {
  const { owner, repo: name, runId: runIdParam } = runRoute.useParams()
  const { job: jobParam } = runRoute.useSearch()
  const navigate = useNavigate()
  const client = useClient()
  const repo = `${owner}/${name}`
  const runId = Number(runIdParam)

  useWatch((c) => c.watchRunJobs(repo, runId), [repo, runId])
  useWatch((c) => c.watchRuns(repo), [repo])
  const jobsStatus = useJobStatus(jobKeys.runJobs(runId))
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

  const selectJob = (id: number) =>
    navigate({
      to: "/actions/$owner/$repo/runs/$runId",
      params: { owner, repo: name, runId: runIdParam },
      search: { job: id },
      replace: true,
    })

  const refresh = () =>
    Promise.all([client.refresh(jobKeys.runJobs(runId)), client.refresh(jobKeys.runs(repo))])

  const moveJob = (delta: number) => {
    const at = job ? jobs.indexOf(job) : -1
    const next = jobs[Math.min(Math.max(at + delta, 0), jobs.length - 1)]
    if (next) void selectJob(next.id)
  }

  useShortcuts({
    Escape: () => window.history.back(),
    j: () => moveJob(1),
    k: () => moveJob(-1),
    o: () => run && void openExternal(job?.url ?? run.url),
    r: () => void refresh(),
  })

  const completed = run?.status === "completed"

  return (
    <div className="flex h-full flex-col">
      <RepositoryContext owner={owner} repo={name} location={`Run ${runId}`} />
      <header className="flex flex-wrap items-start gap-2 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          onClick={() => window.history.back()}
        >
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
        {run && completed && (
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
        {run && completed && failed.length > 0 && (
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
      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r">
          <ul>
            {jobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                selected={j.id === job?.id}
                canRerun={completed && j.status === "completed"}
                onSelect={() => void selectJob(j.id)}
              />
            ))}
          </ul>
          {jobs.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {jobsStatus?.error
                ? `Could not load jobs: ${String((jobsStatus.error as Error).message ?? jobsStatus.error)}`
                : jobsStatus?.lastSuccess
                  ? "This run has no jobs."
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
  const runsSynced = useJobStatus(jobKeys.runs(repo))?.lastSuccess !== undefined

  // Follows the jobs poll so that the fallback run status stays current too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on each jobs sync
  useEffect(() => {
    if (synced || !runsSynced) return
    let cancelled = false
    client.fetchRun(repo, runId).then(
      (run) => !cancelled && setFetched(run),
      () => {},
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
