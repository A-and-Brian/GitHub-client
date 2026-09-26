import type { CheckState, ReviewDecision } from "@github-client/core"
import { Badge } from "@github-client/ui/components/reui/badge"
import { cn } from "@github-client/ui/lib/utils"
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleSlashIcon,
  CircleXIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
} from "lucide-react"

export type RunState =
  | "success"
  | "failure"
  | "pending"
  | "running"
  | "skipped"
  | "cancelled"
  | "neutral"

/** Normalizes GitHub check, status, run, job, and step states. */
export function runState(status: string | null, conclusion: string | null): RunState {
  const s = status?.toLowerCase()
  const c = conclusion?.toLowerCase()
  if (s === "in_progress") return "running"
  if (s && s !== "completed" && !c)
    return s === "success" ? "success" : s === "failure" || s === "error" ? "failure" : "pending"
  switch (c) {
    case "success":
      return "success"
    case "failure":
    case "error":
    case "timed_out":
    case "startup_failure":
    case "action_required":
      return "failure"
    case "cancelled":
      return "cancelled"
    case "skipped":
      return "skipped"
    case "neutral":
    case "stale":
      return "neutral"
    default:
      return "pending"
  }
}

export function rollupState(state: CheckState): RunState | null {
  if (!state) return null
  if (state === "SUCCESS") return "success"
  if (state === "FAILURE" || state === "ERROR") return "failure"
  return "pending"
}

const ICONS: Record<RunState, { icon: typeof CircleCheckIcon; className: string; label: string }> =
  {
    success: { icon: CircleCheckIcon, className: "text-success", label: "Succeeded" },
    failure: { icon: CircleXIcon, className: "text-destructive", label: "Failed" },
    pending: { icon: CircleDashedIcon, className: "text-warning", label: "Pending" },
    running: { icon: LoaderCircleIcon, className: "text-warning animate-spin", label: "Running" },
    skipped: { icon: CircleSlashIcon, className: "text-muted-foreground", label: "Skipped" },
    cancelled: { icon: CircleSlashIcon, className: "text-muted-foreground", label: "Cancelled" },
    neutral: { icon: CircleDotIcon, className: "text-muted-foreground", label: "Neutral" },
  }

export function StateIcon({ state, className }: { state: RunState; className?: string }) {
  const { icon: Icon, className: color, label } = ICONS[state]
  return <Icon aria-label={label} className={cn("size-4 shrink-0", color, className)} />
}

export function ReviewBadge({ decision }: { decision: ReviewDecision }) {
  if (decision === "APPROVED") return <Badge variant="success-light">Approved</Badge>
  if (decision === "CHANGES_REQUESTED")
    return <Badge variant="destructive-light">Changes requested</Badge>
  if (decision === "REVIEW_REQUIRED") return <Badge variant="warning-light">Review required</Badge>
  return null
}

export function PullStateIcon({
  state,
  isDraft,
  className,
}: {
  state: "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean
  className?: string
}) {
  const cls = cn("size-4 shrink-0", className)
  if (state === "MERGED")
    return <GitMergeIcon aria-label="Merged" className={cn(cls, "text-info")} />
  if (state === "CLOSED")
    return <GitPullRequestClosedIcon aria-label="Closed" className={cn(cls, "text-destructive")} />
  if (isDraft)
    return (
      <GitPullRequestDraftIcon aria-label="Draft" className={cn(cls, "text-muted-foreground")} />
    )
  return <GitPullRequestIcon aria-label="Open" className={cn(cls, "text-success")} />
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium"
      style={{ borderColor: `#${color}80`, backgroundColor: `#${color}26` }}
    >
      {name}
    </span>
  )
}
