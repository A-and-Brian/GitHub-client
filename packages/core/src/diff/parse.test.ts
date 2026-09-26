import { expect, test } from "vitest"
import { anchorKeys, commentAnchor, hunkSides, parsePatch } from "./parse"

const patch = [
  "@@ -1,4 +1,5 @@ function main() {",
  " const a = 1",
  "-const b = 2",
  "+const b = 3",
  "+const c = 4",
  " ",
  "\\ No newline at end of file",
  "@@ -20,2 +21,2 @@",
  " x",
  "-y",
].join("\n")

test("parses hunks with old and new line numbers", () => {
  const hunks = parsePatch(patch)
  expect(hunks).toHaveLength(2)
  expect(hunks[0]!.lines.map((l) => [l.kind, l.oldLine, l.newLine, l.text])).toEqual([
    ["context", 1, 1, "const a = 1"],
    ["del", 2, null, "const b = 2"],
    ["add", null, 2, "const b = 3"],
    ["add", null, 3, "const c = 4"],
    ["context", 3, 4, ""],
  ])
  expect(hunks[1]!.lines.map((l) => [l.oldLine, l.newLine])).toEqual([
    [20, 21],
    [21, null],
  ])
})

test("comments anchor on the side GitHub expects", () => {
  const [context, del, add] = parsePatch(patch)[0]!.lines
  expect(commentAnchor(context!)).toEqual({ line: 1, side: "RIGHT" })
  expect(commentAnchor(del!)).toEqual({ line: 2, side: "LEFT" })
  expect(commentAnchor(add!)).toEqual({ line: 2, side: "RIGHT" })
  expect(anchorKeys(context!)).toEqual(["RIGHT:1", "LEFT:1"])
})

test("splits a hunk into old and new texts for highlighting", () => {
  const sides = hunkSides(parsePatch(patch)[0]!)
  expect(sides.oldText).toBe("const a = 1\nconst b = 2\n")
  expect(sides.newText).toBe("const a = 1\nconst b = 3\nconst c = 4\n")
  expect(sides.newIndex).toEqual([0, -1, 1, 2, 3])
  expect(sides.oldIndex).toEqual([0, 1, -1, -1, 2])
})
