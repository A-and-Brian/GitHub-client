import { type DragEndEvent, useSensor, useSensors } from "@dnd-kit/core"
import type { InboxMutationResult, InboxPull, PullRequest } from "@github-client/core"
import { useSession } from "@/app/client"
import { InboxPointerSensor } from "./inbox-parts"
import type { DropPosition } from "./inbox-sidebar"

type RunMutation = (
  pull: PullRequest,
  label: string,
  mutation: () => Promise<InboxMutationResult>,
) => Promise<void>

export function useInboxDrag({
  entries,
  pinnedEntries,
  activeEntries,
  settledEntries,
  failures,
  orderReady,
  draggingId,
  dragOverId,
  setDraggingId,
  setDragOverId,
  setDropPosition,
  onSnoozeDrop,
  runMutation,
}: {
  entries: InboxPull[]
  pinnedEntries: InboxPull[]
  activeEntries: InboxPull[]
  settledEntries: InboxPull[]
  failures: boolean
  orderReady: boolean
  draggingId: string | null
  dragOverId: string | null
  setDraggingId: (id: string | null) => void
  setDragOverId: (id: string | null) => void
  setDropPosition: (position: DropPosition | null) => void
  onSnoozeDrop: (pull: PullRequest) => void
  runMutation: RunMutation
}) {
  const { client, viewer } = useSession()
  const sensors = useSensors(
    useSensor(InboxPointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const dragDisabled = failures || !orderReady
  const dragLabel = getInboxDragLabel(entries, draggingId, dragOverId)
  const onDragStart = (event: { active: { id: string | number } }) => {
    setDragOverId(null)
    setDropPosition(null)
    setDraggingId(String(event.active.id))
  }
  const rankSource = (entry: InboxPull) =>
    entry.preference?.pinOrder !== undefined ? ("pinOrder" as const) : ("activeOrder" as const)
  const moveBy = (pull: PullRequest, direction: -1 | 1) => {
    if (failures || !orderReady) return
    const entry = entries.find((item) => item.pull.id === pull.id)
    if (entry?.state !== "active") return
    const key = rankSource(entry)
    const section = key === "pinOrder" ? pinnedEntries : activeEntries
    const index = section.findIndex((item) => item.pull.id === pull.id)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= section.length) return
    const anchor = section[targetIndex]!.pull.id
    const targetSection = key === "pinOrder" ? ("pinned" as const) : ("active" as const)
    const target = direction < 0 ? { beforePullId: anchor } : { afterPullId: anchor }
    void runMutation(pull, "Inbox order updated", () =>
      client.moveInboxPull(viewer.login, pull, { section: targetSection, ...target }),
    )
  }
  const onDragEnd = (event: DragEndEvent) => {
    const sourceId = String(event.active.id)
    const source = entries.find((entry) => entry.pull.id === sourceId)
    const overId = event.over ? String(event.over.id) : null
    setDraggingId(null)
    setDragOverId(null)
    if (!source || !overId || dragDisabled) {
      setDropPosition(null)
      return
    }
    const sectionTarget = overId.startsWith("inbox-drop:")
      ? (overId.split(":")[1] as "pinned" | "active" | "snoozed" | "settled")
      : null
    if (sectionTarget === "snoozed") {
      setDropPosition(null)
      if (source.state !== "snoozed") onSnoozeDrop(source.pull)
      return
    }
    const overEntry = entries.find((entry) => entry.pull.id === overId)
    const targetSection =
      sectionTarget ??
      (overEntry?.state === "snoozed"
        ? null
        : overEntry?.state === "settled"
          ? "settled"
          : overEntry?.preference?.pinOrder !== undefined
            ? "pinned"
            : "active")
    if (!targetSection || (targetSection === "settled" && source.state === "settled")) {
      setDropPosition(null)
      return
    }
    let anchor: { beforePullId?: string; afterPullId?: string } = {}
    if (overEntry) {
      if (overEntry.pull.id === source.pull.id) {
        setDropPosition(null)
        return
      }
      const translated = event.active.rect.current.translated
      const targetRect = event.over?.rect
      if (translated && targetRect) {
        const activeCenter = translated.top + translated.height / 2
        const targetCenter = targetRect.top + targetRect.height / 2
        anchor =
          activeCenter < targetCenter
            ? { beforePullId: overEntry.pull.id }
            : { afterPullId: overEntry.pull.id }
      } else anchor = { beforePullId: overEntry.pull.id }
    } else {
      const targetEntries =
        targetSection === "pinned"
          ? pinnedEntries
          : targetSection === "active"
            ? activeEntries
            : settledEntries
      if (targetEntries[0]) anchor = { beforePullId: targetEntries[0].pull.id }
    }
    setDropPosition(null)
    void runMutation(
      source.pull,
      targetSection === "settled"
        ? "Settled locally · GitHub PR unchanged"
        : targetSection === "pinned"
          ? "Pinned"
          : "Returned to Active",
      () => client.moveInboxPull(viewer.login, source.pull, { section: targetSection, ...anchor }),
    )
  }
  const onDragCancel = () => {
    setDraggingId(null)
    setDragOverId(null)
    setDropPosition(null)
  }
  const onDragOver = (event: import("@dnd-kit/core").DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null
    setDragOverId(overId)
    if (!overId) {
      setDropPosition(null)
      return
    }
    const target = entries.find((entry) => entry.pull.id === overId)
    const targetSection = overId.startsWith("inbox-drop:")
      ? (overId.split(":")[1] as "pinned" | "active" | "snoozed" | "settled")
      : target?.state === "settled"
        ? "settled"
        : target?.state === "snoozed"
          ? null
          : target?.preference?.pinOrder !== undefined
            ? "pinned"
            : "active"
    if (!targetSection) {
      setDropPosition(null)
      return
    }
    if (!target) {
      const targetEntries =
        targetSection === "pinned"
          ? pinnedEntries
          : targetSection === "active"
            ? activeEntries
            : targetSection === "snoozed"
              ? []
              : settledEntries
      setDropPosition({
        section: targetSection,
        ...(targetEntries[0] ? { beforePullId: targetEntries[0].pull.id } : {}),
      })
      return
    }
    const sourceId = String(event.active.id)
    if (target.pull.id === sourceId) return
    const translated = event.active.rect.current.translated
    const after = Boolean(
      translated &&
        translated.top + translated.height / 2 > event.over!.rect.top + event.over!.rect.height / 2,
    )
    setDropPosition({
      section: targetSection,
      ...(after ? { afterPullId: target.pull.id } : { beforePullId: target.pull.id }),
    })
  }
  return { sensors, onDragStart, onDragOver, onDragCancel, onDragEnd, moveBy, dragLabel }
}

function getInboxDragLabel(
  entries: InboxPull[],
  draggingId: string | null,
  dragOverId: string | null,
) {
  if (!draggingId) return null
  const entry = entries.find((item) => item.pull.id === draggingId)
  if (!entry) return null
  const over = dragOverId?.startsWith("inbox-drop:")
    ? dragOverId.split(":")[1]
    : (() => {
        const target = entries.find((item) => item.pull.id === dragOverId)
        return target?.state === "active" && target.preference?.pinOrder !== undefined
          ? "pinned"
          : target?.state
      })()
  const verb =
    over === "snoozed"
      ? "Snooze"
      : over === "settled"
        ? "Settle locally"
        : over === "pinned"
          ? entry.preference?.pinOrder !== undefined
            ? "Reorder pinned"
            : "Pin"
          : over === "active"
            ? entry.state === "snoozed"
              ? "Wake"
              : entry.state === "settled"
                ? "Restore"
                : entry.preference?.pinOrder !== undefined
                  ? "Unpin"
                  : "Move to Active"
            : "Move"
  return `${verb} · ${entry.pull.repo} #${entry.pull.number}`
}
