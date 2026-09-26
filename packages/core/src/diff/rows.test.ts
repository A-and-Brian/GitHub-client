import { expect, test } from "vitest"
import { parsePatch } from "./parse"
import { type Anchored, buildDiffRows, linesInRange, rangeAnchor } from "./rows"

const hunks = parsePatch(
  ["@@ -1,3 +1,3 @@", " keep", "-old", "+new", " tail", "@@ -10,1 +10,1 @@", " far"].join("\n"),
)

const comment = (id: string, side: "LEFT" | "RIGHT", line: number | null, path = "a.ts") =>
  ({ id, path, side, line }) satisfies Anchored

const keys = (rows: Array<{ kind: string; key: string }>) => rows.map((r) => r.key)

test("comments follow the line they anchor on, threads before drafts before the editor", () => {
  const rows = buildDiffRows({
    files: [{ path: "a.ts", hunks, collapsed: false }],
    threads: [comment("t1", "RIGHT", 2), comment("t2", "LEFT", 2)],
    drafts: [comment("d1", "RIGHT", 2)],
    editor: { path: "a.ts", side: "RIGHT", line: 2 },
  })
  expect(keys(rows)).toEqual([
    "f:a.ts",
    "h:a.ts:0",
    "l:a.ts:0:0",
    "l:a.ts:0:1",
    "t:t2",
    "l:a.ts:0:2",
    "t:t1",
    "d:d1",
    "editor",
    "l:a.ts:0:3",
    "h:a.ts:1",
    "l:a.ts:1:0",
  ])
})

test("context lines match comments on either side", () => {
  const rows = buildDiffRows({
    files: [{ path: "a.ts", hunks, collapsed: false }],
    threads: [comment("left", "LEFT", 10), comment("right", "RIGHT", 10)],
    drafts: [],
    editor: null,
  })
  expect(keys(rows).at(-3)).toBe("l:a.ts:1:0")
  expect(keys(rows).slice(-2).sort()).toEqual(["t:left", "t:right"])
})

test("outdated and unmatched comments are gathered after the file header", () => {
  const rows = buildDiffRows({
    files: [{ path: "a.ts", hunks, collapsed: false }],
    threads: [comment("gone", "RIGHT", null), comment("outside", "RIGHT", 50)],
    drafts: [comment("stale", "LEFT", 99)],
    editor: null,
  })
  expect(rows[1]).toMatchObject({
    kind: "outdated",
    threads: [{ id: "gone" }, { id: "outside" }],
    drafts: [{ id: "stale" }],
  })
  expect(rows.filter((r) => r.kind === "thread" || r.kind === "draft")).toEqual([])
})

test("collapsed files show only their header; files without a patch show a notice", () => {
  const rows = buildDiffRows({
    files: [
      { path: "a.ts", hunks, collapsed: true },
      { path: "logo.png", hunks: null, collapsed: false },
    ],
    threads: [comment("t1", "RIGHT", 2), comment("img", "RIGHT", 1, "logo.png")],
    drafts: [],
    editor: null,
  })
  expect(keys(rows)).toEqual(["f:a.ts", "f:logo.png", "o:logo.png", "n:logo.png"])
})

test("a range takes its side from the last line and starts at the first line on that side", () => {
  const lines = hunks[0]!.lines // keep(1,1) -old(2) +new(2) tail(3,3)
  expect(rangeAnchor(lines, 1, 2)).toEqual({ side: "RIGHT", line: 2, startLine: null })
  expect(rangeAnchor(lines, 3, 0)).toEqual({ side: "RIGHT", line: 3, startLine: 1 })
  expect(rangeAnchor(lines, 0, 1)).toEqual({ side: "LEFT", line: 2, startLine: 1 })
})

test("lines in a range are picked by their number on the given side", () => {
  const lines = hunks[0]!.lines
  expect(linesInRange(lines, "RIGHT", 1, 2).map((l) => l.text)).toEqual(["keep", "new"])
  expect(linesInRange(lines, "LEFT", null, 2).map((l) => l.text)).toEqual(["old"])
})
