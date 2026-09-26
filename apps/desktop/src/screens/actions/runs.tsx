import { jobKeys, type WorkflowRun } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Input } from "@github-client/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@github-client/ui/components/select"
import { Tabs, TabsList, TabsTrigger } from "@github-client/ui/components/tabs"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { useNavigate } from "@tanstack/react-router"
import { ExternalLinkIcon, PlayIcon, RefreshCwIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useClient, useJobStatus, useWatch } from "@/app/client"
import { runsRoute } from "@/app/router"
import { useShortcuts } from "@/app/shortcuts"
import { type RunState, runState, StateIcon } from "@/components/status"
import { duration, RelativeTime } from "@/components/time"
import { openExternal } from "@/platform"
import { DispatchDialog } from "./dispatch-dialog"

type StatusFilter = "all" | "active" | "failed" | "succeeded"

const STATUS_MATCH: Record<StatusFilter, (state: RunState) => boolean> = {
  all: () => true,
  active: (s) => s === "running" || s === "pending",
  failed: (s) => s === "failure",
  succeeded: (s) => s === "success",
}

const ALL_WORKFLOWS = "all"

export function RunsPage() {
  const { owner, repo: name } = runsRoute.useParams()
  const repo = `${owner}/${name}`
  const client = useClient()
  const navigate = useNavigate()
  const [workflow, setWorkflow] = useState<string>(ALL_WORKFLOWS)
  const [status, setStatus] = useState<StatusFilter>("all")
  const [text, setText] = useState("")
  const [selected, setSelected] = useState(0)
  const [dispatching, setDispatching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useWatch((c) => c.watchRuns(repo), [repo])
  useWatch((c) => c.watchWorkflows(repo), [repo])
  const sync = useJobStatus(jobKeys.runs(repo))
  const runs = useLiveQuery(
    (q) =>
      q
        .from({ r: client.collections.workflowRuns.collection })
        .where(({ r }) => eq(r.repo, repo))
        .orderBy(({ r }) => r.createdAt, "desc"),
    [repo],
  ).data
  const workflows = useLiveQuery(
    (q) =>
      q
        .from({ w: client.collections.workflows.collection })
        .where(({ w }) => eq(w.repo, repo))
        .orderBy(({ w }) => w.name, "asc"),
    [repo],
  ).data

  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase()
    return runs.filter((r) => {
      if (workflow !== ALL_WORKFLOWS && String(r.workflowId) !== workflow) return false
      if (!STATUS_MATCH[status](runState(r.status, r.conclusion))) return false
      if (!needle) return true
      return `${r.name} ${r.displayTitle} ${r.headBranch ?? ""} ${r.actor ?? ""} ${r.event} #${r.runNumber}`
        .toLowerCase()
        .includes(needle)
    })
  }, [runs, workflow, status, text])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the selection when the filters change
  useEffect(() => setSelected(0), [repo, workflow, status, text])
  useEffect(() => {
    document.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selected])

  const open = (run: WorkflowRun | undefined) => {
    if (!run) return
    void navigate({
      to: "/actions/$owner/$repo/runs/$runId",
      params: { owner, repo: name, runId: String(run.id) },
      search: {},
    })
  }
  const refresh = () =>
    Promise.all([client.refresh(jobKeys.runs(repo)), client.refresh(jobKeys.workflows(repo))])

  useShortcuts(
    {
      j: () => setSelected((i) => Math.min(i + 1, visible.length - 1)),
      k: () => setSelected((i) => Math.max(i - 1, 0)),
      ArrowDown: () => setSelected((i) => Math.min(i + 1, visible.length - 1)),
      ArrowUp: () => setSelected((i) => Math.max(i - 1, 0)),
      Enter: () => open(visible[selected]),
      o: () => visible[selected] && void openExternal(visible[selected].url),
      "/": () => searchRef.current?.focus(),
      r: () => void refresh(),
    },
    !dispatching,
  )

  const workflowName = (id: string) =>
    id === ALL_WORKFLOWS ? "All workflows" : workflows.find((w) => String(w.id) === id)?.name

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <h1 className="truncate font-semibold">
          {repo} <span className="font-normal text-muted-foreground">· Actions</span>
        </h1>
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">In progress</TabsTrigger>
            <TabsTrigger value="failed">Failed</TabsTrigger>
            <TabsTrigger value="succeeded">Succeeded</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={workflow} onValueChange={(v) => setWorkflow(v ?? ALL_WORKFLOWS)}>
          <SelectTrigger size="sm" className="w-52">
            <SelectValue>{workflowName(workflow) ?? "Workflow"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_WORKFLOWS}>All workflows</SelectItem>
            {workflows.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          ref={searchRef}
          className="ml-auto h-8 w-56"
          placeholder="Filter  /"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur()
          }}
        />
        <Button size="sm" variant="outline" onClick={() => setDispatching(true)}>
          <PlayIcon /> Run workflow
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => void refresh()}>
          <RefreshCwIcon className={cn(sync?.running && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open on GitHub"
          onClick={() => openExternal(`https://github.com/${repo}/actions`)}
        >
          <ExternalLinkIcon />
        </Button>
      </header>
      {sync?.error ? (
        <p className="border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          Sync failed: {String((sync.error as Error).message ?? sync.error)}
        </p>
      ) : null}
      <ul className="flex-1 overflow-y-auto">
        {visible.map((run, index) => (
          <RunRow
            key={run.id}
            run={run}
            index={index}
            selected={index === selected}
            onSelect={() => setSelected(index)}
            onOpen={() => open(run)}
          />
        ))}
        {visible.length === 0 && (
          <li className="p-8 text-center text-sm text-muted-foreground">
            {sync?.lastSuccess || runs.length > 0 ? "No matching runs." : "Loading runs…"}
          </li>
        )}
      </ul>
      <DispatchDialog
        repo={repo}
        workflows={workflows}
        initialWorkflow={workflow === ALL_WORKFLOWS ? undefined : Number(workflow)}
        open={dispatching}
        onOpenChange={setDispatching}
      />
    </div>
  )
}

function RunRow({
  run,
  index,
  selected,
  onSelect,
  onOpen,
}: {
  run: WorkflowRun
  index: number
  selected: boolean
  onSelect: () => void
  onOpen: () => void
}) {
  const completed = run.status === "completed"
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: rows are keyboard driven through j/k and Enter
    <li
      data-row={index}
      className={cn(
        "flex cursor-default items-center gap-3 border-b px-4 py-2 text-sm",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
      onMouseMove={onSelect}
      onClick={onOpen}
    >
      <StateIcon state={runState(run.status, run.conclusion)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{run.displayTitle}</div>
        <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="text-foreground/80">{run.name}</span>
          <span>
            #{run.runNumber}
            {run.runAttempt > 1 && ` (attempt ${run.runAttempt})`}
          </span>
          <span>·</span>
          <span>{run.event}</span>
          {run.actor && <span>by {run.actor}</span>}
        </div>
      </div>
      {run.headBranch && (
        <code className="max-w-48 truncate rounded bg-muted px-1.5 py-0.5 text-xs">
          {run.headBranch}
        </code>
      )}
      <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
        {duration(run.createdAt, completed ? run.updatedAt : null)}
      </span>
      <span className="w-16 text-right text-xs text-muted-foreground">
        <RelativeTime iso={run.createdAt} />
      </span>
    </li>
  )
}
