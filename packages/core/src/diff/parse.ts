export interface DiffLine {
  kind: "context" | "add" | "del"
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface Hunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/

/** Parses the `patch` field GitHub returns for one file (hunks only, no file header). */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | undefined
  let oldLine = 0
  let newLine = 0
  const rows = patch.split("\n")
  if (patch.endsWith("\n")) rows.pop()
  for (const raw of rows) {
    const header = HUNK_HEADER.exec(raw)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      current = { header: raw, oldStart: oldLine, newStart: newLine, lines: [] }
      hunks.push(current)
      continue
    }
    if (!current || raw.startsWith("\\")) continue
    const marker = raw[0]
    const text = raw.slice(1)
    if (marker === "+") {
      current.lines.push({ kind: "add", oldLine: null, newLine: newLine++, text })
    } else if (marker === "-") {
      current.lines.push({ kind: "del", oldLine: oldLine++, newLine: null, text })
    } else {
      current.lines.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text })
    }
  }
  return hunks
}

/**
 * Where a review comment can anchor on a diff line. GitHub addresses comments by
 * `line` and `side`: RIGHT for added and context lines, LEFT for deleted lines.
 */
export function commentAnchor(line: DiffLine): { line: number; side: "LEFT" | "RIGHT" } {
  return line.kind === "del"
    ? { line: line.oldLine!, side: "LEFT" }
    : { line: line.newLine!, side: "RIGHT" }
}

/** Keys under which a line can be found by threads (`side:line`). */
export function anchorKeys(line: DiffLine): string[] {
  const keys: string[] = []
  if (line.newLine !== null) keys.push(`RIGHT:${line.newLine}`)
  if (line.oldLine !== null) keys.push(`LEFT:${line.oldLine}`)
  return keys
}

/**
 * Old-side and new-side text of a hunk, used for syntax highlighting with more
 * context than single lines. `oldIndex` and `newIndex` map each diff line to its
 * row in the side texts (or -1).
 */
export function hunkSides(hunk: Hunk): {
  oldText: string
  newText: string
  oldIndex: number[]
  newIndex: number[]
} {
  const oldRows: string[] = []
  const newRows: string[] = []
  const oldIndex: number[] = []
  const newIndex: number[] = []
  for (const line of hunk.lines) {
    oldIndex.push(line.kind === "add" ? -1 : oldRows.push(line.text) - 1)
    newIndex.push(line.kind === "del" ? -1 : newRows.push(line.text) - 1)
  }
  return { oldText: oldRows.join("\n"), newText: newRows.join("\n"), oldIndex, newIndex }
}
