import {
  buildDiffRows,
  type DiffRow,
  type DraftComment,
  type Hunk,
  linesInRange,
  type PullRequestDetail,
  type PullRequestFile,
  type PullRequestFiles,
  parsePatch,
  prKey,
  type ReviewThread,
  rangeAnchor,
  type Side,
} from "@github-client/core"
import { Input } from "@github-client/ui/components/input"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { useLocation } from "@tanstack/react-router"
import { useVirtualizer } from "@tanstack/react-virtual"
import { CheckIcon } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useClient } from "@/app/client"
import { useShortcuts } from "@/app/shortcuts"
import {
  CommentEditor,
  DraftCard,
  FileHeader,
  FileStatus,
  HunkHeader,
  LineRow,
  NoPatchNotice,
  OutdatedBlock,
  ThreadCard,
} from "./diff-rows"
import { useViewedFiles } from "./viewed"

type Row = DiffRow<ReviewThread, DraftComment>

interface ParsedFile {
  file: PullRequestFile
  hunks: Hunk[] | null
}

/** Focused line (`focus`) and the other end of a shift-extended range (`anchor`), in one hunk. */
interface Selection {
  path: string
  hunk: number
  anchor: number
  focus: number
}

type Editor =
  | { kind: "new"; path: string; side: Side; line: number; startLine: number | null }
  | { kind: "edit"; draftId: string }

const ESTIMATES: Record<Row["kind"], number> = {
  file: 44,
  notice: 48,
  outdated: 30,
  hunk: 24,
  line: 20,
  thread: 160,
  draft: 90,
  editor: 190,
}

export function FilesTab({ detail }: { detail: PullRequestDetail }) {
  const client = useClient()
  const key = prKey(detail.repo, detail.number)
  const files = useLiveQuery(
    (q) => q.from({ f: client.collections.pullFiles.collection }).where(({ f }) => eq(f.key, key)),
    [key],
  ).data[0]
  if (!files) return <p className="p-6 text-sm text-muted-foreground">Loading files…</p>
  return <FilesView detail={detail} files={files} />
}

function FilesView({ detail, files }: { detail: PullRequestDetail; files: PullRequestFiles }) {
  const client = useClient()
  const key = prKey(detail.repo, detail.number)
  const drafts = useLiveQuery(
    (q) => q.from({ d: client.collections.drafts }).where(({ d }) => eq(d.prKey, key)),
    [key],
  ).data
  const { viewed, toggle: toggleViewed } = useViewedFiles(key, files.headOid)
  const [filter, setFilter] = useState("")
  const [collapsedOverride, setCollapsedOverride] = useState(new Map<string, boolean>())
  const [expandedThreads, setExpandedThreads] = useState(new Set<string>())
  const [openOutdated, setOpenOutdated] = useState(new Set<string>())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  // Kept outside state so typing does not rebuild rows, and survives the editor scrolling away.
  const editorText = useRef("")
  // Row that `n`/`p`/`]`/`[` last jumped to; navigation continues from there.
  const navKey = useRef<string | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const parsed = useMemo<ParsedFile[]>(
    () => files.files.map((file) => ({ file, hunks: file.patch ? parsePatch(file.patch) : null })),
    [files],
  )
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? parsed.filter((p) => p.file.filename.toLowerCase().includes(needle)) : parsed
  }, [parsed, filter])
  const isCollapsed = (path: string) => collapsedOverride.get(path) ?? viewed.has(path)

  const rows = useMemo(
    () =>
      buildDiffRows({
        files: shown.map((p) => ({
          path: p.file.filename,
          hunks: p.hunks,
          collapsed: collapsedOverride.get(p.file.filename) ?? viewed.has(p.file.filename),
        })),
        threads: detail.threads,
        drafts,
        editor: editor?.kind === "new" ? editor : null,
      }),
    [shown, collapsedOverride, viewed, detail.threads, drafts, editor],
  )
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows])
  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of detail.threads) counts.set(t.path, (counts.get(t.path) ?? 0) + 1)
    for (const d of drafts) counts.set(d.path, (counts.get(d.path) ?? 0) + 1)
    return counts
  }, [detail.threads, drafts])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ESTIMATES[rows[i]!.kind],
    getItemKey: (i) => rows[i]!.key,
    overscan: 20,
  })

  const lineKey = (s: Pick<Selection, "path" | "hunk">, line: number) =>
    `l:${s.path}:${s.hunk}:${line}`
  const focusIndex = selection ? rowIndex.get(lineKey(selection, selection.focus)) : undefined
  const pathOf = (row: Row) => shown[row.file]!.file.filename
  const hunkLines = (path: string, hunk: number) =>
    parsed.find((p) => p.file.filename === path)?.hunks?.[hunk]?.lines ?? []

  // Keyboard navigation starts from the last jump or the focused line when on screen,
  // otherwise from the top of the viewport.
  const position = () => {
    const range = virtualizer.range
    const nav = navKey.current === null ? undefined : rowIndex.get(navKey.current)
    const current = nav ?? focusIndex
    if (current !== undefined && range && current >= range.startIndex && current <= range.endIndex)
      return current
    return range?.startIndex ?? 0
  }

  const select = (row: Row, extend: boolean): Selection | null => {
    if (row.kind !== "line") return null
    const path = pathOf(row)
    const keep = extend && selection?.path === path && selection.hunk === row.hunk
    const next = {
      path,
      hunk: row.hunk,
      anchor: keep ? selection.anchor : row.line,
      focus: row.line,
    }
    setSelection(next)
    return next
  }

  const openEditor = (s: Selection | null) => {
    if (!s) return
    const lines = hunkLines(s.path, s.hunk)
    if (!lines[s.focus]) return
    editorText.current = ""
    setEditor({ kind: "new", path: s.path, ...rangeAnchor(lines, s.anchor, s.focus) })
  }

  const closeEditor = () => {
    setEditor(null)
    editorText.current = ""
  }

  const moveLine = (step: 1 | -1, extend: boolean) => {
    navKey.current = null
    const from = position()
    const start = from === focusIndex ? from : from - step
    for (let i = start + step; i >= 0 && i < rows.length; i += step) {
      const row = rows[i]!
      if (row.kind !== "line") continue
      if (extend && (pathOf(row) !== selection?.path || row.hunk !== selection.hunk)) return
      select(row, extend)
      virtualizer.scrollToIndex(i, { align: "auto" })
      return
    }
  }

  const jump = (step: 1 | -1, match: (row: Row) => boolean, align: "start" | "center") => {
    for (let i = position() + step; i >= 0 && i < rows.length; i += step) {
      const row = rows[i]!
      if (!match(row)) continue
      navKey.current = row.key
      virtualizer.scrollToIndex(i, { align })
      return i
    }
  }

  const jumpFile = (step: 1 | -1) => {
    const header = jump(step, (r) => r.kind === "file", "start")
    if (header === undefined) return
    for (let i = header + 1; i < rows.length && rows[i]!.file === rows[header]!.file; i++) {
      if (rows[i]!.kind === "line") return void select(rows[i]!, false)
    }
  }

  const isComment = (r: Row) => r.kind === "thread" || r.kind === "draft" || r.kind === "outdated"

  useShortcuts({
    j: (e) => moveLine(1, e.shiftKey),
    k: (e) => moveLine(-1, e.shiftKey),
    n: () => jumpFile(1),
    p: () => jumpFile(-1),
    "]": () => jump(1, isComment, "center"),
    "[": () => jump(-1, isComment, "center"),
    c: () => openEditor(selection),
    f: () => filterRef.current?.focus(),
  })
  useShortcuts({ Escape: closeEditor }, editor !== null, { priority: true })

  useDeepLink(detail, rows, rowIndex, {
    reveal: (thread) => {
      setCollapsedOverride((m) => new Map(m).set(thread.path, false))
      if (thread.isResolved) setExpandedThreads((s) => new Set(s).add(thread.id))
    },
    openOutdated: (path) => setOpenOutdated((s) => new Set(s).add(path)),
    scrollTo: (index) => virtualizer.scrollToIndex(index, { align: "start" }),
  })
  const highlightedThread = useThreadHash()

  const toggleIn = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set)
    if (!next.delete(value)) next.add(value)
    return next
  }

  const threadCard = (thread: ReviewThread) => (
    <ThreadCard
      key={thread.id}
      detail={detail}
      thread={thread}
      expanded={expandedThreads.has(thread.id)}
      highlighted={highlightedThread === thread.id}
      onToggle={() => setExpandedThreads((s) => toggleIn(s, thread.id))}
    />
  )

  const draftCard = (draft: DraftComment) =>
    editor?.kind === "edit" && editor.draftId === draft.id ? (
      <CommentEditor
        key={draft.id}
        title={`Editing draft on ${draft.path}`}
        initial={editorText.current || draft.body}
        suggestion={suggestionLines(parsed, draft.path, draft.side, draft.startLine, draft.line)}
        onChange={(body) => {
          editorText.current = body
        }}
        onSave={(body) => {
          client.updateDraft(draft.id, body)
          closeEditor()
        }}
        onCancel={closeEditor}
      />
    ) : (
      <DraftCard
        key={draft.id}
        draft={draft}
        onEdit={() => {
          editorText.current = ""
          setEditor({ kind: "edit", draftId: draft.id })
        }}
      />
    )

  const renderRow = (row: Row, index: number): ReactNode => {
    const { file, hunks } = shown[row.file]!
    const path = file.filename
    switch (row.kind) {
      case "file":
        return (
          <FileHeader
            file={file}
            first={index === 0}
            collapsed={isCollapsed(path)}
            viewed={viewed.has(path)}
            comments={commentCounts.get(path) ?? 0}
            onToggleCollapsed={() =>
              setCollapsedOverride((m) => new Map(m).set(path, !isCollapsed(path)))
            }
            onToggleViewed={() => {
              toggleViewed(path)
              setCollapsedOverride((m) => {
                const next = new Map(m)
                next.delete(path)
                return next
              })
            }}
          />
        )
      case "notice":
        return <NoPatchNotice url={`${detail.url}/files`} />
      case "outdated":
        return (
          <OutdatedBlock
            open={openOutdated.has(path)}
            count={row.threads.length + row.drafts.length}
            onToggle={() => setOpenOutdated((s) => toggleIn(s, path))}
          >
            {row.threads.map(threadCard)}
            {row.drafts.map(draftCard)}
          </OutdatedBlock>
        )
      case "hunk":
        return <HunkHeader hunk={hunks![row.hunk]!} />
      case "line": {
        const inSelection =
          selection?.path === path &&
          selection.hunk === row.hunk &&
          row.line >= Math.min(selection.anchor, selection.focus) &&
          row.line <= Math.max(selection.anchor, selection.focus)
        return (
          <LineRow
            headOid={files.headOid}
            path={path}
            hunks={hunks!}
            hunk={row.hunk}
            index={row.line}
            focused={inSelection && selection.focus === row.line}
            selected={inSelection && selection.anchor !== selection.focus}
            onSelect={(extend) => {
              navKey.current = null
              select(row, extend)
            }}
            onComment={(extend) => openEditor(select(row, extend))}
          />
        )
      }
      case "thread":
        return threadCard(row.thread)
      case "draft":
        return draftCard(row.draft)
      case "editor": {
        if (editor?.kind !== "new") return null
        const { side, line, startLine } = editor
        const range = startLine ? `lines ${startLine}–${line}` : `line ${line}`
        return (
          <CommentEditor
            title={`Comment on ${range}${side === "LEFT" ? " (old)" : ""}`}
            initial={editorText.current}
            suggestion={suggestionLines(parsed, path, side, startLine, line)}
            onChange={(body) => {
              editorText.current = body
            }}
            onSave={(body) => {
              client.addDraft({ prKey: key, path, line, startLine, side, body })
              closeEditor()
            }}
            onCancel={closeEditor}
          />
        )
      }
    }
  }

  const topFile = rows[virtualizer.range?.startIndex ?? 0]?.file

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r">
        <div className="flex flex-col gap-1 border-b p-2">
          <Input
            ref={filterRef}
            className="h-7"
            placeholder="Filter files  f"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" || e.key === "Enter") {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
          />
          <span className="px-1 text-xs text-muted-foreground">
            {files.files.length} files · {viewed.size} viewed
            {drafts.length > 0 && ` · ${drafts.length} drafts`}
          </span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {shown.map(({ file }, i) => {
            const slash = file.filename.lastIndexOf("/")
            return (
              <li key={file.filename}>
                <button
                  type="button"
                  title={file.filename}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-muted",
                    i === topFile && "bg-muted",
                  )}
                  onClick={() => {
                    const index = rowIndex.get(`f:${file.filename}`)
                    if (index === undefined) return
                    navKey.current = `f:${file.filename}`
                    virtualizer.scrollToIndex(index, { align: "start" })
                  }}
                >
                  <FileStatus status={file.status} />
                  {/* The directory truncates first so the file name stays readable. */}
                  <span className="flex min-w-0 flex-1">
                    <span className="truncate text-muted-foreground">
                      {file.filename.slice(0, slash + 1)}
                    </span>
                    <span className="max-w-full shrink-0 truncate">
                      {file.filename.slice(slash + 1)}
                    </span>
                  </span>
                  {viewed.has(file.filename) && <CheckIcon className="size-3 text-success" />}
                  <span className="shrink-0 font-mono">
                    <span className="text-success">+{file.additions}</span>{" "}
                    <span className="text-destructive">−{file.deletions}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-relaxed text-muted-foreground">
          j/k line · shift extends · n/p file · ]/[ comment · c comment · f filter
        </p>
      </aside>
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No files match.</p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {renderRow(rows[item.index]!, item.index)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** New-side lines a suggestion replaces; suggestions only apply to the new side. */
function suggestionLines(
  parsed: ParsedFile[],
  path: string,
  side: Side,
  startLine: number | null,
  line: number,
): string[] | null {
  if (side !== "RIGHT") return null
  const hunks = parsed.find((p) => p.file.filename === path)?.hunks ?? []
  const lines = hunks.flatMap((h) => linesInRange(h.lines, side, startLine, line))
  return lines.length > 0 ? lines.map((l) => l.text) : null
}

/** Thread id from `#thread-<id>`, as linked from the Conversation tab. */
function useThreadHash(): string | null {
  const hash = useLocation({ select: (l) => l.hash })
  return hash.startsWith("thread-") ? hash.slice("thread-".length) : null
}

/**
 * Scrolls to the linked thread once, after revealing it: its file may be
 * collapsed, the thread resolved, or listed under outdated comments.
 */
function useDeepLink(
  detail: PullRequestDetail,
  rows: Row[],
  rowIndex: Map<string, number>,
  actions: {
    reveal: (thread: ReviewThread) => void
    openOutdated: (path: string) => void
    scrollTo: (index: number) => void
  },
) {
  const target = useThreadHash()
  const revealed = useRef<string | null>(null)
  const scrolled = useRef<string | null>(null)
  const thread = detail.threads.find((t) => t.id === target)

  useEffect(() => {
    if (!thread || revealed.current === thread.id) return
    revealed.current = thread.id
    actions.reveal(thread)
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when rows change until the thread is reached
  useEffect(() => {
    if (!thread || revealed.current !== thread.id || scrolled.current === thread.id) return
    const inline = rowIndex.get(`t:${thread.id}`)
    const outdated = rowIndex.get(`o:${thread.path}`)
    if (inline === undefined && outdated === undefined) return
    // A frame later the virtualizer is attached, also after StrictMode remounts it.
    const frame = requestAnimationFrame(() => {
      scrolled.current = thread.id
      if (inline === undefined) actions.openOutdated(thread.path)
      actions.scrollTo(inline ?? outdated!)
    })
    return () => cancelAnimationFrame(frame)
  }, [rows, thread])
}
