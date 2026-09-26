import { expect, test } from "vitest"
import { RestClient } from "../github/rest"
import { fakeGitHub } from "../test/fake-github"
import { submitReview, suggestionBody } from "./reviews"
import { parseDispatchInputs } from "./workflows"

test("submits a review with single-line and multi-line comments", async () => {
  const gh = fakeGitHub([{ method: "POST", path: "/repos/acme/api/pulls/5/reviews", body: {} }])
  const rest = new RestClient({ fetch: gh.fetch, getToken: () => "t" })
  const base = { prKey: "acme/api#5", path: "src/a.ts", createdAt: "" }

  await submitReview(rest, {
    repo: "acme/api",
    number: 5,
    commitId: "abc",
    event: "REQUEST_CHANGES",
    body: "",
    comments: [
      { ...base, id: "1", line: 10, startLine: null, side: "RIGHT", body: "one" },
      { ...base, id: "2", line: 14, startLine: 12, side: "LEFT", body: "range" },
    ],
  })

  expect(gh.requests[0]!.body).toEqual({
    commit_id: "abc",
    event: "REQUEST_CHANGES",
    comments: [
      { path: "src/a.ts", body: "one", line: 10, side: "RIGHT" },
      {
        path: "src/a.ts",
        body: "range",
        line: 14,
        side: "LEFT",
        start_line: 12,
        start_side: "LEFT",
      },
    ],
  })
})

test("builds suggestion blocks", () => {
  expect(suggestionBody(["const x = 1"], "Use const")).toBe(
    "Use const\n\n```suggestion\nconst x = 1\n```\n",
  )
})

test("reads workflow_dispatch inputs", () => {
  const yaml = `
on:
  push:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
        default: staging
        required: true
      dry-run:
        type: boolean
        description: Skip the deploy step
`
  expect(parseDispatchInputs(yaml)).toEqual([
    {
      name: "environment",
      type: "choice",
      description: null,
      required: true,
      default: "staging",
      options: ["staging", "production"],
    },
    {
      name: "dry-run",
      type: "boolean",
      description: "Skip the deploy step",
      required: false,
      default: null,
      options: [],
    },
  ])
  expect(parseDispatchInputs("on: workflow_dispatch")).toEqual([])
  expect(parseDispatchInputs("on: [push, workflow_dispatch]")).toEqual([])
  expect(parseDispatchInputs("on: push")).toBeNull()
})
