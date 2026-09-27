import { useNavigate, useSearch } from "@tanstack/react-router"
import type { PullTab } from "./pull/pull-page"

export interface InboxLocation {
  pull?: string
  pullTab?: PullTab
  run?: number
  job?: number
}

const positiveId = (value: unknown) => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

export function inboxSearch(search: Record<string, unknown>): InboxLocation {
  return {
    pull:
      typeof search.pull === "string" && /^[^/]+\/[^/]+#[1-9]\d*$/.test(search.pull)
        ? search.pull
        : undefined,
    pullTab: search.pullTab === "files" || search.pullTab === "checks" ? search.pullTab : undefined,
    run: positiveId(search.run),
    job: positiveId(search.job),
  }
}

export function useInboxLocation() {
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  return {
    ...inboxSearch(search),
    update: (next: InboxLocation, replace = false) =>
      void navigate({
        to: ".",
        search: (previous) => ({ ...previous, ...next }),
        replace,
      }),
  }
}
