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
import { CheckIcon, ClockIcon, RefreshCwIcon, Undo2Icon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useJobStatus, useSession, useWatch } from "@/app/client"
import { useShortcuts } from "@/app/shortcuts"
import { ReviewBadge, rollupState, StateIcon } from "@/components/status"
import { RelativeTime } from "@/components/time"
import { PullContent, type PullTab } from "./pull/pull-page"

type View = "active" | "snoozed" | "settled" | "failures"

export function Inbox() {
  const { client, viewer } = useSession()
  const pulls = useLiveQuery((q) => q.from({ p: client.collections.pulls.collection })).data
  const groups = useLiveQuery((q) => q.from({ g: client.collections.groups.collection })).data
  const preferences = useLiveQuery((q) =>
    q.from({ p: client.collections.inboxPreferences.collection }),
  ).data
  const [view, setView] = useState<View>("active")
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
  const visible = entries.filter(({ pull, state }) => {
    if (
      view === "failures" ? !["FAILURE", "ERROR"].includes(pull.checkState ?? "") : state !== view
    )
      return false
    return `${pull.repo} #${pull.number} ${pull.title} ${pull.author ?? ""}`
      .toLowerCase()
      .includes(text.trim().toLowerCase())
  })
  const selected = entries.find((entry) => entry.pull.id === selectedId)
  const select = (pull: PullRequest) => {
    setSelectedId(pull.id)
    setTab("conversation")
  }
  const step = (direction: number) => {
    const index = visible.findIndex((entry) => entry.pull.id === selectedId)
    const next = visible[Math.max(0, Math.min(visible.length - 1, index + direction))]
    if (next) select(next.pull)
  }
  useShortcuts({ j: () => step(1), k: () => step(-1), "/": () => search.current?.focus() })

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <h1 className="font-semibold">PR inbox</h1>
        <select
          aria-label="Inbox scope"
          className="rounded-md border bg-background px-2 py-1 text-sm"
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
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh inbox"
          className="ml-auto"
          onClick={() =>
            void Promise.all(groups.map((g) => client.refresh(jobKeys.groupPulls(g.id))))
          }
        >
          <RefreshCwIcon className={cn(status?.running && "animate-spin")} />
        </Button>
      </header>
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">
        {!online && "Offline · Showing cached PRs. "}PRs from synced groups. GitHub access and
        result limits apply. Snooze and settle are private to this app.
      </p>
      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Pull request inbox"
          className={cn(
            "min-h-0 w-full shrink-0 flex-col border-r lg:flex lg:w-80 xl:w-96",
            selected ? "hidden" : "flex",
          )}
        >
          <div className="flex flex-col gap-2 border-b p-3">
            <fieldset className="flex flex-wrap gap-1" aria-label="Inbox state">
              {(["active", "snoozed", "settled", "failures"] as const).map((state) => (
                <Button
                  key={state}
                  size="sm"
                  variant={view === state ? "secondary" : "ghost"}
                  aria-pressed={view === state}
                  onClick={() => {
                    setView(state)
                    setSelectedId(null)
                  }}
                >
                  {state === "failures" ? "Failures" : state[0]!.toUpperCase() + state.slice(1)}
                </Button>
              ))}
            </fieldset>
            <Input
              ref={search}
              aria-label="Filter inbox"
              placeholder="Filter PRs /"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {view === "failures" && (
              <p className="text-xs text-muted-foreground">
                Failures across all states, including snoozed and settled.
              </p>
            )}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((entry) => (
              <li key={entry.pull.id} className="border-b">
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col gap-1.5 px-3 py-3 text-left text-sm hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring",
                    selectedId === entry.pull.id && "bg-accent",
                  )}
                  aria-current={selectedId === entry.pull.id ? "true" : undefined}
                  onClick={() => select(entry.pull)}
                >
                  <span className="text-xs font-semibold break-all">
                    {entry.pull.repo} #{entry.pull.number}
                  </span>
                  <span className="font-medium">
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
            ))}
            {visible.length === 0 && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                {status?.running && !status.lastSuccess
                  ? "Loading pull requests…"
                  : "No pull requests in this view."}
              </li>
            )}
          </ul>
        </section>
        <section
          aria-label="Selected pull request"
          className={cn("min-h-0 min-w-0 flex-1 flex-col", selected ? "flex" : "hidden lg:flex")}
        >
          {selected ? (
            <>
              <InboxActions
                key={selected.pull.id}
                pull={selected.pull}
                state={selected.state}
                snoozedUntil={selected.preference?.snoozedUntil}
              />
              <div className="min-h-0 flex-1">
                <PullContent
                  key={selected.pull.id}
                  owner={selected.pull.repo.split("/")[0]!}
                  name={selected.pull.repo.split("/")[1]!}
                  number={selected.pull.number}
                  tab={tab}
                  onTabChange={setTab}
                  onBack={() => setSelectedId(null)}
                />
              </div>
            </>
          ) : (
            <p className="m-auto p-6 text-center text-sm text-muted-foreground">
              Select a PR to review its conversation, files and checks.
            </p>
          )}
        </section>
      </div>
    </div>
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
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
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
