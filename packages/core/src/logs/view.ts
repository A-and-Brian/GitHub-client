import type { LogLine, Segment } from "./parse"

/** Indexes of the lines to render. Lines of collapsed groups and `endgroup` markers are hidden. */
export function visibleLines(lines: LogLine[], collapsed: ReadonlySet<number>): number[] {
  const visible: number[] = []
  for (const line of lines) {
    if (line.kind === "endgroup") continue
    if (line.group !== null && collapsed.has(line.group)) continue
    visible.push(line.index)
  }
  return visible
}

/** Indexes of every `group` line. */
export const groupStarts = (lines: LogLine[]): number[] =>
  lines.filter((l) => l.kind === "group").map((l) => l.index)

/** Groups that contain any of the `matches` lines, so they can be expanded for search. */
export function groupsContaining(lines: LogLine[], matches: number[]): Set<number> {
  const groups = new Set<number>()
  for (const index of matches) {
    const group = lines[index]?.group
    if (group != null) groups.add(group)
  }
  return groups
}

export interface MarkedSegment extends Segment {
  match: boolean
}

/** Splits styled segments at the case-insensitive occurrences of `query`. */
export function markMatches(segments: Segment[], query: string): MarkedSegment[] {
  const needle = query.toLowerCase()
  const text = segments.map((s) => s.text).join("")
  const ranges: Array<[number, number]> = []
  if (needle) {
    const haystack = text.toLowerCase()
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      const last = ranges.at(-1)
      if (last && at < last[1]) last[1] = at + needle.length
      else ranges.push([at, at + needle.length])
    }
  }
  if (ranges.length === 0) return segments.map((s) => ({ ...s, match: false }))

  // Cut points are segment edges plus range edges; each piece is either inside a range or not.
  const out: MarkedSegment[] = []
  let offset = 0
  let r = 0
  for (const segment of segments) {
    const end = offset + segment.text.length
    let at = offset
    while (at < end) {
      while (r < ranges.length && ranges[r]![1] <= at) r++
      const range = ranges[r]
      const inside = range !== undefined && range[0] <= at
      const next = Math.min(end, range ? (inside ? range[1] : range[0]) : end)
      out.push({ ...segment, text: text.slice(at, next), match: inside })
      at = next
    }
    offset = end
  }
  return out
}
