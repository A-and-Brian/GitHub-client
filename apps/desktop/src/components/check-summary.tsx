import type { Check } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@github-client/ui/components/popover"
import { InfoIcon } from "lucide-react"
import { type RunState, runState, StateIcon } from "./status"

const LABELS: Record<RunState, string> = {
  success: "passed",
  failure: "failed",
  pending: "pending",
  running: "running",
  skipped: "skipped",
  cancelled: "cancelled",
  neutral: "neutral",
}

function checkSummary(checks: Check[]) {
  const counts: Record<RunState, number> = {
    success: 0,
    failure: 0,
    pending: 0,
    running: 0,
    skipped: 0,
    cancelled: 0,
    neutral: 0,
  }
  for (const check of checks) counts[runState(check.status, check.conclusion)]++
  const description = (Object.keys(counts) as RunState[])
    .filter((state) => counts[state])
    .map((state) => `${counts[state]} ${LABELS[state]}`)
    .join(" · ")
  const state = (
    ["failure", "running", "pending", "cancelled", "neutral", "skipped", "success"] as const
  ).find((state) => counts[state] > 0)
  return {
    description: checks.length ? `${description} / ${checks.length} loaded` : "No checks",
    state,
    counts,
  }
}

export function CheckSummary({ checks }: { checks: Check[] | undefined }) {
  if (!checks) return <span>Checks · Loading</span>
  const { description, state, counts } = checkSummary(checks)
  const busy = counts.pending + counts.running
  const other = counts.skipped + counts.cancelled + counts.neutral
  const compact = [
    counts.success && `${counts.success}✓`,
    counts.failure && `${counts.failure}✕`,
    busy && `${busy} pending`,
    other && `${other} other`,
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <span className="flex items-center gap-1.5">
      {state && (
        <span aria-hidden="true">
          <StateIcon state={state} />
        </span>
      )}
      <span>Checks</span>
      <span className="sr-only">· {description}</span>
      <span aria-hidden="true" className="text-xs font-normal">
        {checks.length ? `${compact} / ${checks.length} loaded` : "No checks"}
      </span>
    </span>
  )
}

export function CheckSummaryHelp({ checks }: { checks: Check[] | undefined }) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-xs" aria-label="Check status details" />}
      >
        <InfoIcon />
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverTitle>Loaded checks</PopoverTitle>
        <p>{checks ? checkSummary(checks).description : "Loading checks…"}</p>
        <p className="text-xs text-muted-foreground">
          Shows up to 100 check results from GitHub. Counts describe loaded results, not a complete
          GitHub total. Skipped, cancelled and neutral checks are not counted as passed.
        </p>
      </PopoverContent>
    </Popover>
  )
}
