import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { InboxPull, PullRequest } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@github-client/ui/components/dropdown-menu"
import { Input } from "@github-client/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@github-client/ui/components/popover"
import { cn } from "@github-client/ui/lib/utils"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  Undo2Icon,
} from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"
import { RelativeTime } from "@/components/time"
import { InboxCheck } from "./inbox-check"

export type InboxRowAction = (pull: PullRequest) => void

export function InboxRow({
  entry,
  selected,
  now,
  online,
  dragDisabled,
  busy,
  onSelect,
  onPin,
  onUnpin,
  onSnooze,
  onSettle,
  onRestore,
  onMove,
}: {
  entry: InboxPull
  selected: boolean
  now: number
  online: boolean
  dragDisabled: boolean
  busy: boolean
  onSelect: (pull: PullRequest) => void
  onPin: InboxRowAction
  onUnpin: InboxRowAction
  onSnooze: (pull: PullRequest, until: string) => void
  onSettle: InboxRowAction
  onRestore: InboxRowAction
  onMove: (pull: PullRequest, direction: -1 | 1) => void
}) {
  const pull = entry.pull
  const pinned = entry.preference?.pinOrder !== undefined
  const compact = entry.state !== "active"
  const checkId = useId()
  const sortable = useSortable({
    id: pull.id,
    disabled: dragDisabled || busy,
    transition: { duration: 150, easing: "ease-out" },
  })
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [custom, setCustom] = useState("")
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }
  const snooze = (timestamp: number) => {
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
      toast.error("Choose a future return time.")
      return
    }
    onSnooze(pull, new Date(timestamp).toISOString())
    setSnoozeOpen(false)
  }
  const tomorrow = () => {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    date.setHours(9, 0, 0, 0)
    return date.getTime()
  }

  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      data-pull-id={pull.id}
      data-inbox-section={pinned && entry.state === "active" ? "pinned" : entry.state}
      data-selected={selected || undefined}
      className={cn(
        "inbox-sortable-row group/row relative border-b border-border/70 outline-none motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-reduce:transition-none",
        compact ? "min-h-9 px-2 py-1" : "min-h-20 px-2 py-2",
        selected && "bg-sidebar-accent",
        sortable.isDragging && "z-10 opacity-40",
        sortable.isOver && !sortable.isDragging && "ring-1 ring-inset ring-ring",
      )}
    >
      <button
        type="button"
        {...sortable.listeners}
        data-inbox-row-select
        title={!dragDisabled && !busy ? "Drag to reorder or move between sections" : undefined}
        aria-current={selected ? "page" : undefined}
        aria-label={`${pull.repo} #${pull.number}: ${pull.title}`}
        aria-describedby={compact ? `${checkId} ${checkId}-time` : checkId}
        onClick={() => onSelect(pull)}
        className={cn(
          "relative w-full touch-pan-y text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !dragDisabled && !busy && "cursor-grab pl-4 active:cursor-grabbing",
          compact ? "flex min-h-7 items-center gap-1.5 pr-7" : "flex flex-col gap-1",
        )}
      >
        {!dragDisabled && !busy && (
          <GripVerticalIcon
            aria-hidden="true"
            className="absolute left-0 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
        )}
        {compact ? (
          <>
            <GitPullRequestIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span
              className="min-w-0 flex-1 truncate text-xs font-medium"
              title={`${pull.repo} #${pull.number}: ${pull.title}`}
            >
              {pull.isDraft && "Draft: "}
              {pull.title}
            </span>
            <InboxCheck id={checkId} pull={pull} now={now} online={online} />
            <ParkedTime id={`${checkId}-time`} entry={entry} now={now} />
          </>
        ) : (
          <>
            <span className="flex w-full min-w-0 items-center gap-1.5 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-semibold" title={pull.repo}>
                {pull.repo}
              </span>
              <span className="shrink-0 text-muted-foreground">#{pull.number}</span>
              <InboxCheck id={checkId} pull={pull} now={now} online={online} />
              <span className="shrink-0 text-[10px] text-muted-foreground">
                <RelativeTime iso={pull.updatedAt} />
              </span>
            </span>
            <span className="line-clamp-2 min-w-0 text-xs font-medium leading-4" title={pull.title}>
              {pull.isDraft && "Draft: "}
              {pull.title}
            </span>
            <span
              className="flex h-6 w-full min-w-0 items-center gap-1 text-[10px] text-muted-foreground"
              title={`${pull.headRef} → ${pull.baseRef} · ${pull.author ?? "Unknown author"}`}
            >
              <GitBranchIcon aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">{pull.headRef}</span>
            </span>
          </>
        )}
      </button>
      <div
        className={cn(
          "inbox-row-actions absolute right-1 flex items-center gap-0.5 rounded bg-sidebar opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
          compact ? "top-1" : "bottom-1",
        )}
      >
        {entry.state === "active" && (
          <>
            <Button
              type="button"
              data-inbox-control
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`${pinned ? "Unpin" : "Pin"} ${pull.title}`}
              className="inbox-direct-action size-6"
              title={pinned ? "Unpin" : "Pin"}
              onClick={() => (pinned ? onUnpin(pull) : onPin(pull))}
            >
              {pinned ? <PinOffIcon /> : <PinIcon />}
            </Button>
            <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    data-inbox-control
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Snooze ${pull.title}`}
                    className="inbox-direct-action size-6"
                    title="Snooze"
                  />
                }
              >
                <ClockIcon />
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-56 flex-col gap-1.5">
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
                  onClick={() => snooze(Date.now() + 3 * 60 * 60_000)}
                >
                  In three hours
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start"
                  disabled={busy}
                  onClick={() => snooze(tomorrow())}
                >
                  Tomorrow at 9:00 AM
                </Button>
                <label className="text-xs" htmlFor={`snooze-${pull.id}`}>
                  Custom time ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                </label>
                <Input
                  id={`snooze-${pull.id}`}
                  type="datetime-local"
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                />
                <Button
                  disabled={busy || !custom}
                  onClick={() => snooze(new Date(custom).getTime())}
                >
                  Snooze until selected time
                </Button>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              data-inbox-control
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`Settle locally: ${pull.title}`}
              className="inbox-direct-action size-6"
              title="Remove from Active only. Does not approve, merge, or close the GitHub PR."
              onClick={() => onSettle(pull)}
            >
              <CheckIcon />
            </Button>
          </>
        )}
        {entry.state !== "active" && (
          <Button
            type="button"
            data-inbox-control
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`${entry.state === "snoozed" ? "Wake" : "Restore"} ${pull.title}`}
            className="inbox-direct-action size-6"
            title={entry.state === "snoozed" ? "Wake" : "Restore"}
            onClick={() => onRestore(pull)}
          >
            <Undo2Icon />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                data-inbox-control
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`Actions for ${pull.title}`}
                className="size-6"
                title="More actions"
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {entry.state === "active" && pinned && (
              <DropdownMenuItem disabled={busy} onClick={() => onUnpin(pull)}>
                Unpin
              </DropdownMenuItem>
            )}
            {entry.state === "active" && !pinned && (
              <DropdownMenuItem disabled={busy} onClick={() => onPin(pull)}>
                Pin
              </DropdownMenuItem>
            )}
            {entry.state === "active" && (
              <>
                <DropdownMenuItem disabled={busy || dragDisabled} onClick={() => onMove(pull, -1)}>
                  <ArrowUpIcon />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || dragDisabled} onClick={() => onMove(pull, 1)}>
                  <ArrowDownIcon />
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onClick={() => setSnoozeOpen(true)}>
                  Snooze…
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onClick={() => onSettle(pull)}>
                  Settle locally
                </DropdownMenuItem>
              </>
            )}
            {entry.state !== "active" && (
              <DropdownMenuItem disabled={busy} onClick={() => onRestore(pull)}>
                {entry.state === "snoozed" ? "Wake to previous position" : "Restore to Active"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

function ParkedTime({ entry, now, id }: { entry: InboxPull; now: number; id: string }) {
  const wake = entry.state === "snoozed" ? entry.preference?.snoozedUntil : null
  const timestamp = wake ?? entry.preference?.changedAt ?? entry.pull.updatedAt
  const minutes = Math.max(1, Math.round(Math.abs(Date.parse(timestamp) - now) / 60_000))
  const label =
    minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.round(minutes / 60)}h`
        : `${Math.round(minutes / 1440)}d`
  const description = `${wake ? "Wakes" : "Settled"} ${new Date(timestamp).toLocaleString()}`
  return (
    <time
      id={id}
      dateTime={timestamp}
      title={description}
      className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
    >
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{description}</span>
    </time>
  )
}
