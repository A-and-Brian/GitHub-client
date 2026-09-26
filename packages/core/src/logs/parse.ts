export interface Style {
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export interface Segment extends Style {
  text: string
}

export type LogLineKind =
  | "normal"
  | "command"
  | "error"
  | "warning"
  | "notice"
  | "debug"
  | "group"
  | "endgroup"

export interface LogLine {
  index: number
  timestamp: string | null
  kind: LogLineKind
  /** Text without ANSI codes and workflow command markers. */
  text: string
  segments: Segment[]
  /** Index of the `group` line this line belongs to, if any. */
  group: number | null
}

const TIMESTAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/
// The runner prints commands it runs as `[command]`, without the `##` of workflow commands.
const COMMAND = /^(?:##\[(group|endgroup|error|warning|notice|debug|command)\]|\[(command)\])/
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences
const SGR = /\x1b\[([\d;]*)m/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences
const OTHER_ESCAPES = /\x1b\[[\d;?]*[A-Za-ln-z]/g

/** Parses a GitHub Actions job log into lines with styles and groups. */
export function parseLog(source: string): LogLine[] {
  const lines: LogLine[] = []
  let group: number | null = null
  const rows = source.replace(/^\uFEFF/, "").split(/\r?\n/)
  if (rows.at(-1) === "") rows.pop()
  for (const raw of rows) {
    const stamp = TIMESTAMP.exec(raw)
    let rest = stamp ? raw.slice(stamp[0].length) : raw
    const command = COMMAND.exec(rest)
    const kind = ((command?.[1] ?? command?.[2]) as LogLineKind | undefined) ?? "normal"
    if (command) rest = rest.slice(command[0].length)
    const segments = parseAnsi(rest)
    const index = lines.length
    if (kind === "group") group = index
    lines.push({
      index,
      timestamp: stamp?.[1] ?? null,
      kind,
      text: segments.map((s) => s.text).join(""),
      segments,
      group: kind === "group" ? null : group,
    })
    if (kind === "endgroup") group = null
  }
  return lines
}

const BASIC = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]

/** ANSI 256-color index to a CSS color. */
function color256(n: number): string {
  if (n < 8) return `var(--ansi-${BASIC[n]})`
  if (n < 16) return `var(--ansi-bright-${BASIC[n - 8]})`
  if (n < 232) {
    const i = n - 16
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${level(Math.floor(i / 36))}, ${level(Math.floor(i / 6) % 6)}, ${level(i % 6)})`
  }
  const gray = 8 + (n - 232) * 10
  return `rgb(${gray}, ${gray}, ${gray})`
}

export function parseAnsi(input: string): Segment[] {
  const text = input.replace(OTHER_ESCAPES, "")
  const segments: Segment[] = []
  let style: Style = {}
  let last = 0
  for (const match of text.matchAll(SGR)) {
    if (match.index > last) segments.push({ ...style, text: text.slice(last, match.index) })
    style = applySgr(style, match[1] ? match[1].split(";").map(Number) : [0])
    last = match.index + match[0].length
  }
  if (last < text.length || segments.length === 0) {
    segments.push({ ...style, text: text.slice(last) })
  }
  return segments
}

function applySgr(current: Style, codes: number[]): Style {
  const style = { ...current }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) {
      for (const key of Object.keys(style)) delete style[key as keyof Style]
    } else if (code === 1) style.bold = true
    else if (code === 3) style.italic = true
    else if (code === 4) style.underline = true
    else if (code === 22) delete style.bold
    else if (code === 23) delete style.italic
    else if (code === 24) delete style.underline
    else if (code >= 30 && code <= 37) style.fg = `var(--ansi-${BASIC[code - 30]})`
    else if (code >= 90 && code <= 97) style.fg = `var(--ansi-bright-${BASIC[code - 90]})`
    else if (code >= 40 && code <= 47) style.bg = `var(--ansi-${BASIC[code - 40]})`
    else if (code >= 100 && code <= 107) style.bg = `var(--ansi-bright-${BASIC[code - 100]})`
    else if (code === 39) delete style.fg
    else if (code === 49) delete style.bg
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg"
      if (codes[i + 1] === 5) {
        style[key] = color256(codes[i + 2] ?? 0)
        i += 2
      } else if (codes[i + 1] === 2) {
        style[key] = `rgb(${codes[i + 2] ?? 0}, ${codes[i + 3] ?? 0}, ${codes[i + 4] ?? 0})`
        i += 4
      }
    }
  }
  return style
}

/** Indexes of lines containing `query`, case-insensitive. */
export function searchLog(lines: LogLine[], query: string): number[] {
  const needle = query.toLowerCase()
  if (!needle) return []
  return lines.filter((l) => l.text.toLowerCase().includes(needle)).map((l) => l.index)
}
