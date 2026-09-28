import type { Check, PendingWorkflowApproval, PullRequestDetail } from "@github-client/core"
import { Link } from "@tanstack/react-router"
import { ExternalLinkIcon } from "lucide-react"
import { runState, StateIcon } from "@/components/status"
import { openExternal } from "@/platform"
import { ConfirmButton } from "../actions/confirm-button"

export type WorkflowApprovalProps = {
  approvalScopeKey?: string
  approvalCandidates?: PendingWorkflowApproval[]
  approvalError?: unknown
  onApprove?: (candidates: PendingWorkflowApproval[]) => Promise<void>
}

export function ChecksTab({
  detail,
  onRunSelect,
  ...approval
}: {
  detail: PullRequestDetail
  onRunSelect?: (runId: number, jobId?: number) => void
} & WorkflowApprovalProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <ChecksContent detail={detail} onRunSelect={onRunSelect} {...approval} />
      </div>
    </div>
  )
}

export function ChecksContent({
  detail,
  onRunSelect,
  approvalCandidates,
  approvalError,
  onApprove,
  approvalScopeKey,
}: {
  detail: PullRequestDetail
  onRunSelect?: (runId: number, jobId?: number) => void
} & WorkflowApprovalProps) {
  const [owner, repo] = detail.repo.split("/") as [string, string]
  const groups = new Map<string, Check[]>()
  for (const check of detail.checks) {
    const name = check.workflowName ?? (check.kind === "status" ? "Statuses" : "Other checks")
    groups.set(name, [...(groups.get(name) ?? []), check])
  }
  if (detail.checks.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <WorkflowApprovalBanner
          candidates={approvalCandidates}
          error={approvalError}
          scopeKey={approvalScopeKey}
          onApprove={onApprove}
        />
        <p className="p-6 text-sm text-muted-foreground">No checks reported for the head commit.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <WorkflowApprovalBanner
        candidates={approvalCandidates}
        error={approvalError}
        scopeKey={approvalScopeKey}
        onApprove={onApprove}
      />
      {[...groups].map(([name, checks]) => (
        <section key={name} className="rounded-lg border">
          <h2 className="break-words border-b bg-muted/40 px-3 py-2 text-sm font-medium">{name}</h2>
          <ul>
            {checks.map((check) => (
              <li
                key={`${check.name}-${check.url}`}
                className="flex min-w-0 items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <StateIcon state={runState(check.status, check.conclusion)} />
                {check.workflowRunId ? (
                  <Link
                    to="/actions/$owner/$repo/runs/$runId"
                    params={{ owner, repo, runId: String(check.workflowRunId) }}
                    search={{ job: jobIdFromUrl(check.url) }}
                    className="min-w-0 truncate hover:underline"
                    title={check.name}
                    onClick={(event) => {
                      if (!onRunSelect) return
                      event.preventDefault()
                      onRunSelect(check.workflowRunId!, jobIdFromUrl(check.url))
                    }}
                  >
                    {check.name}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate" title={check.name}>
                    {check.name}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs lowercase text-muted-foreground">
                  {check.conclusion ?? check.status}
                </span>
                {check.url && (
                  <button
                    type="button"
                    aria-label={`Open ${check.name} on GitHub`}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => openExternal(check.url!)}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function WorkflowApprovalBanner({
  candidates = [],
  error,
  scopeKey,
  onApprove,
}: {
  candidates?: PendingWorkflowApproval[]
  error?: unknown
  scopeKey?: string
  onApprove?: (candidates: PendingWorkflowApproval[]) => Promise<void>
}) {
  if (candidates.length === 0 && !error) return null
  const names = candidates.map(({ name }) => name)
  return (
    <section
      aria-label="Workflow approval required"
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">
          {candidates.length
            ? `${candidates.length} workflow${candidates.length === 1 ? "" : "s"} awaiting approval`
            : "Workflow approvals unavailable"}
        </h3>
        {candidates.length > 0 ? (
          <ul className="mt-1 list-inside list-disc break-words text-xs text-muted-foreground">
            {candidates.map(({ id, name }) => (
              <li key={id}>{name}</li>
            ))}
          </ul>
        ) : (
          <p className="break-words text-xs text-muted-foreground">
            Could not check for pending workflow approvals. Use Refresh to try again.
          </p>
        )}
      </div>
      {candidates.length > 0 && onApprove && (
        <ConfirmButton
          key={scopeKey}
          title="Approve workflows to run"
          description={`Approving ${names.map((name) => `“${name}”`).join(", ")} allows its PR code to execute.`}
          confirmLabel={`Approve and run ${candidates.length}`}
          success="Workflow approval requested"
          size="xs"
          action={() => onApprove(candidates)}
        >
          Approve and run
        </ConfirmButton>
      )}
      {candidates.length > 0 && Boolean(error) && (
        <p className="break-words text-xs text-destructive">
          Approval status could not be refreshed. Use Refresh to try again.
        </p>
      )}
    </section>
  )
}

/** Check run URLs of Actions jobs end in `/job/<id>`. */
function jobIdFromUrl(url: string | null): number | undefined {
  const match = url?.match(/\/job\/(\d+)/)
  return match ? Number(match[1]) : undefined
}
