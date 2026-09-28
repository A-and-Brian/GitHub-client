import { PointerSensor, useDroppable } from "@dnd-kit/core"
import { Button } from "@github-client/ui/components/button"
import { Input } from "@github-client/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@github-client/ui/components/popover"
import { cn } from "@github-client/ui/lib/utils"
import { CheckIcon, ClockIcon, Undo2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

let cancelActiveInboxDrag: (() => void) | null = null
export function cancelInboxDragOnUnmount() {
  cancelActiveInboxDrag?.()
}

export function InboxDropHeader({
  section,
  title,
  count,
  disabled,
}: {
  section: "pinned" | "active" | "snoozed" | "settled"
  title: string
  count: number
  disabled: boolean
}) {
  const drop = useDroppable({ id: `inbox-drop:${section}:header`, disabled })
  return (
    <h2
      ref={drop.setNodeRef}
      data-inbox-section={section}
      className={cn(
        "inbox-drop-header border-b px-3 py-2 text-xs font-semibold text-muted-foreground",
        drop.isOver && "bg-accent/60 text-foreground",
      )}
    >
      {title} <span className="ml-1 font-normal tabular-nums">{count}</span>
    </h2>
  )
}

export class InboxPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: (
        { nativeEvent }: React.PointerEvent,
        _options: ConstructorParameters<typeof PointerSensor>[0]["options"],
      ) => {
        const target = nativeEvent.target instanceof Element ? nativeEvent.target : null
        return (
          nativeEvent.isPrimary &&
          nativeEvent.button === 0 &&
          nativeEvent.pointerType !== "touch" &&
          !target?.closest("[data-inbox-control]")
        )
      },
    },
  ]
  constructor(props: ConstructorParameters<typeof PointerSensor>[0]) {
    let cleanup: (() => void) | null = null
    const finish = (callback: () => void) => () => {
      cleanup?.()
      cleanup = null
      if (cancelActiveInboxDrag === cancel) cancelActiveInboxDrag = null
      callback()
    }
    super({
      ...props,
      onCancel: finish(props.onCancel),
      onEnd: finish(props.onEnd),
      onAbort: () => {
        cleanup?.()
        cleanup = null
        cancelActiveInboxDrag = null
        props.onAbort(props.active)
      },
    })
    const pointer = props.event as PointerEvent
    const ownerDocument = props.activeNode.node.current?.ownerDocument ?? document
    const view = ownerDocument.defaultView
    if (!view) return
    const cancel = () =>
      ownerDocument.dispatchEvent(
        new view.PointerEvent("pointercancel", { pointerId: pointer.pointerId }),
      )
    cancelActiveInboxDrag = cancel
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    const lostButtons = (event: PointerEvent) => {
      if (event.pointerId === pointer.pointerId && (event.buttons & 1) === 0) cancel()
    }
    ownerDocument.addEventListener("keydown", keydown, true)
    ownerDocument.addEventListener("pointermove", lostButtons, true)
    view.addEventListener("blur", cancel)
    view.addEventListener("pagehide", cancel)
    cleanup = () => {
      ownerDocument.removeEventListener("keydown", keydown, true)
      ownerDocument.removeEventListener("pointermove", lostButtons, true)
      view.removeEventListener("blur", cancel)
      view.removeEventListener("pagehide", cancel)
      if (cancelActiveInboxDrag === cancel) cancelActiveInboxDrag = null
    }
  }
}

export function InboxActions({
  state,
  terminalState,
  snoozedUntil,
  busy,
  onSnooze,
  onSettle,
  onRestore,
}: {
  state: "active" | "snoozed" | "settled"
  terminalState?: "CLOSED" | "MERGED"
  snoozedUntil?: string | null
  busy: boolean
  onSnooze: (until: number, close: () => void) => void
  onSettle: (close: () => void) => void
  onRestore: () => void
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState("")
  if (terminalState) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {terminalState === "MERGED" ? "Merged on GitHub" : "Closed on GitHub"}
      </div>
    )
  }
  const snooze = (until: number) => {
    if (!Number.isFinite(until) || until <= Date.now()) {
      toast.error("Choose a future return time.")
      return
    }
    onSnooze(until, () => setOpen(false))
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
            onClick={() => onSettle(() => setOpen(false))}
          >
            <CheckIcon />
            Settle locally
          </Button>
        </>
      ) : (
        <Button variant="outline" size="sm" disabled={busy} onClick={onRestore}>
          <Undo2Icon />
          Restore to Active
        </Button>
      )}
      <p className="w-full text-xs text-muted-foreground">
        Settle locally removes a PR from Active. It does not approve, merge, or close it on GitHub.
        You can restore it anytime.
      </p>
    </div>
  )
}
