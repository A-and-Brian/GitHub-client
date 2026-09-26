import {
  GitHubError,
  groupStarts,
  groupsContaining,
  type Job,
  type LogLine,
  markMatches,
  parseLog,
  searchLog,
  visibleLines,
} from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Checkbox } from "@github-client/ui/components/checkbox"
import { Input } from "@github-client/ui/components/input"
import { Label } from "@github-client/ui/components/label"
import { cn } from "@github-client/ui/lib/utils"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CopyIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useClient } from "@/app/client"
import { useShortcuts } from "@/app/shortcuts"

const ROW_HEIGHT = 20
const RUNNING_POLL_MS = 10_000

type LogState =
  | { status: "loading" }
  | { status: "ready"; raw: string }
  | { status: "error"; message: string; pending: boolean }

/** Fetches a job's log, and refetches it every few seconds while the job runs. */
function useJobLog(job: Job) {
  const client = useClient()
  const [state, setState] = useState<LogState>({ status: "loading" })
  const [reload, setReload] = useState(0)
  const running = job.status !== "completed"

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` forces a refetch
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const raw = await client.fetchJobLog(job.repo, job.id)
        if (!cancelled) setState({ status: "ready", raw })
      } catch (error) {
        if (!cancelled) setState((s) => (s.status === "ready" ? s : logError(error, running)))
      }
      if (!cancelled && running) timer = setTimeout(load, RUNNING_POLL_MS)
    }
    setState({ status: "loading" })
    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, job.repo, job.id, running, reload])

  return { state, reload: () => setReload((n) => n + 1) }
}

function logError(error: unknown, running: boolean): LogState {
  const status = error instanceof GitHubError ? error.status : undefined
  if (running && status === 404)
    return { status: "error", pending: true, message: "The log is not available yet." }
  if (status === 410)
    return { status: "error", pending: false, message: "This log has expired and was deleted." }
  if (status === 404)
    return {
      status: "error",
      pending: false,
      message: "No log found. The job may have been skipped or never started.",
    }
  const message = error instanceof Error ? error.message : String(error)
  return { status: "error", pending: false, message: `Could not load the log: ${message}` }
}

export function LogViewer({ job }: { job: Job }) {
  const { state, reload } = useJobLog(job)
  const running = job.status !== "completed"
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {running && (
        <p className="border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          This job is still running. GitHub's API does not stream live step output, so the log
          refreshes every {RUNNING_POLL_MS / 1000} seconds and step status updates above.
        </p>
      )}
      {state.status === "loading" && (
        <p className="p-4 text-sm text-muted-foreground">Loading log…</p>
      )}
      {state.status === "error" && (
        <div className="flex items-center gap-3 p-4 text-sm">
          <span className={state.pending ? "text-muted-foreground" : "text-destructive"}>
            {state.message}
          </span>
          <Button variant="outline" size="xs" onClick={reload}>
            <RefreshCwIcon /> Retry
          </Button>
        </div>
      )}
      {state.status === "ready" && <LogLines raw={state.raw} />}
    </div>
  )
}

function LogLines({ raw }: { raw: string }) {
  const lines = useMemo(() => parseLog(raw), [raw])
  const [collapsed, setCollapsed] = useState(() => new Set(groupStarts(lines)))
  const [showTimes, setShowTimes] = useState(false)
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [current, setCurrent] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => searchLog(lines, deferredQuery), [lines, deferredQuery])
  const visible = useMemo(() => visibleLines(lines, collapsed), [lines, collapsed])
  const position = useMemo(() => new Map(visible.map((index, row) => [index, row])), [visible])
  const width = useMemo(() => lines.reduce((max, l) => Math.max(max, l.text.length), 0), [lines])

  useEffect(() => {
    setCurrent(0)
    const open = groupsContaining(lines, matches)
    if (open.size === 0) return
    setCollapsed((prev) => {
      if (![...open].some((g) => prev.has(g))) return prev
      return new Set([...prev].filter((g) => !open.has(g)))
    })
  }, [lines, matches])

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  })

  const target = matches[current]
  const targetRow = target === undefined ? undefined : position.get(target)
  useEffect(() => {
    if (targetRow !== undefined) virtualizer.scrollToIndex(targetRow, { align: "center" })
  }, [targetRow, virtualizer])

  const step = (delta: number) => {
    if (matches.length === 0) return
    setCurrent((i) => (i + delta + matches.length) % matches.length)
  }

  const toggle = (group: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(group)) next.add(group)
      return next
    })

  const focusSearch = () => {
    searchRef.current?.focus()
    searchRef.current?.select()
  }
  useShortcuts({ "/": focusSearch, "mod+f": focusSearch })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      toast.success(`Copied ${lines.length.toLocaleString()} lines`)
    } catch (e) {
      toast.error(`Copy failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const gutter = String(lines.length).length

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Input
          ref={searchRef}
          className="h-7 w-64"
          placeholder="Search log  /"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              step(e.shiftKey ? -1 : 1)
            } else if (e.key === "Escape") e.currentTarget.blur()
          }}
        />
        <span className="w-16 text-xs tabular-nums text-muted-foreground">
          {deferredQuery ? `${matches.length ? current + 1 : 0} / ${matches.length}` : ""}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous match"
          disabled={!matches.length}
          onClick={() => step(-1)}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next match"
          disabled={!matches.length}
          onClick={() => step(1)}
        >
          <ChevronDownIcon />
        </Button>
        <Label className="ml-auto flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
          <Checkbox checked={showTimes} onCheckedChange={setShowTimes} />
          Timestamps
        </Label>
        <Button variant="ghost" size="xs" onClick={() => setCollapsed(new Set())}>
          Expand all
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setCollapsed(new Set(groupStarts(lines)))}>
          Collapse all
        </Button>
        <Button variant="ghost" size="xs" onClick={copy}>
          <CopyIcon /> Copy
        </Button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto font-mono text-xs">
        {lines.length === 0 && <p className="p-4 text-muted-foreground">The log is empty.</p>}
        <div
          className="relative"
          style={{
            height: virtualizer.getTotalSize(),
            minWidth: `calc(${width + gutter + (showTimes ? 10 : 0) + 4}ch + 2rem)`,
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const line = lines[visible[item.index]!]!
            return (
              <Row
                key={line.index}
                line={line}
                top={item.start}
                gutter={gutter}
                showTime={showTimes}
                query={deferredQuery}
                current={line.index === target}
                collapsed={collapsed.has(line.index)}
                onToggle={() => toggle(line.index)}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}

const KIND_CLASS: Partial<Record<LogLine["kind"], string>> = {
  error: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  notice: "text-info",
  command: "text-info",
  debug: "text-muted-foreground",
  group: "font-medium hover:bg-accent/50 cursor-pointer",
}

function Row({
  line,
  top,
  gutter,
  showTime,
  query,
  current,
  collapsed,
  onToggle,
}: {
  line: LogLine
  top: number
  gutter: number
  showTime: boolean
  query: string
  current: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  const isGroup = line.kind === "group"
  const segments = markMatches(line.segments, query)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: group rows toggle on click; search reaches hidden lines
    <div
      className={cn(
        "absolute left-0 flex w-full items-center whitespace-pre",
        KIND_CLASS[line.kind],
        current && "ring-1 ring-inset ring-primary",
      )}
      style={{ top, height: ROW_HEIGHT }}
      onClick={isGroup ? onToggle : undefined}
    >
      <span
        className="shrink-0 select-none pr-3 pl-2 text-right text-muted-foreground/70"
        style={{ width: `calc(${gutter}ch + 1.25rem)` }}
      >
        {line.index + 1}
      </span>
      {showTime && (
        <span className="w-[10ch] shrink-0 select-none text-muted-foreground">
          {line.timestamp ? new Date(line.timestamp).toLocaleTimeString([], { hour12: false }) : ""}
        </span>
      )}
      <span className={cn("w-4 shrink-0", line.group !== null && "border-l ml-1")}>
        {isGroup &&
          (collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          ))}
      </span>
      <span>
        {segments.map((s, i) => {
          const { match } = s
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond order
              key={i}
              className={cn(
                s.bold && "font-bold",
                s.italic && "italic",
                s.underline && "underline",
                match && "rounded-sm bg-yellow-300 text-black",
              )}
              style={match ? undefined : { color: s.fg, backgroundColor: s.bg }}
            >
              {s.text}
            </span>
          )
        })}
      </span>
    </div>
  )
}
