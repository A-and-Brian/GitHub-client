import { jobKeys, type PullRequest } from "@github-client/core"
import { deriveInboxPulls } from "@github-client/core/inbox"
import { Button } from "@github-client/ui/components/button"
import { Input } from "@github-client/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@github-client/ui/components/popover"
import { cn } from "@github-client/ui/lib/utils"
import { useLiveQuery } from "@tanstack/react-db"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  InboxIcon,
  InfoIcon,
  RefreshCwIcon,
  Undo2Icon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useJobStatus, useSession, useWatch } from "@/app/client"
import { useShortcuts } from "@/app/shortcuts"
import { ContributionCalendar } from "@/components/contribution-calendar"
import { ReviewBadge, rollupState, StateIcon } from "@/components/status"
import { RelativeTime } from "@/components/time"
import { AccountSyncFooter, InboxScopeChooser } from "./layout"
import { PullContent, type PullTab } from "./pull/pull-page"

export function Inbox() {
  const { client, viewer } = useSession()
  const pulls = useLiveQuery((q) => q.from({ p: client.collections.pulls.collection })).data
  const groups = useLiveQuery((q) => q.from({ g: client.collections.groups.collection })).data
  const preferences = useLiveQuery((q) =>
    q.from({ p: client.collections.inboxPreferences.collection }),
  ).data
  const [failures, setFailures] = useState(false)
  const [expanded, setExpanded] = useState({ snoozed: false, settled: false })
  const [scope, setScope] = useState<"involving" | "all">("involving")
  const [text, setText] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PullTab>("conversation")
  const [now, setNow] = useState(Date.now)
  const [online, setOnline] = useState(() => navigator.onLine)
  const search = useRef<HTMLInputElement>(null)
  useWatch((c) => c.watchGroup("me"), [])
  const status = useJobStatus(jobKeys.groupPulls("me"))

  useEffect(() => {
    const tick = () => {
      setNow(Date.now())
      setOnline(navigator.onLine)
    }
    const timer = window.setInterval(tick, 30_000)
    window.addEventListener("focus", tick)
    window.addEventListener("online", tick)
    window.addEventListener("offline", tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", tick)
      window.removeEventListener("online", tick)
      window.removeEventListener("offline", tick)
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcile when persisted preferences hydrate or change
  useEffect(() => {
    void client
      .reconcileInboxState(viewer.login, pulls, now, groups)
      .catch((error: unknown) => toast.error(String(error)))
  }, [client, viewer.login, pulls, groups, preferences, now])

  const entries = useMemo(
    () =>
      deriveInboxPulls(pulls, groups, viewer.login, preferences, now, scope).sort(
        (a, b) =>
          b.pull.updatedAt.localeCompare(a.pull.updatedAt) ||
          a.pull.repo.localeCompare(b.pull.repo) ||
          a.pull.number - b.pull.number,
      ),
    [pulls, groups, viewer.login, preferences, now, scope],
  )
  const matching = entries.filter(({ pull }) => {
    return `${pull.repo} #${pull.number} ${pull.title} ${pull.author ?? ""}`
      .toLowerCase()
      .includes(text.trim().toLowerCase())
  })
  const failuresList = matching.filter(({ pull }) =>
    ["FAILURE", "ERROR"].includes(pull.checkState ?? ""),
  )
  const activeEntries = matching.filter(({ state }) => state === "active")
  const snoozedEntries = matching.filter(({ state }) => state === "snoozed")
  const settledEntries = matching.filter(({ state }) => state === "settled")
  const visible = failures ? failuresList : activeEntries
  const selected = entries.find((entry) => entry.pull.id === selectedId)
  const select = (pull: PullRequest) => {
    setSelectedId(pull.id)
    setTab("conversation")
  }
  const navigable = failures
    ? failuresList
    : [
        ...activeEntries,
        ...(expanded.snoozed ? snoozedEntries : []),
        ...(expanded.settled ? settledEntries : []),
      ]
  const step = (direction: number) => {
    const index = navigable.findIndex((entry) => entry.pull.id === selectedId)
    const next = navigable[Math.max(0, Math.min(navigable.length - 1, index + direction))]
    if (next) select(next.pull)
  }
  useShortcuts({ j: () => step(1), k: () => step(-1), "/": () => search.current?.focus() })

  return (
    <div className="flex h-full min-w-0">
      <aside
        aria-label="Pull request inbox"
        className={cn(
          "flex min-h-0 w-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:w-[320px] lg:w-[340px]",
          selected && "hidden md:flex",
        )}
      >
        <header className="space-y-3 border-b p-3">
          <h1 className="flex items-center gap-2 px-1 text-sm font-semibold">
            <InboxIcon className="size-4" />
            PR inbox
          </h1>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="h-8 w-full justify-start text-sm font-medium"
                  aria-label="Browse inbox and groups"
                />
              }
            >
              Inbox <ChevronDownIcon className="ml-auto size-4 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-[70vh] w-[min(300px,85vw)] overflow-y-auto p-2"
            >
              <PopoverTitle className="sr-only">Inbox and groups</PopoverTitle>
              <InboxScopeChooser />
            </PopoverContent>
          </Popover>
        </header>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <select
            aria-label="Inbox scope"
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as typeof scope)
              setSelectedId(null)
            }}
          >
            <option value="involving">Involving me</option>
            <option value="all">All synced PRs</option>
          </select>
          <Button
            variant={failures ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={failures}
            onClick={() => setFailures((value) => !value)}
          >
            Failures
          </Button>
        </div>
        {!online && (
          <p role="status" className="border-b px-3 py-1.5 text-xs text-muted-foreground">
            Offline · showing cached PRs.
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b p-3">
            <Input
              ref={search}
              aria-label="Filter inbox"
              placeholder="Filter PRs"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh inbox"
              onClick={() =>
                void Promise.all(groups.map((g) => client.refresh(jobKeys.groupPulls(g.id))))
              }
            >
              <RefreshCwIcon className={cn(status?.running && "animate-spin")} />
            </Button>
            <Popover>
              <PopoverTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="About this inbox" />}
              >
                <InfoIcon />
              </PopoverTrigger>
              <PopoverContent align="end" className="max-w-64 text-sm text-muted-foreground">
                {!online && <p>Offline · showing cached PRs.</p>}
                <p>
                  Local inbox for PRs from synced groups. GitHub access and result limits apply.
                  Snooze and settle are private to this app.
                </p>
              </PopoverContent>
            </Popover>
          </div>
          {!failures && (
            <h2 className="border-b px-3 py-2 text-xs font-semibold text-muted-foreground">
              Active <span className="ml-1 font-normal tabular-nums">{activeEntries.length}</span>
            </h2>
          )}
          {failures && (
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">
              Failures across all states, including snoozed and settled.
            </p>
          )}
          <ul
            aria-label={failures ? "Pull request failures" : "Active pull requests"}
            className="min-h-[80px] min-w-0 flex-1 overflow-y-auto"
          >
            {visible.map((entry) => (
              <InboxRow
                key={entry.pull.id}
                entry={entry}
                selectedId={selectedId}
                now={now}
                online={online}
                select={select}
              />
            ))}
            {visible.length === 0 && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                {status?.running && !status.lastSuccess
                  ? "Loading pull requests…"
                  : failures
                    ? "No failed checks in this view."
                    : "No active pull requests."}
              </li>
            )}
          </ul>
          {!failures && (
            <div className="min-h-0 max-h-[40%] shrink-0 overflow-y-auto border-t">
              <InboxSection
                title="Snoozed"
                count={snoozedEntries.length}
                hasItems={snoozedEntries.length > 0}
                expanded={expanded.snoozed}
                onToggle={() => setExpanded((value) => ({ ...value, snoozed: !value.snoozed }))}
              >
                {snoozedEntries.map((entry) => (
                  <InboxRow
                    key={entry.pull.id}
                    entry={entry}
                    selectedId={selectedId}
                    now={now}
                    online={online}
                    select={select}
                  />
                ))}
              </InboxSection>
              <InboxSection
                title="Settled"
                count={settledEntries.length}
                hasItems={settledEntries.length > 0}
                expanded={expanded.settled}
                onToggle={() => setExpanded((value) => ({ ...value, settled: !value.settled }))}
              >
                {settledEntries.map((entry) => (
                  <InboxRow
                    key={entry.pull.id}
                    entry={entry}
                    selectedId={selectedId}
                    now={now}
                    online={online}
                    select={select}
                  />
                ))}
              </InboxSection>
            </div>
          )}
        </div>
        <ContributionCalendar />
        <AccountSyncFooter />
      </aside>
      <section
        aria-label="Selected pull request"
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden",
          !selected && "hidden md:flex",
        )}
      >
        {selected && (
          <div className="flex min-h-0 flex-1 flex-col">
            <PullContent
              key={selected.pull.id}
              owner={selected.pull.repo.split("/")[0]!}
              name={selected.pull.repo.split("/")[1]!}
              number={selected.pull.number}
              tab={tab}
              onTabChange={setTab}
              onBack={() => {
                setSelectedId(null)
                window.requestAnimationFrame(() => search.current?.focus())
              }}
              backLabel="Back to inbox"
              actions={
                <InboxActions
                  pull={selected.pull}
                  state={selected.state}
                  snoozedUntil={selected.preference?.snoozedUntil}
                />
              }
            />
          </div>
        )}
        {!selected && (
          <p className="m-auto max-w-sm p-6 text-center text-sm text-muted-foreground">
            Select a PR to review its conversation, files and checks.
          </p>
        )}
      </section>
    </div>
  )
}

function InboxSection({
  title,
  count,
  hasItems,
  expanded,
  onToggle,
  children,
}: {
  title: string
  count: number
  hasItems: boolean
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-sidebar-accent"
      >
        {expanded ? (
          <ChevronDownIcon className="size-4" />
        ) : (
          <ChevronRightIcon className="size-4" />
        )}
        {title}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
      </button>
      {expanded && (
        <ul>
          {hasItems ? (
            children
          ) : (
            <li className="px-9 py-2 text-xs text-muted-foreground">
              No {title.toLowerCase()} PRs
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function InboxRow({
  entry,
  selectedId,
  now,
  online,
  select,
}: {
  entry: ReturnType<typeof deriveInboxPulls>[number]
  selectedId: string | null
  now: number
  online: boolean
  select: (pull: PullRequest) => void
}) {
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        className={cn(
          "flex w-full flex-col gap-1.5 px-3 py-3 text-left text-sm hover:bg-sidebar-accent focus-visible:outline focus-visible:outline-ring",
          selectedId === entry.pull.id && "bg-sidebar-accent",
        )}
        aria-current={selectedId === entry.pull.id ? "true" : undefined}
        onClick={() => select(entry.pull)}
      >
        <span className="flex items-center justify-between gap-2 text-xs font-semibold">
          <span className="truncate">{entry.pull.repo}</span>
          <span className="shrink-0 text-muted-foreground">#{entry.pull.number}</span>
        </span>
        <span className="line-clamp-2 font-medium">
          {entry.pull.isDraft && "Draft: "}
          {entry.pull.title}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <InboxCheck pull={entry.pull} now={now} online={online} />
          <ReviewBadge decision={entry.pull.reviewDecision} />
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="capitalize">{entry.state}</span>
          {entry.state === "snoozed" && entry.preference?.snoozedUntil && (
            <span>Until {new Date(entry.preference.snoozedUntil).toLocaleString()}</span>
          )}
          <RelativeTime iso={entry.pull.updatedAt} />
        </span>
      </button>
    </li>
  )
}

function InboxCheck({ pull, now, online }: { pull: PullRequest; now: number; online: boolean }) {
  const status = useJobStatus(jobKeys.groupPulls(pull.groupId))
  const stale = !status?.lastSuccess || now - status.lastSuccess > 3 * 60_000
  const state = rollupState(pull.checkState)
  if (!online || status?.error || stale)
    return (
      <span className="text-muted-foreground">
        {!online ? "Offline · " : status?.error ? "Sync failed · " : "Awaiting refresh · "}last
        check: {state ?? "unknown"}
      </span>
    )
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        state === "failure" && "font-semibold text-destructive",
      )}
    >
      {state && <StateIcon state={state} />}
      {state === "failure"
        ? "Checks failed"
        : state === "success"
          ? "Checks passed"
          : state === "pending"
            ? "Checks pending"
            : "Checks unknown"}
    </span>
  )
}

function InboxActions({
  pull,
  state,
  snoozedUntil,
}: {
  pull: PullRequest
  state: "active" | "snoozed" | "settled"
  snoozedUntil?: string | null
}) {
  const { client, viewer } = useSession()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState("")
  const run = async (action: () => Promise<unknown>, label: string, undo = false) => {
    setBusy(true)
    try {
      await action()
      setOpen(false)
      toast.success(
        label,
        undo
          ? {
              action: {
                label: "Undo",
                onClick: () => {
                  void client
                    .restoreInboxPull(viewer.login, pull)
                    .catch((error: unknown) => toast.error(String(error)))
                },
              },
            }
          : undefined,
      )
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusy(false)
    }
  }
  const snooze = (until: number) => {
    if (!Number.isFinite(until) || until <= Date.now()) {
      toast.error("Choose a future return time.")
      return
    }
    void run(
      () => client.setInboxSnoozed(viewer.login, pull, new Date(until).toISOString()),
      `Snoozed until ${new Date(until).toLocaleString()}`,
      true,
    )
  }
  const tomorrow = () => {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    date.setHours(9, 0, 0, 0)
    return date.getTime()
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="mr-auto text-xs text-muted-foreground">
        {state === "settled"
          ? "Settled locally · GitHub PR unchanged"
          : state === "snoozed"
            ? `Snoozed until ${snoozedUntil ? new Date(snoozedUntil).toLocaleString() : "return time"}`
            : "Active"}
      </span>
      {state === "active" ? (
        <>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" disabled={busy} />}>
              <ClockIcon />
              Snooze
            </PopoverTrigger>
            <PopoverContent align="end">
              <PopoverTitle>Return to Active</PopoverTitle>
              <Button
                variant="ghost"
                className="justify-start"
                disabled={busy}
                onClick={() => snooze(Date.now() + 60 * 60_000)}
              >
                In one hour
              </Button>
              <Button
                variant="ghost"
                className="justify-start"
                disabled={busy}
                onClick={() => snooze(tomorrow())}
              >
                Tomorrow at 9:00 AM
              </Button>
              <label className="text-xs" htmlFor="snooze-time">
                Custom time ({Intl.DateTimeFormat().resolvedOptions().timeZone})
              </label>
              <Input
                id="snooze-time"
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <Button disabled={busy || !custom} onClick={() => snooze(new Date(custom).getTime())}>
                Snooze until selected time
              </Button>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                () => client.settleInboxPull(viewer.login, pull),
                "Settled locally. GitHub PR unchanged.",
                true,
              )
            }
          >
            <CheckIcon />
            Settle
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(() => client.restoreInboxPull(viewer.login, pull), "Returned to Active")
          }
        >
          <Undo2Icon />
          Restore to Active
        </Button>
      )}
    </div>
  )
}
