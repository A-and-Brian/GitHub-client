import { expect, test } from "vitest"
import { parseLog } from "./parse"
import { groupStarts, groupsContaining, markMatches, visibleLines } from "./view"

const lines = parseLog(
  [
    "##[group]Run checkout",
    "fetching",
    "##[endgroup]",
    "##[group]Run tests",
    "PASS a.test.ts",
    "FAIL b.test.ts",
    "##[endgroup]",
    "##[error]Process completed with exit code 1.",
  ].join("\n"),
)

test("hides lines of collapsed groups and endgroup markers", () => {
  expect(visibleLines(lines, new Set())).toEqual([0, 1, 3, 4, 5, 7])
  expect(visibleLines(lines, new Set(groupStarts(lines)))).toEqual([0, 3, 7])
  expect(visibleLines(lines, new Set([3]))).toEqual([0, 1, 3, 7])
})

test("finds the groups that contain matches", () => {
  expect(groupsContaining(lines, [5, 7])).toEqual(new Set([3]))
  expect(groupsContaining(lines, [0])).toEqual(new Set())
})

test("marks matches across styled segments, case-insensitively", () => {
  const marked = markMatches(
    [
      { text: "Error: ", fg: "red" },
      { text: "some error here" },
    ],
    "error",
  )
  expect(marked.map((s) => [s.text, s.match, s.fg])).toEqual([
    ["Error", true, "red"],
    [": ", false, "red"],
    ["some ", false, undefined],
    ["error", true, undefined],
    [" here", false, undefined],
  ])
  expect(markMatches([{ text: "ab" }, { text: "cd" }], "bc").map((s) => [s.text, s.match])).toEqual(
    [
      ["a", false],
      ["b", true],
      ["c", true],
      ["d", false],
    ],
  )
  expect(markMatches([{ text: "aaa" }], "aa")).toEqual([{ text: "aaa", match: true }])
  expect(markMatches([{ text: "abc" }], "")).toEqual([{ text: "abc", match: false }])
})
