import type { MergeMethod, PullRequestDetail, TimelineItem } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Badge } from "@github-client/ui/components/reui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@github-client/ui/components/select"
import { Textarea } from "@github-client/ui/components/textarea"
import { Link } from "@tanstack/react-router"
import { GitCommitHorizontalIcon, MessageSquareIcon } from "lucide-react"
import { useId, useRef, useState } from "react"
import { toast } from "sonner"
import { useClient } from "@/app/client"
import { showError } from "@/app/errors"
import { UserAvatar } from "@/components/avatar"
import { GitHubHtml } from "@/components/github-html"
import { ReviewBadge } from "@/components/status"
import { RelativeTime } from "@/components/time"
import { ChecksContent, type WorkflowApprovalProps } from "./checks"

const REVIEW_TEXT: Record<string, string> = {
  APPROVED: "approved these changes",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "had a review dismissed",
  PENDING: "started a review",
}

export function ConversationTab({
  detail,
  onRunSelect,
  checksRailRef,
  workflowApproval,
}: {
  detail: PullRequestDetail
  onRunSelect?: (runId: number, jobId?: number) => void
  checksRailRef?: React.RefObject<HTMLElement | null>
  workflowApproval?: WorkflowApprovalProps
}) {
  const [owner, repo] = detail.repo.split("/") as [string, string]
  const unresolved = detail.threads.filter((t) => !t.isResolved)
  return (
    <div className="pull-conversation-scroll h-full overflow-y-auto">
      <div className="pull-conversation-layout mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <div className="pull-conversation-main flex min-w-0 flex-col gap-4">
          <Card author={detail.author} createdAt={detail.createdAt} verb="opened this pull request">
            <GitHubHtml html={detail.bodyHTML} />
          </Card>
          {detail.timeline.map((item) => (
            <TimelineEntry key={item.id} item={item} />
          ))}
          {unresolved.length > 0 && (
            <section className="rounded-lg border p-3 text-sm">
              <h2 className="mb-2 font-medium">
                {unresolved.length} unresolved review thread{unresolved.length === 1 ? "" : "s"}
              </h2>
              <ul className="flex flex-col gap-1">
                {unresolved.map((t) => (
                  <li key={t.id}>
                    <Link
                      to="/pr/$owner/$repo/$number"
                      params={{ owner, repo, number: String(detail.number) }}
                      search={{ tab: "files" }}
                      hash={`thread-${t.id}`}
                      className="flex gap-2 hover:underline"
                    >
                      <code className="shrink-0 text-xs">
                        {t.path}
                        {t.line ? `:${t.line}` : " (outdated)"}
                      </code>
                      <span className="truncate text-muted-foreground">{t.comments[0]?.body}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {detail.state === "OPEN" && (
            <MergeBox key={`${detail.repo}#${detail.number}:${detail.headOid}`} detail={detail} />
          )}
          <CommentBox detail={detail} />
        </div>
        <aside
          ref={checksRailRef}
          className="pull-conversation-checks w-fit min-w-0 max-w-full"
          aria-label="Pull request checks"
          tabIndex={-1}
        >
          <h2 className="mb-3 text-sm font-semibold">Checks ({detail.checks.length})</h2>
          <ChecksContent detail={detail} onRunSelect={onRunSelect} {...workflowApproval} />
        </aside>
      </div>
    </div>
  )
}

function Card({
  author,
  createdAt,
  verb,
  children,
}: {
  author: { login: string; avatarUrl: string } | null
  createdAt: string
  verb: string
  children?: React.ReactNode
}) {
  return (
    <article className="rounded-lg border">
      <header className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
        <UserAvatar src={author?.avatarUrl} login={author?.login} />
        <span className="font-medium">{author?.login ?? "ghost"}</span>
        <span className="text-muted-foreground">{verb}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          <RelativeTime iso={createdAt} />
        </span>
      </header>
      {children && <div className="px-3 py-2">{children}</div>}
    </article>
  )
}

function TimelineEntry({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "comment":
      return (
        <Card author={item.author} createdAt={item.createdAt} verb="commented">
          <GitHubHtml html={item.bodyHTML} />
        </Card>
      )
    case "review":
      return (
        <Card
          author={item.author}
          createdAt={item.createdAt}
          verb={REVIEW_TEXT[item.state] ?? "reviewed"}
        >
          {item.bodyHTML.trim() ? <GitHubHtml html={item.bodyHTML} /> : undefined}
        </Card>
      )
    case "commit":
      return (
        <div className="flex items-center gap-2 pl-3 text-xs text-muted-foreground">
          <GitCommitHorizontalIcon className="size-4" />
          <span className="truncate text-foreground">{item.messageHeadline}</span>
          <code>{item.oid.slice(0, 7)}</code>
          <span className="ml-auto">
            <RelativeTime iso={item.createdAt} />
          </span>
        </div>
      )
    case "event":
      return (
        <div className="flex items-center gap-2 pl-3 text-xs text-muted-foreground">
          <MessageSquareIcon className="size-4 opacity-0" />
          <span>
            <span className="font-medium text-foreground">{item.actor ?? "someone"}</span>{" "}
            {item.text}
          </span>
          <span className="ml-auto">
            <RelativeTime iso={item.createdAt} />
          </span>
        </div>
      )
  }
}

const MERGE_LABELS: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
}

const MERGE_STATE_TEXT: Record<string, string> = {
  CLEAN: "Ready to merge.",
  BLOCKED: "Merging is blocked by branch protection or required reviews.",
  BEHIND: "The head branch is behind the base branch.",
  DIRTY: "This branch has conflicts that must be resolved.",
  UNSTABLE: "Some checks are failing or pending.",
  DRAFT: "Draft pull requests cannot be merged.",
  HAS_HOOKS: "Ready to merge; hooks will run.",
  UNKNOWN: "Checking whether the branch can be merged…",
}

function MergeBox({ detail }: { detail: PullRequestDetail }) {
  const client = useClient()
  const [method, setMethod] = useState<MergeMethod>(detail.mergeMethods[0] ?? "merge")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const descriptionId = useId()
  const blocked =
    detail.isDraft || detail.mergeable === "CONFLICTING" || !detail.mergeMethods.includes(method)

  const cancel = () => {
    if (submitting.current) return
    setConfirming(false)
    buttonRef.current?.focus()
  }

  const merge = async () => {
    if (submitting.current || blocked) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      await client.merge(detail.repo, detail.number, method)
      setConfirming(false)
      toast.success(`Merged #${detail.number}`)
    } catch (e) {
      showError("Merge failed", e)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <fieldset
      aria-label="Merge pull request"
      className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape" && confirming) {
          event.preventDefault()
          cancel()
        }
      }}
    >
      <ReviewBadge decision={detail.reviewDecision} />
      {detail.mergeable === "CONFLICTING" && <Badge variant="destructive-light">Conflicts</Badge>}
      <span className="text-muted-foreground">
        {MERGE_STATE_TEXT[detail.mergeStateStatus] ?? detail.mergeStateStatus}
      </span>
      <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
        <div className="flex h-7 w-52 justify-end">
          {confirming ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={cancel}>
              Cancel
            </Button>
          ) : detail.mergeMethods.length > 1 ? (
            <Select value={method} onValueChange={(v) => setMethod(v as MergeMethod)}>
              <SelectTrigger size="sm" className="w-52">
                <SelectValue>{MERGE_LABELS[method]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {detail.mergeMethods.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MERGE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <Button
          ref={buttonRef}
          size="sm"
          className="grid"
          disabled={busy || blocked}
          aria-describedby={confirming ? descriptionId : undefined}
          aria-busy={busy}
          onClick={merge}
        >
          <span className="invisible col-start-1 row-start-1" aria-hidden="true">
            Create a merge commit
          </span>
          <span className="col-start-1 row-start-1">
            {busy ? "Merging…" : confirming ? "Confirm merge" : MERGE_LABELS[method]}
          </span>
        </Button>
      </div>
      <p id={descriptionId} role="status" className="min-h-5 basis-full text-muted-foreground">
        {confirming &&
          `${MERGE_LABELS[method]} for ${detail.repo}#${detail.number} into ${detail.baseRef}?`}
      </p>
    </fieldset>
  )
}

function CommentBox({ detail }: { detail: PullRequestDetail }) {
  const client = useClient()
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)

  const send = async () => {
    // Keyboard submits bypass the disabled button, so guard here too.
    if (busy) return
    if (!body.trim()) return
    setBusy(true)
    try {
      await client.comment(detail.repo, detail.number, body)
      setBody("")
    } catch (e) {
      showError("Comment failed", e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <Textarea
        placeholder="Leave a comment (Markdown). Ctrl+Enter to send."
        value={body}
        rows={4}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void send()
          }
        }}
      />
      <Button size="sm" className="self-end" disabled={busy || !body.trim()} onClick={send}>
        Comment
      </Button>
    </section>
  )
}
