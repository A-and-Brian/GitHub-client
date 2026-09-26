import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import type { InboxPull } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Fragment, type ReactNode } from "react"
import { InboxDropHeader, InboxShelf } from "./inbox-parts"

export type DropPosition = {
  section: "pinned" | "active" | "settled"
  beforePullId?: string
  afterPullId?: string
}

type ShelfState = { snoozed: boolean; settled: boolean }

export function InboxSections({
  failures,
  failuresList,
  loading,
  pinnedEntries,
  activeEntries,
  snoozedEntries,
  settledEntries,
  visibleSnoozed,
  visibleSettledRows,
  visibleSettledCount,
  selectedSnoozed,
  selectedSettled,
  expanded,
  dragDisabled,
  dropPosition,
  renderRow,
  onToggleShelf,
  onShowMoreSettled,
}: {
  failures: boolean
  failuresList: InboxPull[]
  loading: boolean
  pinnedEntries: InboxPull[]
  activeEntries: InboxPull[]
  snoozedEntries: InboxPull[]
  settledEntries: InboxPull[]
  visibleSnoozed: InboxPull[]
  visibleSettledRows: InboxPull[]
  visibleSettledCount: number
  selectedSnoozed: boolean
  selectedSettled: boolean
  expanded: ShelfState
  dragDisabled: boolean
  dropPosition: DropPosition | null
  renderRow: (entry: InboxPull) => ReactNode
  onToggleShelf: (shelf: "snoozed" | "settled") => void
  onShowMoreSettled: () => void
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

  return (
    <>
      <div className="inbox-primary-list min-h-[80px] min-w-0 flex-1 overflow-y-auto">
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
            <section aria-label="Pinned pull requests">
              <InboxDropHeader
                section="pinned"
                title="Pinned"
                count={pinnedEntries.length}
                disabled={dragDisabled}
              />
              <SortableContext
                items={pinnedEntries.map((entry) => entry.pull.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul aria-label="Pinned pull requests">
                  {pinnedEntries.map((entry) => (
                    <Fragment key={entry.pull.id}>
                      {gap("pinned", "before", entry.pull.id)}
                      {renderRow(entry)}
                      {gap("pinned", "after", entry.pull.id)}
                    </Fragment>
                  ))}
                  {gap("pinned")}
                  {pinnedEntries.length === 0 && (
                    <li className="px-3 py-2 text-xs text-muted-foreground">No pinned PRs</li>
                  )}
                </ul>
              </SortableContext>
            </section>
            <section aria-label="Active pull requests">
              <InboxDropHeader
                section="active"
                title="Active"
                count={activeEntries.length}
                disabled={dragDisabled}
              />
              <SortableContext
                items={activeEntries.map((entry) => entry.pull.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul aria-label="Active pull requests">
                  {activeEntries.map((entry) => (
                    <Fragment key={entry.pull.id}>
                      {gap("active", "before", entry.pull.id)}
                      {renderRow(entry)}
                      {gap("active", "after", entry.pull.id)}
                    </Fragment>
                  ))}
                  {gap("active")}
                  {activeEntries.length === 0 && (
                    <li className="px-3 py-2 text-xs text-muted-foreground">
                      No active pull requests.
                    </li>
                  )}
                </ul>
              </SortableContext>
            </section>
          </>
        )}
      </div>
      {!failures && (
        <div className="inbox-archive min-h-0 max-h-[40%] shrink-0 overflow-y-auto border-t">
          <InboxShelf
            title="Snoozed"
            count={snoozedEntries.length}
            expanded={expanded.snoozed}
            showSelectedCollapsed={selectedSnoozed}
            onToggle={() => onToggleShelf("snoozed")}
          >
            <SortableContext
              items={visibleSnoozed.map((entry) => entry.pull.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul aria-label="Snoozed pull requests">{visibleSnoozed.map(renderRow)}</ul>
            </SortableContext>
          </InboxShelf>
          <InboxShelf
            title="Settled"
            count={settledEntries.length}
            expanded={expanded.settled}
            showSelectedCollapsed={selectedSettled}
            onToggle={() => onToggleShelf("settled")}
            dropDisabled={dragDisabled}
          >
            <SortableContext
              items={visibleSettledRows.map((entry) => entry.pull.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul aria-label="Settled pull requests">
                {visibleSettledRows.map((entry) => (
                  <Fragment key={entry.pull.id}>
                    {gap("settled", "before", entry.pull.id)}
                    {renderRow(entry)}
                    {gap("settled", "after", entry.pull.id)}
                  </Fragment>
                ))}
                {gap("settled")}
              </ul>
            </SortableContext>
            {expanded.settled && settledEntries.length > visibleSettledCount && (
              <Button variant="ghost" size="sm" className="w-full" onClick={onShowMoreSettled}>
                Show 25 more
              </Button>
            )}
          </InboxShelf>
        </div>
      )}
    </>
  )
}
