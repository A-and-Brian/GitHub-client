import type { PullRequestDetail } from "@github-client/core"

export function FilesTab({ detail }: { detail: PullRequestDetail }) {
  return (
    <div className="p-6 text-sm text-muted-foreground">{detail.changedFiles} files changed</div>
  )
}
