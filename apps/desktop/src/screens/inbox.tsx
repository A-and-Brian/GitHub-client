import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core"
import {
  type GitHubClient,
  type InboxMutationResult,
  type InboxPull,
  jobKeys,
  type PullRequest,
} from "@github-client/core"
import { cn } from "@github-client/ui/lib/utils"
import { useLiveQuery } from "@tanstack/react-db"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { useJobStatus, useSession, useWatch } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { useShortcuts } from "@/app/shortcuts"
import { ContributionCalendar } from "@/components/contribution-calendar"
import { RepositoryCacheStatus } from "@/components/repository-cache-status"
import { useInboxDrag } from "./inbox-drag"
import { useInboxGeometry } from "./inbox-geometry"
import { InboxHeader } from "./inbox-header"
import { useInboxLocation } from "./inbox-location"
import { useInboxModel } from "./inbox-model"
import { useInboxMutations } from "./inbox-mutations"
import { cancelInboxDragOnUnmount, InboxActions } from "./inbox-parts"
import { InboxRow } from "./inbox-row"
import { type DropPosition, InboxSections } from "./inbox-sidebar"
import { PullContent, type PullTab } from "./pull/pull-page"
import { useRepositoryInboxData } from "./repository-inbox-data"

type InboxViewState = {
  text: string
  scope: "involving" | "all"
  failures: boolean
  settledLimit: number
  scroll: number
}
// Client lifetime bounds this cache to one signed-in session, including browser Back navigation.
const savedViews = new WeakMap<GitHubClient, Map<string, InboxViewState>>()

export function Inbox({
  entityScope,
  active = true,
}: {
  entityScope?: { groupId?: string; repo?: string }
  active?: boolean
}) {
  const { client, viewer } = useSession()
  const lifecycleRevision = useSyncExternalStore(
    client.subscribeInboxLifecycle,
    client.getInboxLifecycleRevision,
  )
  const syncedPulls = useLiveQuery((q) => q.from({ p: client.collections.pulls.collection })).data
  const groups = useLiveQuery((q) => q.from({ g: client.collections.groups.collection })).data
  const preferences = useLiveQuery((q) =>
    q.from({ p: client.collections.inboxPreferences.collection }),
  ).data
  const viewKey = `${viewer.login.toLowerCase()}:${entityScope?.groupId ?? entityScope?.repo ?? "global"}`
  const [initialView] = useState(() => savedViews.get(client)?.get(viewKey))
  const savedView = useRef(initialView)
  const location = useInboxLocation()
  const repositoryData = useRepositoryInboxData(entityScope?.repo, active)
  // biome-ignore lint/correctness/useExhaustiveDependencies: remote confirmation can change without a successful collection write.
  const pulls = useMemo(() => {
    const syncedIds = new Set(syncedPulls.map((pull) => pull.id))
    return client.applyConfirmedInboxLifecycles([
      ...syncedPulls,
      ...repositoryData.items.filter((pull) => !syncedIds.has(pull.id)),
    ])
  }, [client, lifecycleRevision, syncedPulls, repositoryData.items])
  const [selectedRepo, selectedNumber] = location.pull?.split("#") ?? []
  const [selectedOwner, selectedName] = selectedRepo?.split("/") ?? []
  const selectedPull = pulls.find((pull) => `${pull.repo}#${pull.number}` === location.pull)
  const selectedId = selectedPull?.id ?? null
  const tab = location.pullTab ?? "conversation"
  const setTab = (pullTab: PullTab) => location.update({ pullTab }, true)
  const [failures, setFailures] = useState(initialView?.failures ?? false)
  const [settledLimit, setSettledLimit] = useState(initialView?.settledLimit ?? 10)
  const [snoozePickerId, setSnoozePickerId] = useState<string | null>(null)
  const [scope, setScope] = useState<"involving" | "all">(
    initialView?.scope ?? (entityScope ? "all" : "involving"),
  )
  const [text, setText] = useState(initialView?.text ?? "")
  const [now, setNow] = useState(Date.now)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [orderReady, setOrderReady] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const inboxPane = useRef<HTMLDivElement>(null)
  const currentView = useRef<InboxViewState>({ text, scope, failures, settledLimit, scroll: 0 })
  useLayoutEffect(() => {
    currentView.current = { ...currentView.current, text, scope, failures, settledLimit }
  }, [text, scope, failures, settledLimit])
  useEffect(() => {
    const pane = inboxPane.current
    return () => {
      const views = savedViews.get(client) ?? new Map<string, InboxViewState>()
      views.set(viewKey, {
        ...currentView.current,
        scroll: pane?.querySelector(".inbox-primary-list")?.scrollTop ?? 0,
      })
      savedViews.set(client, views)
    }
  }, [client, viewKey])
  const orderAccount = useRef(viewer.login)
  const geometry = useInboxGeometry(inboxPane)
  const { busyIds, latestUndo, runMutation, runRowMutation } = useInboxMutations()
  const watchedGroup = entityScope?.groupId ?? "me"
  useWatch((c) => (active ? c.watchGroup(watchedGroup) : () => {}), [watchedGroup, active])
  const status = useJobStatus(jobKeys.groupPulls(watchedGroup))
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
    settledLimit,
    entityScope,
  })
  useEffect(() => {
    if (!active) return
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
  }, [client, viewer.login, fullEntries, active])
  useEffect(() => {
    if (orderAccount.current !== viewer.login) {
      orderAccount.current = viewer.login
      setSettledLimit(10)
      setSnoozePickerId(null)
      location.update({ pull: undefined, pullTab: undefined, run: undefined, job: undefined }, true)
      latestUndo.current = null
    }
  }, [latestUndo, viewer.login, location.update])
  useEffect(() => {
    if (!active) return
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
  }, [active])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcile when preferences hydrate or change
  useEffect(() => {
    if (!active) return
    let cancelled = false
    void client
      .reconcileInboxState(viewer.login, syncedPulls, now, groups)
      .then(() => {
        if (!cancelled) setReconcileError(null)
      })
      .catch((error: unknown) => {
        if (!cancelled) setReconcileError(error)
      })
    return () => {
      cancelled = true
    }
  }, [client, viewer.login, syncedPulls, groups, preferences, now, active])
  useEffect(() => {
    if (!savedView.current || fullEntries.length === 0 || !active) return
    const list = inboxPane.current?.querySelector(".inbox-primary-list")
    if (list) list.scrollTop = savedView.current.scroll
    savedView.current = undefined
  }, [fullEntries.length, active])
  const dragDisabled = Boolean(entityScope) || failures || !orderReady

  const select = (pull: PullRequest) => {
    const entry = fullEntries.find((item) => item.pull.id === pull.id)
    if (entry?.state === "settled") {
      const index = settledEntries.findIndex((item) => item.pull.id === pull.id)
      if (index >= settledLimit) setSettledLimit(index + 1)
    }
    location.update({
      pull: `${pull.repo}#${pull.number}`,
      pullTab: undefined,
      run: undefined,
      job: undefined,
    })
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
    if (next.state === "settled") {
      const settledIndex = settledEntries.findIndex((entry) => entry.pull.id === next.pull.id)
      if (settledIndex >= settledLimit) setSettledLimit(settledIndex + 1)
    }
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-pull-id="${CSS.escape(next.pull.id)}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    )
  }
  useShortcuts(
    { j: () => step(1), k: () => step(-1), "/": () => search.current?.focus() },
    active && !location.run,
  )

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
    orderReady: orderReady && !entityScope,
    draggingId,
    dragOverId,
    setDraggingId,
    setDragOverId,
    setDropPosition,
    onSnoozeDrop: (pull) => setSnoozePickerId(pull.id),
    runMutation,
  })
  const renderRow = (entry: InboxPull) => (
    <InboxRow
      key={entry.pull.id}
      entry={entry}
      selected={selectedId === entry.pull.id}
      now={now}
      online={online}
      dragDisabled={dragDisabled}
      busy={busyIds.has(entry.pull.id)}
      snoozePickerOpen={snoozePickerId === entry.pull.id}
      onSnoozePickerOpenChange={(open) => setSnoozePickerId(open ? entry.pull.id : null)}
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
  const selectedTerminalState = selected
    ? selected.pull.state === "MERGED" || selected.preference?.terminalState === "MERGED"
      ? "MERGED"
      : selected.pull.state === "CLOSED" ||
          (selected.preference?.terminalState === "CLOSED" &&
            !(
              selected.pull.state === "OPEN" &&
              selected.pull.stateObservedAt &&
              Date.parse(selected.pull.stateObservedAt) >
                Date.parse(selected.preference.terminalObservedAt ?? selected.preference.changedAt)
            ))
        ? "CLOSED"
        : undefined
    : undefined

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
          data-inbox-ready={orderReady && !repositoryData.refreshing}
          style={{ width: geometry.mobile ? "100%" : geometry.width }}
          className={cn(
            "relative flex min-h-0 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground",
            geometry.mobile && location.pull ? "hidden" : "flex",
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
              if (entityScope?.repo) repositoryData.refresh()
              else if (entityScope?.groupId)
                void client.refresh(jobKeys.groupPulls(entityScope.groupId))
              else
                void Promise.all(
                  groups.map((group) => client.refresh(jobKeys.groupPulls(group.id))),
                )
            }}
            refreshing={entityScope?.repo ? repositoryData.refreshing : Boolean(status?.running)}
            online={online}
          />
          {entityScope && (
            <div className="px-4 py-2">
              <p className="text-xs text-muted-foreground">
                Filtered to {entityScope.repo ?? entityScope.groupId?.replace(/^(org|team):/, "")}.
                Reordering is available in the global Inbox.
              </p>
              {entityScope.repo && (
                <div className="mt-1 flex items-center gap-2">
                  <RepositoryCacheStatus states={[repositoryData.state]} />
                  {repositoryData.state.loaded && repositoryData.error && (
                    <button
                      type="button"
                      onClick={repositoryData.retry}
                      className="shrink-0 text-xs underline"
                    >
                      Retry
                    </button>
                  )}
                  {repositoryData.pages > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {repositoryData.pages} page{repositoryData.pages === 1 ? "" : "s"} cached
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {Boolean(repositoryData.error) && !repositoryData.state.loaded && (
            <div role="alert" className="p-3 text-sm">
              Could not load repository pull requests.{" "}
              <button type="button" onClick={repositoryData.retry} className="underline">
                Retry
              </button>
            </div>
          )}
          <InboxSections
            failures={failures}
            failuresList={failuresList}
            loading={Boolean(status?.running && !status.lastSuccess)}
            pinnedEntries={pinnedEntries}
            activeEntries={activeEntries}
            snoozedEntries={snoozedEntries}
            settledEntries={settledEntries}
            visibleSettledRows={visibleSettledRows}
            visibleSettledCount={visibleSettled.length}
            dragDisabled={dragDisabled}
            dragging={Boolean(draggingId)}
            dropPosition={dropPosition}
            renderRow={renderRow}
            onShowMoreSettled={() => setSettledLimit((limit) => limit + 25)}
          />
          {repositoryData.loading && (
            <p role="status" className="p-3 text-sm">
              Loading repository pull requests…
            </p>
          )}
          {repositoryData.more && !repositoryData.loading && !repositoryData.error && (
            <button
              type="button"
              className="p-3 text-sm underline"
              onClick={repositoryData.loadMore}
            >
              Load more pull requests
            </button>
          )}
          {!entityScope && <ContributionCalendar />}
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
            geometry.mobile && !location.pull && "hidden",
          )}
        >
          {selected ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {!selectedEntry && (
                <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
                  This PR is outside the current filters. Your selection is retained.
                </p>
              )}
              <PullContent
                key={selected.pull.id}
                active={active}
                hideRepositoryContext={Boolean(entityScope)}
                owner={selected.pull.repo.split("/")[0]!}
                name={selected.pull.repo.split("/")[1]!}
                number={selected.pull.number}
                tab={tab}
                onTabChange={setTab}
                onBack={() => {
                  location.update({
                    pull: undefined,
                    pullTab: undefined,
                    run: undefined,
                    job: undefined,
                  })
                  requestAnimationFrame(() => {
                    const row = inboxPane.current?.querySelector<HTMLElement>(
                      `[data-pull-id="${CSS.escape(selected.pull.id)}"] button`,
                    )
                    ;(row ?? search.current)?.focus()
                  })
                }}
                backLabel="Back to inbox"
                actions={
                  <InboxActions
                    key={selected.pull.id}
                    state={selected.state}
                    terminalState={selectedTerminalState}
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
          ) : selectedOwner && selectedName && selectedNumber ? (
            <PullContent
              key={location.pull}
              owner={selectedOwner}
              name={selectedName}
              number={Number(selectedNumber)}
              tab={tab}
              onTabChange={setTab}
              active={active}
              hideRepositoryContext={Boolean(entityScope)}
              onBack={() =>
                location.update({
                  pull: undefined,
                  pullTab: undefined,
                  run: undefined,
                  job: undefined,
                })
              }
              backLabel="Back to inbox"
            />
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
