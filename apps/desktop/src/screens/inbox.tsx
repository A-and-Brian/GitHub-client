import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core"
import {
  type InboxMutationResult,
  type InboxPull,
  jobKeys,
  type PullRequest,
} from "@github-client/core"
import { cn } from "@github-client/ui/lib/utils"
import { useLiveQuery } from "@tanstack/react-db"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useJobStatus, useSession, useWatch } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { useShortcuts } from "@/app/shortcuts"
import { ContributionCalendar } from "@/components/contribution-calendar"
import { useInboxDrag } from "./inbox-drag"
import { useInboxGeometry } from "./inbox-geometry"
import { InboxHeader } from "./inbox-header"
import { useInboxModel } from "./inbox-model"
import { useInboxMutations } from "./inbox-mutations"
import {
  cancelInboxDragOnUnmount,
  InboxActions,
  readShelfState,
  shelfStorageKey,
} from "./inbox-parts"
import { InboxRow } from "./inbox-row"
import { type DropPosition, InboxSections } from "./inbox-sidebar"
import { PullContent, type PullTab } from "./pull/pull-page"

export function Inbox() {
  const { client, viewer } = useSession()
  const pulls = useLiveQuery((q) => q.from({ p: client.collections.pulls.collection })).data
  const groups = useLiveQuery((q) => q.from({ g: client.collections.groups.collection })).data
  const preferences = useLiveQuery((q) =>
    q.from({ p: client.collections.inboxPreferences.collection }),
  ).data
  const [failures, setFailures] = useState(false)
  const [expanded, setExpanded] = useState(() => readShelfState(viewer.login))
  const [settledLimit, setSettledLimit] = useState(10)
  const [scope, setScope] = useState<"involving" | "all">("involving")
  const [text, setText] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PullTab>("conversation")
  const [now, setNow] = useState(Date.now)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [orderReady, setOrderReady] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const inboxPane = useRef<HTMLDivElement>(null)
  const orderAccount = useRef(viewer.login)
  const geometry = useInboxGeometry(inboxPane)
  const { busyIds, latestUndo, runMutation, runRowMutation } = useInboxMutations()
  useWatch((c) => c.watchGroup("me"), [])
  const status = useJobStatus(jobKeys.groupPulls("me"))
  useEffect(() => () => cancelInboxDragOnUnmount(), [])
  useErrorToast(status?.error, { id: "inbox-sync-error", title: "Could not refresh inbox" })
  const [reconcileError, setReconcileError] = useState<unknown>(null)
  useErrorToast(reconcileError, {
    id: "inbox-reconcile-error",
    title: "Could not update inbox state",
  })

  const {
    fullEntries,
    entries,
    failuresList,
    pinnedEntries,
    activeEntries,
    snoozedEntries,
    settledEntries,
    selected,
    selectedEntry,
    visibleSettled,
    visibleSnoozed,
    visibleSettledRows,
  } = useInboxModel({
    pulls,
    groups,
    accountLogin: viewer.login,
    preferences,
    now,
    scope,
    text,
    selectedId,
    expanded,
    settledLimit,
  })
  useEffect(() => {
    let current = true
    setOrderReady(false)
    void client
      .ensureInboxOrder(viewer.login, fullEntries)
      .then(() => {
        if (current) setOrderReady(true)
      })
      .catch((error: unknown) => {
        if (current) toast.error(`Couldn't prepare inbox order: ${String(error)}`)
      })
    return () => {
      current = false
    }
  }, [client, viewer.login, fullEntries])
  useEffect(() => {
    if (orderAccount.current !== viewer.login) {
      orderAccount.current = viewer.login
      setExpanded(readShelfState(viewer.login))
      setSettledLimit(10)
      setSelectedId(null)
      latestUndo.current = null
    }
  }, [latestUndo, viewer.login])
  useEffect(() => {
    try {
      localStorage.setItem(shelfStorageKey(viewer.login), JSON.stringify(expanded))
    } catch {
      // Shelf state remains usable when storage is disabled.
    }
  }, [expanded, viewer.login])
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcile when preferences hydrate or change
  useEffect(() => {
    let cancelled = false
    void client
      .reconcileInboxState(viewer.login, pulls, now, groups)
      .then(() => {
        if (!cancelled) setReconcileError(null)
      })
      .catch((error: unknown) => {
        if (!cancelled) setReconcileError(error)
      })
    return () => {
      cancelled = true
    }
  }, [client, viewer.login, pulls, groups, preferences, now])
  const dragDisabled = failures || !orderReady

  const select = (pull: PullRequest) => {
    const entry = fullEntries.find((item) => item.pull.id === pull.id)
    if (entry?.state === "snoozed") setExpanded((value) => ({ ...value, snoozed: true }))
    if (entry?.state === "settled") {
      setExpanded((value) => ({ ...value, settled: true }))
      const index = settledEntries.findIndex((item) => item.pull.id === pull.id)
      if (index >= settledLimit) setSettledLimit(index + 1)
    }
    setSelectedId(pull.id)
    setTab("conversation")
  }
  const navigable = failures
    ? failuresList
    : [...pinnedEntries, ...activeEntries, ...snoozedEntries, ...settledEntries]
  const step = (direction: -1 | 1) => {
    if (navigable.length === 0) return
    const currentIndex = navigable.findIndex((entry) => entry.pull.id === selectedId)
    const nextIndex =
      currentIndex < 0 ? 0 : Math.max(0, Math.min(navigable.length - 1, currentIndex + direction))
    const next = navigable[nextIndex]
    if (!next) return
    select(next.pull)
    if (next.state === "snoozed") setExpanded((value) => ({ ...value, snoozed: true }))
    if (next.state === "settled") {
      setExpanded((value) => ({ ...value, settled: true }))
      const settledIndex = settledEntries.findIndex((entry) => entry.pull.id === next.pull.id)
      if (settledIndex >= settledLimit) setSettledLimit(settledIndex + 1)
    }
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-pull-id="${CSS.escape(next.pull.id)}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    )
  }
  useShortcuts({ j: () => step(1), k: () => step(-1), "/": () => search.current?.focus() })

  const applyDetailMutation = (
    label: string,
    mutation: () => Promise<InboxMutationResult>,
    closePopover?: () => void,
  ) => {
    if (selected) void runMutation(selected.pull, label, mutation).then(closePopover)
  }
  const drag = useInboxDrag({
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
    runMutation,
  })
  const toggleExpanded = (section: "snoozed" | "settled") =>
    setExpanded((current) => ({ ...current, [section]: !current[section] }))
  const renderRow = (entry: InboxPull) => (
    <InboxRow
      key={entry.pull.id}
      entry={entry}
      selected={selectedId === entry.pull.id}
      now={now}
      online={online}
      dragDisabled={dragDisabled}
      busy={busyIds.has(entry.pull.id)}
      onSelect={select}
      onPrefetch={(pull) => void client.prefetchPull(pull.repo, pull.number)}
      onPin={(pull) =>
        runRowMutation(pull, "Pinned", () => client.pinInboxPull(viewer.login, pull))
      }
      onUnpin={(pull) =>
        runRowMutation(pull, "Unpinned", () => client.unpinInboxPull(viewer.login, pull))
      }
      onSnooze={(pull, until) =>
        runRowMutation(
          pull,
          "Snoozed",
          () => client.setInboxSnoozed(viewer.login, pull, until),
          "snoozed",
        )
      }
      onSettle={(pull) =>
        runRowMutation(
          pull,
          "Settled locally · GitHub PR unchanged",
          () => client.settleInboxPull(viewer.login, pull),
          "settled",
        )
      }
      onRestore={(pull) => {
        const current = fullEntries.find((item) => item.pull.id === pull.id)
        if (current?.state === "snoozed")
          runRowMutation(
            pull,
            "Woke to previous position",
            () => client.wakeInboxPull(viewer.login, pull),
            "row",
          )
        else
          runRowMutation(
            pull,
            "Returned to Active",
            () => client.restoreInboxPull(viewer.login, pull),
            "row",
          )
      }}
      onMove={drag.moveBy}
    />
  )

  return (
    <div ref={inboxPane} className="relative flex h-full min-w-0">
      <DndContext
        sensors={drag.sensors}
        collisionDetection={(args) => {
          const collisions = pointerWithin(args)
          const row = collisions.find(
            (collision) => !String(collision.id).startsWith("inbox-drop:"),
          )
          return row ? [row] : collisions.slice(0, 1)
        }}
        onDragStart={drag.onDragStart}
        onDragOver={drag.onDragOver}
        onDragMove={drag.onDragOver}
        onDragCancel={drag.onDragCancel}
        onDragEnd={drag.onDragEnd}
      >
        <aside
          aria-label="Pull request inbox"
          style={{ width: geometry.mobile ? "100%" : geometry.width }}
          className={cn(
            "relative flex min-h-0 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground",
            geometry.mobile && selected ? "hidden" : "flex",
          )}
        >
          <InboxHeader
            search={search}
            text={text}
            onTextChange={setText}
            scope={scope}
            onScopeChange={setScope}
            failures={failures}
            onToggleFailures={() => setFailures((value) => !value)}
            onRefresh={() => {
              void Promise.all(groups.map((group) => client.refresh(jobKeys.groupPulls(group.id))))
            }}
            refreshing={Boolean(status?.running)}
            online={online}
          />
          <InboxSections
            failures={failures}
            failuresList={failuresList}
            loading={Boolean(status?.running && !status.lastSuccess)}
            pinnedEntries={pinnedEntries}
            activeEntries={activeEntries}
            snoozedEntries={snoozedEntries}
            settledEntries={settledEntries}
            visibleSnoozed={visibleSnoozed}
            visibleSettledRows={visibleSettledRows}
            visibleSettledCount={visibleSettled.length}
            selectedSnoozed={selectedEntry?.state === "snoozed"}
            selectedSettled={selectedEntry?.state === "settled"}
            expanded={expanded}
            dragDisabled={dragDisabled}
            dropPosition={dropPosition}
            renderRow={renderRow}
            onToggleShelf={toggleExpanded}
            onShowMoreSettled={() => setSettledLimit((limit) => limit + 25)}
          />
          <ContributionCalendar />
          {!geometry.mobile && (
            <div
              {...geometry.separatorProps}
              className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none bg-transparent hover:bg-ring/40 focus-visible:bg-ring/40"
            />
          )}
        </aside>
        <section
          aria-label="Selected pull request"
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden",
            geometry.mobile && !selected && "hidden",
          )}
        >
          {selected ? (
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
                  requestAnimationFrame(() => search.current?.focus())
                }}
                backLabel="Back to inbox"
                actions={
                  <InboxActions
                    key={selected.pull.id}
                    state={selected.state}
                    snoozedUntil={selected.preference?.snoozedUntil}
                    busy={busyIds.has(selected.pull.id)}
                    onSnooze={(until, close) =>
                      applyDetailMutation(
                        `Snoozed until ${new Date(until).toLocaleString()}`,
                        () =>
                          client.setInboxSnoozed(
                            viewer.login,
                            selected.pull,
                            new Date(until).toISOString(),
                          ),
                        close,
                      )
                    }
                    onSettle={(close) =>
                      applyDetailMutation(
                        "Settled locally · GitHub PR unchanged",
                        () => client.settleInboxPull(viewer.login, selected.pull),
                        close,
                      )
                    }
                    onRestore={() =>
                      applyDetailMutation("Returned to Active", () =>
                        selected.state === "snoozed"
                          ? client.wakeInboxPull(viewer.login, selected.pull)
                          : client.restoreInboxPull(viewer.login, selected.pull),
                      )
                    }
                  />
                }
              />
            </div>
          ) : (
            <p className="m-auto max-w-sm p-6 text-center text-sm text-muted-foreground">
              Select a PR to review its conversation, files and checks.
            </p>
          )}
        </section>
        <DragOverlay dropAnimation={null}>
          {drag.dragLabel && (
            <div
              role="status"
              aria-label="Dragging pull request"
              className="rounded-md border bg-popover px-3 py-2 text-sm shadow-lg"
            >
              {drag.dragLabel}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
