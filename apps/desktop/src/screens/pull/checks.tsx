import type { Check, PullRequestDetail } from "@github-client/core"
import { Link } from "@tanstack/react-router"
import { ExternalLinkIcon } from "lucide-react"
import { runState, StateIcon } from "@/components/status"
import { openExternal } from "@/platform"

export function ChecksTab({ detail }: { detail: PullRequestDetail }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <ChecksContent detail={detail} />
      </div>
    </div>
  )
}

export function ChecksContent({ detail }: { detail: PullRequestDetail }) {
  const [owner, repo] = detail.repo.split("/") as [string, string]
  const groups = new Map<string, Check[]>()
  for (const check of detail.checks) {
    const name = check.workflowName ?? (check.kind === "status" ? "Statuses" : "Other checks")
    groups.set(name, [...(groups.get(name) ?? []), check])
  }
  if (detail.checks.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">No checks reported for the head commit.</p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
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

/** Check run URLs of Actions jobs end in `/job/<id>`. */
function jobIdFromUrl(url: string | null): number | undefined {
  const match = url?.match(/\/job\/(\d+)/)
  return match ? Number(match[1]) : undefined
}
