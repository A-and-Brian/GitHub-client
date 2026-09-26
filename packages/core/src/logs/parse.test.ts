import { expect, test } from "vitest"
import { parseAnsi, parseLog, searchLog } from "./parse"

const log = [
  "﻿2026-09-25T10:00:00.1234567Z ##[group]Run actions/checkout@v5",
  "2026-09-25T10:00:00.2Z with:",
  "2026-09-25T10:00:00.3Z ##[endgroup]",
  "2026-09-25T10:00:01.0Z \x1b[31mFAIL\x1b[0m src/app.test.ts",
  "2026-09-25T10:00:02.0Z ##[error]Process completed with exit code 1.",
  "",
].join("\n")

test("parses timestamps, commands, and groups", () => {
  const lines = parseLog(log)
  expect(lines).toHaveLength(5)
  expect(lines[0]).toMatchObject({
    kind: "group",
    text: "Run actions/checkout@v5",
    timestamp: "2026-09-25T10:00:00.1234567Z",
    group: null,
  })
  expect(lines[1]).toMatchObject({ kind: "normal", text: "with:", group: 0 })
  expect(lines[2]).toMatchObject({ kind: "endgroup", group: 0 })
  expect(lines[3]).toMatchObject({ kind: "normal", text: "FAIL src/app.test.ts", group: null })
  expect(lines[4]).toMatchObject({ kind: "error", text: "Process completed with exit code 1." })
})

test("recognizes commands the runner prints without the ## prefix", () => {
  expect(parseLog("[command]/usr/bin/git version")[0]).toMatchObject({
    kind: "command",
    text: "/usr/bin/git version",
  })
})

test("turns ANSI codes into styled segments", () => {
  expect(parseAnsi("\x1b[1;32mok\x1b[22m done\x1b[0m!")).toEqual([
    { text: "ok", bold: true, fg: "var(--ansi-green)" },
    { text: " done", fg: "var(--ansi-green)" },
    { text: "!" },
  ])
  expect(parseAnsi("\x1b[38;2;10;20;30mx")).toEqual([{ text: "x", fg: "rgb(10, 20, 30)" }])
  expect(parseAnsi("\x1b[2Kclean")).toEqual([{ text: "clean" }])
})

test("searches plain text case-insensitively", () => {
  expect(searchLog(parseLog(log), "fail")).toEqual([3])
  expect(searchLog(parseLog(log), "")).toEqual([])
})
