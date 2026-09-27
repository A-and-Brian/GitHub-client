import type { Group, InboxPreference, InboxPull, PullRequest } from "@github-client/core"
import { deriveInboxPulls } from "@github-client/core/inbox"
import { useMemo } from "react"

export function useInboxModel({
  pulls,
  groups,
  accountLogin,
  preferences,
  now,
  scope,
  text,
  selectedId,
  expanded,
  settledLimit,
}: {
  pulls: PullRequest[]
  groups: Group[]
  accountLogin: string
  preferences: InboxPreference[]
  now: number
  scope: "involving" | "all"
  text: string
  selectedId: string | null
  expanded: { snoozed: boolean; settled: boolean }
  settledLimit: number
}) {
  const fullEntries = useMemo(
    () =>
      deriveInboxPulls(pulls, groups, accountLogin, preferences, Date.now(), "all").sort(
        (a, b) =>
          b.pull.updatedAt.localeCompare(a.pull.updatedAt) ||
          a.pull.repo.localeCompare(b.pull.repo) ||
          a.pull.number - b.pull.number,
      ),
    [pulls, groups, accountLogin, preferences],
  )
  const entries = useMemo(
    () => deriveInboxPulls(pulls, groups, accountLogin, preferences, now, scope),
    [pulls, groups, accountLogin, preferences, now, scope],
  )
  const matching = entries.filter(({ pull }) =>
    `${pull.repo} #${pull.number} ${pull.title} ${pull.author ?? ""}`
      .toLowerCase()
      .includes(text.trim().toLowerCase()),
  )
  const failuresList = matching.filter(({ pull }) =>
    ["FAILURE", "ERROR"].includes(pull.checkState ?? ""),
  )
  const sortRank = (list: InboxPull[], key: "activeOrder" | "pinOrder") =>
    [...list].sort((a, b) => {
      const aRank = a.preference?.[key] ?? Number.MAX_SAFE_INTEGER
      const bRank = b.preference?.[key] ?? Number.MAX_SAFE_INTEGER
      return (
        aRank - bRank ||
        b.pull.updatedAt.localeCompare(a.pull.updatedAt) ||
        a.pull.id.localeCompare(b.pull.id)
      )
    })
  const pinnedEntries = sortRank(
    matching.filter(
      ({ state, preference }) => state === "active" && preference?.pinOrder !== undefined,
    ),
    "pinOrder",
  )
  const activeEntries = sortRank(
    matching.filter(
      ({ state, preference }) => state === "active" && preference?.pinOrder === undefined,
    ),
    "activeOrder",
  )
  const snoozedEntries = matching
    .filter(({ state }) => state === "snoozed")
    .sort(
      (a, b) =>
        (a.preference?.snoozedUntil ?? "").localeCompare(b.preference?.snoozedUntil ?? "") ||
        a.pull.id.localeCompare(b.pull.id),
    )
  const settledEntries = matching
    .filter(({ state }) => state === "settled")
    .sort(
      (a, b) =>
        (b.preference?.changedAt ?? "").localeCompare(a.preference?.changedAt ?? "") ||
        a.pull.id.localeCompare(b.pull.id),
    )
  const selected = fullEntries.find((entry) => entry.pull.id === selectedId)
  const selectedEntry = selected && matching.find((entry) => entry.pull.id === selected.pull.id)
  const visibleSettled = settledEntries.slice(0, settledLimit)
  if (
    selectedEntry?.state === "settled" &&
    !visibleSettled.some((entry) => entry.pull.id === selectedEntry.pull.id)
  ) {
    visibleSettled.push(selectedEntry)
  }
  const visibleSnoozed = expanded.snoozed
    ? snoozedEntries
    : selectedEntry?.state === "snoozed"
      ? [selectedEntry]
      : []
  const visibleSettledRows = expanded.settled
    ? visibleSettled
    : selectedEntry?.state === "settled"
      ? [selectedEntry]
      : []

  return {
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
  }
}
