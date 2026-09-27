import { jobKeys, type PullRequest } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Input } from "@github-client/ui/components/input"
import { Tabs, TabsList, TabsTrigger } from "@github-client/ui/components/tabs"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { Link, useNavigate } from "@tanstack/react-router"
import { MessageSquareIcon, RefreshCwIcon } from "lucide-react"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useClient, useJobStatus, useSession, useWatch } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { groupRoute } from "@/app/router"
import { useShortcuts } from "@/app/shortcuts"
import { UserAvatar } from "@/components/avatar"
import { LabelChip, ReviewBadge, rollupState, StateIcon } from "@/components/status"
import { RelativeTime } from "@/components/time"
import { openExternal } from "@/platform"

type Filter = "all" | "review" | "mine"

export function GroupPulls() {
  const { groupId } = groupRoute.useParams()
  const { client, viewer } = useSession()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>("all")
  const [text, setText] = useState("")
  const [selected, setSelected] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  useWatch((c) => c.watchGroup(groupId), [groupId])
  const status = useJobStatus(jobKeys.groupPulls(groupId))
  const group = useLiveQuery(
    (q) => q.from({ g: client.collections.groups.collection }).where(({ g }) => eq(g.id, groupId)),
    [groupId],
  ).data[0]
  useErrorToast(status?.error, {
    id: `group-pulls-error:${groupId}`,
    title: `Could not refresh pull requests for ${groupId}`,
  })
  const pulls = useLiveQuery(
    (q) =>
      q
        .from({ p: client.collections.pulls.collection })
        .where(({ p }) => eq(p.groupId, groupId))
        .orderBy(({ p }) => p.updatedAt, "desc"),
    [groupId],
  ).data

  const teams = useTeamSlugs()
  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase()
    return pulls
      .filter((p) => {
        if (filter === "mine" && p.author !== viewer.login) return false
        if (
          filter === "review" &&
          !p.reviewRequests.some((r) => r === viewer.login || teams.has(r))
        )
          return false
        if (!needle) return true
        return `${p.title} ${p.repo}#${p.number} ${p.author ?? ""} ${p.headRef}`
          .toLowerCase()
          .includes(needle)
      })
      .sort((a, b) => a.repo.localeCompare(b.repo) || b.updatedAt.localeCompare(a.updatedAt))
  }, [pulls, filter, text, viewer.login, teams])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the selection when the list changes
  useEffect(() => setSelected(0), [groupId, filter, text])
  useEffect(() => {
    document.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selected])

  const open = (pull: PullRequest | undefined) => {
    if (!pull) return
    const [owner, repo] = pull.repo.split("/") as [string, string]
    void navigate({
      to: "/pr/$owner/$repo/$number",
      params: { owner, repo, number: String(pull.number) },
      search: { tab: "conversation" },
    })
  }

  useShortcuts({
    j: () => setSelected((i) => Math.min(i + 1, visible.length - 1)),
    k: () => setSelected((i) => Math.max(i - 1, 0)),
    ArrowDown: () => setSelected((i) => Math.min(i + 1, visible.length - 1)),
    ArrowUp: () => setSelected((i) => Math.max(i - 1, 0)),
    Enter: () => open(visible[selected]),
    o: () => visible[selected] && void openExternal(visible[selected].url),
    "/": () => searchRef.current?.focus(),
    r: () => void client.refresh(jobKeys.groupPulls(groupId)),
    "1": () => setFilter("all"),
    "2": () => setFilter("review"),
    "3": () => setFilter("mine"),
  })

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <h1 className="truncate font-semibold">
          {group?.kind === "team" ? `${group.org} / ${group.name}` : (group?.name ?? groupId)}
        </h1>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All open</TabsTrigger>
            <TabsTrigger value="review">Review requested</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          ref={searchRef}
          className="ml-auto h-8 w-64"
          placeholder="Filter  /"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur()
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          onClick={() => void client.refresh(jobKeys.groupPulls(groupId))}
        >
          <RefreshCwIcon className={cn(status?.running && "animate-spin")} />
        </Button>
      </header>
      {status?.error ? (
        <p className="border-b px-4 py-1.5 text-xs text-muted-foreground">
          Pull requests may be out of date. Use Refresh to try again.
        </p>
      ) : null}
      <ul className="flex-1 overflow-y-auto">
        {visible.map((pull, index) => (
          <Fragment key={pull.key}>
            {(index === 0 || visible[index - 1]?.repo !== pull.repo) && (
              <li className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-muted px-4 py-2 text-sm">
                <h2 className="font-semibold break-all">{pull.repo}</h2>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <Link
                    to="/actions/$owner/$repo"
                    params={{ owner: pull.repo.split("/")[0]!, repo: pull.repo.split("/")[1]! }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Actions
                  </Link>
                  <Link
                    to="/settings/$owner/$repo"
                    params={{ owner: pull.repo.split("/")[0]!, repo: pull.repo.split("/")[1]! }}
                    className="shrink-0 text-xs underline"
                  >
                    Settings
                  </Link>
                </div>
              </li>
            )}
            <PullRow
              pull={pull}
              index={index}
              selected={index === selected}
              onSelect={() => setSelected(index)}
              onPointerEnter={() => void client.prefetchPull(pull.repo, pull.number)}
              onOpen={() => open(pull)}
            />
          </Fragment>
        ))}
        {visible.length === 0 && (
          <li className="p-8 text-center text-sm text-muted-foreground">
            {status?.error && pulls.length === 0
              ? "Pull requests unavailable. Use Refresh to try again."
              : group && (status?.lastSuccess || pulls.length > 0)
                ? "No open pull requests."
                : "Loading pull requests…"}
          </li>
        )}
      </ul>
    </div>
  )
}

/** `org/team` slugs of the viewer's teams, for "review requested" via a team. */
function useTeamSlugs(): Set<string> {
  const client = useClient()
  const groups = useLiveQuery((q) =>
    q.from({ g: client.collections.groups.collection }).where(({ g }) => eq(g.kind, "team")),
  ).data
  return useMemo(() => new Set(groups.map((g) => g.id.slice("team:".length))), [groups])
}

function PullRow({
  pull,
  index,
  selected,
  onSelect,
  onPointerEnter,
  onOpen,
}: {
  pull: PullRequest
  index: number
  selected: boolean
  onSelect: () => void
  onPointerEnter: () => void
  onOpen: () => void
}) {
  const ci = rollupState(pull.checkState)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: rows are keyboard driven through j/k and Enter
    <li
      data-row={index}
      className={cn(
        "flex cursor-default items-center gap-3 border-b px-4 py-2 text-sm",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
      onMouseMove={onSelect}
      onPointerEnter={onPointerEnter}
      onClick={onOpen}
    >
      <span className="w-4">{ci && <StateIcon state={ci} />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-foreground">
            #{pull.number}
          </span>
          <span className={cn("truncate font-medium", pull.isDraft && "text-muted-foreground")}>
            {pull.isDraft && "Draft: "}
            {pull.title}
          </span>
          {pull.labels.slice(0, 3).map((l) => (
            <LabelChip key={l.name} name={l.name} color={l.color} />
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{pull.repo}</span>
          <span className="truncate">{pull.headRef}</span>
        </div>
      </div>
      <ReviewBadge decision={pull.reviewDecision} />
      <span className="w-20 text-right text-xs tabular-nums">
        <span className="text-success">+{pull.additions}</span>{" "}
        <span className="text-destructive">−{pull.deletions}</span>
      </span>
      <span className="flex w-10 items-center justify-end gap-1 text-xs text-muted-foreground">
        {pull.comments > 0 && (
          <>
            <MessageSquareIcon className="size-3.5" />
            {pull.comments}
          </>
        )}
      </span>
      <UserAvatar src={pull.authorAvatarUrl} login={pull.author} />
      <span className="min-w-16 shrink-0 text-right text-xs text-muted-foreground">
        <RelativeTime iso={pull.updatedAt} />
      </span>
    </li>
  )
}
