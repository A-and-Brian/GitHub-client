import { jobKeys, type PullRequest } from "@github-client/core"
import { CircleHelpIcon, ClockIcon } from "lucide-react"
import { useJobStatus } from "@/app/client"
import { rollupState, StateIcon } from "@/components/status"

export function InboxCheck({
  pull,
  now,
  online,
  id,
}: {
  pull: PullRequest
  now: number
  online: boolean
  id: string
}) {
  const status = useJobStatus(jobKeys.groupPulls(pull.groupId))
  const stale = !status?.lastSuccess || now - status.lastSuccess > 3 * 60_000
  const state = rollupState(pull.checkState)
  const freshness = !online
    ? "Offline"
    : status?.error
      ? "Sync failed"
      : stale
        ? "Awaiting refresh"
        : null
  const result =
    state === "failure"
      ? "failed"
      : state === "success"
        ? "passed"
        : state === "pending"
          ? "pending"
          : "unknown"
  const label = freshness ? `${freshness}; last check: ${result}` : `Checks ${result}`
  return (
    <span
      id={id}
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center gap-0.5"
    >
      {state ? (
        <StateIcon state={state} />
      ) : (
        <CircleHelpIcon className="size-3.5 text-muted-foreground" />
      )}
      {freshness && <ClockIcon aria-hidden="true" className="size-2.5 text-muted-foreground" />}
    </span>
  )
}
