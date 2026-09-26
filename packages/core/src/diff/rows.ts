import { anchorKeys, commentAnchor, type DiffLine, type Hunk } from "./parse"

export type Side = "LEFT" | "RIGHT"

/** A review thread or draft comment: anything that anchors on a file line. */
export interface Anchored {
  id: string
  path: string
  /** Null for outdated threads. */
  line: number | null
  side: Side
}

export interface DiffFile {
  path: string
  /** Null when GitHub sent no patch (binary or too large). */
  hunks: Hunk[] | null
  collapsed: boolean
}

/** Where a new comment editor is open. */
export interface EditorAnchor {
  path: string
  side: Side
  line: number
}

type Row<K extends string, P = unknown> = { kind: K; key: string; file: number } & P

/** One row of the flattened, virtualized diff. `file` indexes the input files. */
export type DiffRow<T, D> =
  | Row<"file">
  | Row<"notice">
  | Row<"outdated", { threads: T[]; drafts: D[] }>
  | Row<"hunk", { hunk: number }>
  | Row<"line", { hunk: number; line: number }>
  | Row<"thread", { thread: T }>
  | Row<"draft", { draft: D }>
  | Row<"editor">

/**
 * Flattens files into rows. Threads, drafts, and the open editor follow the line
 * they anchor on. Comments that match no line (outdated, or outside the diff) are
 * gathered in one `outdated` row after the file header.
 */
export function buildDiffRows<T extends Anchored, D extends Anchored>(input: {
  files: DiffFile[]
  threads: T[]
  drafts: D[]
  editor: EditorAnchor | null
}): DiffRow<T, D>[] {
  const rows: DiffRow<T, D>[] = []
  const threadsByPath = groupByPath(input.threads)
  const draftsByPath = groupByPath(input.drafts)

  input.files.forEach((f, file) => {
    const { path } = f
    rows.push({ kind: "file", key: `f:${path}`, file })
    if (f.collapsed) return

    const threads = byAnchor(threadsByPath.get(path) ?? [])
    const drafts = byAnchor(draftsByPath.get(path) ?? [])
    const editorKey = input.editor?.path === path ? `${input.editor.side}:${input.editor.line}` : ""
    const lineKeys = new Set<string>()
    for (const hunk of f.hunks ?? [])
      for (const line of hunk.lines) for (const key of anchorKeys(line)) lineKeys.add(key)

    const unmatched = <A extends Anchored>(m: Map<string, A[]>) =>
      [...m].filter(([key]) => !lineKeys.has(key)).flatMap(([, list]) => list)
    const outdated = { threads: unmatched(threads), drafts: unmatched(drafts) }
    if (outdated.threads.length + outdated.drafts.length > 0)
      rows.push({ kind: "outdated", key: `o:${path}`, file, ...outdated })

    if (!f.hunks) {
      rows.push({ kind: "notice", key: `n:${path}`, file })
      return
    }
    f.hunks.forEach((hunk, h) => {
      rows.push({ kind: "hunk", key: `h:${path}:${h}`, file, hunk: h })
      hunk.lines.forEach((line, l) => {
        rows.push({ kind: "line", key: `l:${path}:${h}:${l}`, file, hunk: h, line: l })
        const keys = anchorKeys(line)
        for (const key of keys)
          for (const thread of threads.get(key) ?? [])
            rows.push({ kind: "thread", key: `t:${thread.id}`, file, thread })
        for (const key of keys)
          for (const draft of drafts.get(key) ?? [])
            rows.push({ kind: "draft", key: `d:${draft.id}`, file, draft })
        if (keys.includes(editorKey)) rows.push({ kind: "editor", key: "editor", file })
      })
    })
  })
  return rows
}

function groupByPath<A extends Anchored>(items: A[]): Map<string, A[]> {
  const map = new Map<string, A[]>()
  for (const item of items) map.set(item.path, [...(map.get(item.path) ?? []), item])
  return map
}

/** Outdated items get a key no line has, so they always count as unmatched. */
function byAnchor<A extends Anchored>(items: A[]): Map<string, A[]> {
  const map = new Map<string, A[]>()
  for (const item of items) {
    const key = item.line === null ? "outdated" : `${item.side}:${item.line}`
    map.set(key, [...(map.get(key) ?? []), item])
  }
  return map
}

/**
 * The comment range for the lines between indexes `from` and `to` of one hunk,
 * in either order. The last line decides the side; the range starts at the first
 * line that has a number on that side.
 */
export function rangeAnchor(
  lines: DiffLine[],
  from: number,
  to: number,
): { side: Side; line: number; startLine: number | null } {
  const [first, last] = from <= to ? [from, to] : [to, from]
  const { side, line } = commentAnchor(lines[last]!)
  let startLine = line
  for (let i = first; i <= last; i++) {
    const n = sideNumber(lines[i]!, side)
    if (n !== null) {
      startLine = n
      break
    }
  }
  return { side, line, startLine: startLine === line ? null : startLine }
}

/** Lines of a hunk whose number on `side` lies between `startLine` and `line`. */
export function linesInRange(
  lines: DiffLine[],
  side: Side,
  startLine: number | null,
  line: number,
): DiffLine[] {
  const start = startLine ?? line
  return lines.filter((l) => {
    const n = sideNumber(l, side)
    return n !== null && n >= start && n <= line
  })
}

function sideNumber(line: DiffLine, side: Side): number | null {
  return side === "RIGHT" ? line.newLine : line.oldLine
}
