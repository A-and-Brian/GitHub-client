import { useDndContext } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import type { InboxPull } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Fragment, type ReactNode, useLayoutEffect, useRef } from "react"
import { InboxDropHeader } from "./inbox-parts"

export type DropPosition = {
  section: "pinned" | "active" | "snoozed" | "settled"
  beforePullId?: string
  afterPullId?: string
}

export function InboxSections({
  failures,
  failuresList,
  loading,
  pinnedEntries,
  activeEntries,
  snoozedEntries,
  settledEntries,
  visibleSettledRows,
  visibleSettledCount,
  dragDisabled,
  dragging,
  dropPosition,
  renderRow,
  onShowMoreSettled,
}: {
  failures: boolean
  failuresList: InboxPull[]
  loading: boolean
  pinnedEntries: InboxPull[]
  activeEntries: InboxPull[]
  snoozedEntries: InboxPull[]
  settledEntries: InboxPull[]
  visibleSettledRows: InboxPull[]
  visibleSettledCount: number
  dragDisabled: boolean
  dragging: boolean
  dropPosition: DropPosition | null
  renderRow: (entry: InboxPull) => ReactNode
  onShowMoreSettled: () => void
}) {
  const visibleArchive = snoozedEntries.length > 0 || visibleSettledRows.length > 0
  const primaryList = useRef<HTMLDivElement>(null)
  const { droppableContainers, measureDroppableContainers } = useDndContext()

  // Footer content can move drop targets without resizing the targets themselves.
  useLayoutEffect(() => {
    if (!dragging || !primaryList.current) return
    const observer = new ResizeObserver(() => {
      measureDroppableContainers(Array.from(droppableContainers.keys()))
    })
    observer.observe(primaryList.current)
    return () => observer.disconnect()
  }, [dragging, droppableContainers, measureDroppableContainers])

  return (
    <>
      <div
        ref={primaryList}
        className="inbox-primary-list min-h-[80px] min-w-0 flex-1 overflow-y-auto"
      >
        {failures ? (
          <section aria-label="Failures across all states">
            <h2 className="border-b px-3 py-2 text-xs font-semibold text-muted-foreground">
              Failures across all states{" "}
              <span className="ml-1 font-normal">{failuresList.length}</span>
            </h2>
            <ul aria-label="Failures across all states">
              {failuresList.map(renderRow)}
              {failuresList.length === 0 && (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  {loading ? "Loading pull requests…" : "No failed checks in this view."}
                </li>
              )}
            </ul>
          </section>
        ) : (
          <>
            <InboxSection
              section="pinned"
              title="Pinned"
              entries={pinnedEntries}
              dragging={dragging}
              dragDisabled={dragDisabled}
              dropPosition={dropPosition}
              renderRow={renderRow}
            />
            <InboxSection
              section="active"
              title="Active"
              entries={activeEntries}
              dragging={dragging}
              dragDisabled={dragDisabled}
              dropPosition={dropPosition}
              renderRow={renderRow}
            />
          </>
        )}
      </div>
      {!failures && (visibleArchive || dragging) && (
        <div
          className={`inbox-archive min-h-0 max-h-[40%] shrink-0 overflow-y-auto ${visibleArchive ? "border-t" : ""}`}
        >
          <InboxSection
            section="snoozed"
            title="Snoozed"
            entries={snoozedEntries}
            dragging={dragging}
            dragDisabled={dragDisabled}
            dropPosition={dropPosition}
            renderRow={renderRow}
          />
          <InboxSection
            section="settled"
            title="Settled"
            entries={visibleSettledRows}
            count={settledEntries.length}
            dragging={dragging}
            dragDisabled={dragDisabled}
            dropPosition={dropPosition}
            renderRow={renderRow}
          >
            {settledEntries.length > visibleSettledCount && (
              <Button variant="ghost" size="sm" className="w-full" onClick={onShowMoreSettled}>
                Show 25 more
              </Button>
            )}
          </InboxSection>
        </div>
      )}
    </>
  )
}

function InboxSection({
  section,
  title,
  entries,
  count = entries.length,
  dragging,
  dragDisabled,
  dropPosition,
  renderRow,
  children,
}: {
  section: DropPosition["section"]
  title: string
  entries: InboxPull[]
  count?: number
  dragging: boolean
  dragDisabled: boolean
  dropPosition: DropPosition | null
  renderRow: (entry: InboxPull) => ReactNode
  children?: ReactNode
}) {
  const gap = (section: DropPosition["section"], edge?: "before" | "after", id?: string) => {
    const position = dropPosition
    if (!position || position.section !== section) return null
    const matches = !id
      ? !position.beforePullId && !position.afterPullId
      : edge === "before"
        ? position.beforePullId === id
        : position.afterPullId === id
    return matches ? (
      <li aria-hidden="true" className="mx-2 my-1 h-2 rounded bg-primary/30" />
    ) : null
  }

  if (section !== "active" && entries.length === 0 && !dragging) return null
  return (
    <section aria-label={`${title} pull requests`}>
      {(section === "active" || dragging) && (
        <InboxDropHeader section={section} title={title} count={count} disabled={dragDisabled} />
      )}
      <SortableContext
        items={entries.map((entry) => entry.pull.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul aria-label={`${title} pull requests`}>
          {entries.map((entry) => (
            <Fragment key={entry.pull.id}>
              {gap(section, "before", entry.pull.id)}
              {renderRow(entry)}
              {gap(section, "after", entry.pull.id)}
            </Fragment>
          ))}
          {gap(section)}
          {section === "active" && entries.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">No active pull requests.</li>
          )}
        </ul>
      </SortableContext>
      {children}
    </section>
  )
}
