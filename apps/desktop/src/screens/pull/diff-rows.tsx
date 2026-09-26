import type {
  DiffLine,
  DraftComment,
  Hunk,
  PullRequestDetail,
  PullRequestFile,
  ReviewThread,
} from "@github-client/core"
import { suggestionBody } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Checkbox } from "@github-client/ui/components/checkbox"
import { Badge } from "@github-client/ui/components/reui/badge"
import { Textarea } from "@github-client/ui/components/textarea"
import { cn } from "@github-client/ui/lib/utils"
import { ChevronDownIcon, ChevronRightIcon, MessageSquareIcon, PlusIcon } from "lucide-react"
import { type CSSProperties, type KeyboardEvent, type ReactNode, useState } from "react"
import { useClient } from "@/app/client"
import { showError } from "@/app/errors"
import { UserAvatar } from "@/components/avatar"
import { GitHubHtml } from "@/components/github-html"
import { RelativeTime } from "@/components/time"
import { openExternal } from "@/platform"
import { useFileTokens } from "./highlight"

const STATUS: Record<PullRequestFile["status"], { letter: string; className: string }> = {
  added: { letter: "A", className: "text-success" },
  removed: { letter: "D", className: "text-destructive" },
  modified: { letter: "M", className: "text-warning" },
  changed: { letter: "M", className: "text-warning" },
  renamed: { letter: "R", className: "text-info" },
  copied: { letter: "C", className: "text-info" },
  unchanged: { letter: "U", className: "text-muted-foreground" },
}

export function FileStatus({ status }: { status: PullRequestFile["status"] }) {
  const { letter, className } = STATUS[status]
  return (
    <span className={cn("w-3 shrink-0 font-mono text-xs font-semibold", className)} title={status}>
      {letter}
    </span>
  )
}

export function FileHeader({
  file,
  first,
  collapsed,
  viewed,
  comments,
  onToggleCollapsed,
  onToggleViewed,
}: {
  file: PullRequestFile
  first: boolean
  collapsed: boolean
  viewed: boolean
  comments: number
  onToggleCollapsed: () => void
  onToggleViewed: () => void
}) {
  return (
    <div className={cn(!first && "pt-4")}>
      <div className="flex items-center gap-2 border-y bg-muted px-2 py-1.5 text-sm">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={collapsed ? "Expand file" : "Collapse file"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </Button>
        <FileStatus status={file.status} />
        <span className="min-w-0 truncate font-mono text-xs" title={file.filename}>
          {file.previousFilename && (
            <span className="text-muted-foreground">{file.previousFilename} → </span>
          )}
          {file.filename}
        </span>
        <span className="shrink-0 font-mono text-xs">
          <span className="text-success">+{file.additions}</span>{" "}
          <span className="text-destructive">−{file.deletions}</span>
        </span>
        {comments > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <MessageSquareIcon className="size-3" />
            {comments}
          </span>
        )}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox renders the control */}
        <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={viewed} onCheckedChange={onToggleViewed} />
          Viewed
        </label>
      </div>
    </div>
  )
}

export function HunkHeader({ hunk }: { hunk: Hunk }) {
  return (
    <div className="truncate bg-(--diff-hunk) px-3 py-1 font-mono text-xs text-muted-foreground">
      {hunk.header}
    </div>
  )
}

export function NoPatchNotice({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3 text-sm text-muted-foreground">
      Binary file, or a diff too large to show here.
      <Button variant="outline" size="xs" onClick={() => openExternal(url)}>
        Open on GitHub
      </Button>
    </div>
  )
}

const LINE_BG: Record<DiffLine["kind"], string> = {
  add: "bg-(--diff-add)",
  del: "bg-(--diff-del)",
  context: "",
}
const GUTTER_BG: Record<DiffLine["kind"], string> = {
  add: "bg-(--diff-add-gutter)",
  del: "bg-(--diff-del-gutter)",
  context: "",
}
const SIGN: Record<DiffLine["kind"], string> = { add: "+", del: "-", context: " " }

export function LineRow({
  headOid,
  path,
  hunks,
  hunk,
  index,
  focused,
  selected,
  onSelect,
  onComment,
}: {
  headOid: string
  path: string
  hunks: Hunk[]
  hunk: number
  index: number
  focused: boolean
  selected: boolean
  onSelect: (extend: boolean) => void
  onComment: (extend: boolean) => void
}) {
  const line = hunks[hunk]!.lines[index]!
  const tokens = useFileTokens(headOid, path, hunks)?.[hunk]?.[index]
  const gutter = cn(
    "cursor-pointer select-none px-2 text-right text-muted-foreground/80",
    GUTTER_BG[line.kind],
  )
  return (
    <div
      className={cn(
        "group grid grid-cols-[3.25rem_3.25rem_1.25rem_1rem_1fr] font-mono text-xs leading-5",
        LINE_BG[line.kind],
        selected && "bg-(--diff-selected)",
        focused && "shadow-[inset_3px_0_0_var(--color-primary)]",
      )}
    >
      <button type="button" className={gutter} onClick={(e) => onSelect(e.shiftKey)}>
        {line.oldLine}
      </button>
      <button type="button" className={gutter} onClick={(e) => onSelect(e.shiftKey)}>
        {line.newLine}
      </button>
      <span className={cn("flex items-center", GUTTER_BG[line.kind])}>
        <button
          type="button"
          aria-label="Comment on this line"
          className="invisible flex size-4 items-center justify-center rounded bg-primary text-primary-foreground group-hover:visible"
          onClick={(e) => onComment(e.shiftKey)}
        >
          <PlusIcon className="size-3" />
        </button>
      </span>
      <span className="select-none text-muted-foreground">{SIGN[line.kind]}</span>
      <code className="whitespace-pre-wrap pr-4 [overflow-wrap:anywhere]">
        {tokens
          ? tokens.map(([text, light, dark], i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens of one line never reorder
                key={i}
                className="diff-token"
                style={{ "--light": light, "--dark": dark } as CSSProperties}
              >
                {text}
              </span>
            ))
          : line.text || " "}
      </code>
    </div>
  )
}

const lineLabel = (line: number | null, startLine: number | null, side: "LEFT" | "RIGHT") => {
  if (line === null) return "an outdated line"
  const lines = startLine && startLine !== line ? `lines ${startLine}–${line}` : `line ${line}`
  return side === "LEFT" ? `${lines} (old)` : lines
}

/** Indented card that sits between diff lines. */
function InlineCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="border-y bg-background px-4 py-2 font-sans">
      <div className={cn("max-w-3xl rounded-lg border", className)}>{children}</div>
    </div>
  )
}

export function ThreadCard({
  detail,
  thread,
  expanded,
  highlighted,
  onToggle,
}: {
  detail: PullRequestDetail
  thread: ReviewThread
  expanded: boolean
  highlighted: boolean
  onToggle: () => void
}) {
  const client = useClient()
  const [busy, setBusy] = useState(false)
  const collapsed = thread.isResolved && !expanded

  const setResolved = async () => {
    setBusy(true)
    try {
      await client.setThreadResolved(detail.repo, detail.number, thread.id, !thread.isResolved)
    } catch (e) {
      showError("Could not update the thread", e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id={`thread-${thread.id}`}>
      <InlineCard className={cn(highlighted && "ring-2 ring-ring")}>
        <header className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
          <MessageSquareIcon className="size-3.5" />
          <span>
            {thread.comments.length} comment{thread.comments.length === 1 ? "" : "s"} on{" "}
            {lineLabel(thread.line, thread.startLine, thread.side)}
          </span>
          {thread.isResolved && <Badge variant="success-light">Resolved</Badge>}
          {thread.isOutdated && <Badge variant="warning-light">Outdated</Badge>}
          <span className="ml-auto flex gap-1">
            {thread.isResolved && (
              <Button variant="ghost" size="xs" onClick={onToggle}>
                {collapsed ? "Show" : "Hide"}
              </Button>
            )}
            {thread.viewerCanResolve && (
              <Button variant="outline" size="xs" disabled={busy} onClick={setResolved}>
                {thread.isResolved ? "Unresolve" : "Resolve"}
              </Button>
            )}
          </span>
        </header>
        {!collapsed && (
          <>
            {thread.comments.map((comment) => (
              <div key={comment.id} className="border-t px-3 py-2">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <UserAvatar src={comment.author?.avatarUrl} login={comment.author?.login} />
                  <span className="font-medium">{comment.author?.login ?? "ghost"}</span>
                  <span className="text-muted-foreground">
                    <RelativeTime iso={comment.createdAt} />
                  </span>
                </div>
                <GitHubHtml html={comment.bodyHTML} />
              </div>
            ))}
            <ReplyBox detail={detail} thread={thread} />
          </>
        )}
      </InlineCard>
    </div>
  )
}

// Rows unmount when they scroll out of the virtualized list; unsent replies live here instead.
const pendingReplies = new Map<string, string>()

function ReplyBox({ detail, thread }: { detail: PullRequestDetail; thread: ReviewThread }) {
  const client = useClient()
  const [open, setOpenState] = useState(() => pendingReplies.has(thread.id))
  const [body, setBodyState] = useState(() => pendingReplies.get(thread.id) ?? "")
  const [busy, setBusy] = useState(false)
  const setBody = (next: string) => {
    setBodyState(next)
    pendingReplies.set(thread.id, next)
  }
  const setOpen = (next: boolean) => {
    setOpenState(next)
    if (next) pendingReplies.set(thread.id, body)
    else pendingReplies.delete(thread.id)
  }
  const first = thread.comments[0]
  if (!first) return null

  const send = async () => {
    // Keyboard submits bypass the disabled button, so guard here too.
    if (busy) return
    if (!body.trim()) return
    setBusy(true)
    try {
      // Replies go to the thread's first comment; GitHub rejects replies to replies.
      await client.reply(detail.repo, detail.number, first.databaseId, body)
      setBodyState("")
      setOpen(false)
    } catch (e) {
      showError("Reply failed", e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t px-3 py-2">
      {open ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            rows={3}
            placeholder="Reply (Markdown). Ctrl+Enter to send, Escape to cancel."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) =>
              editorKeys(e, {
                save: send,
                cancel: () => setOpen(false),
              })
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !body.trim()} onClick={send}>
              Reply
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Reply…
        </Button>
      )}
    </div>
  )
}

function editorKeys(e: KeyboardEvent, actions: { save: () => void; cancel: () => void }) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    actions.save()
  } else if (e.key === "Escape") {
    // Keep page shortcuts (Escape goes back) from seeing this key.
    e.preventDefault()
    actions.cancel()
  }
}

export function DraftCard({ draft, onEdit }: { draft: DraftComment; onEdit: () => void }) {
  const client = useClient()
  return (
    <InlineCard>
      <header className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        <Badge variant="info-light">Pending</Badge>
        <span>Draft on {lineLabel(draft.line, draft.startLine, draft.side)}</span>
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="xs" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="xs" onClick={() => client.deleteDraft(draft.id)}>
            Delete
          </Button>
        </span>
      </header>
      <p className="whitespace-pre-wrap border-t px-3 py-2 text-sm">{draft.body}</p>
    </InlineCard>
  )
}

/**
 * Editor for a new or existing draft comment. `suggestion` holds the new-side
 * lines a suggestion would replace, or null when suggestions do not apply.
 */
export function CommentEditor({
  title,
  initial,
  suggestion,
  onChange,
  onSave,
  onCancel,
}: {
  title: string
  initial: string
  suggestion: string[] | null
  onChange: (body: string) => void
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const [body, setBody] = useState(initial)
  const update = (next: string) => {
    setBody(next)
    onChange(next)
  }
  const save = () => body.trim() && onSave(body)

  return (
    <InlineCard className="flex flex-col gap-2 p-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      <Textarea
        autoFocus
        rows={4}
        placeholder="Comment (Markdown). Ctrl+Enter to save, Escape to cancel."
        value={body}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => editorKeys(e, { save, cancel: onCancel })}
      />
      <div className="flex gap-2">
        {suggestion && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              update(
                `${body}${body && !body.endsWith("\n") ? "\n" : ""}${suggestionBody(suggestion)}`,
              )
            }
          >
            Suggest
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!body.trim()} onClick={save}>
          Save draft
        </Button>
      </div>
    </InlineCard>
  )
}

export function OutdatedBlock({
  open,
  count,
  onToggle,
  children,
}: {
  open: boolean
  count: number
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="border-b bg-muted/30 font-sans">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={onToggle}
      >
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        Outdated comments ({count})
      </button>
      {open && children}
    </div>
  )
}
