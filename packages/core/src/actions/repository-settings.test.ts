import { expect, test } from "vitest"
import { RestClient } from "../github/rest"
import type { RecordedRequest } from "../test/fake-github"
import {
  changedRepositorySettings,
  getRepositorySettings,
  type RepositorySettings,
  RepositorySettingsConflictError,
  RepositorySettingsPermissionError,
  RepositorySettingsReadbackError,
  rebaseRepositorySettingsDraft,
  updateRepositorySettings,
} from "./repository-settings"

const apiSettings = {
  description: "A repository",
  homepage: "https://example.com",
  has_issues: true,
  has_wiki: false,
  allow_squash_merge: true,
  allow_rebase_merge: true,
  allow_merge_commit: false,
  delete_branch_on_merge: false,
  permissions: { admin: true },
}

const settings: RepositorySettings = {
  description: "A repository",
  homepage: "https://example.com",
  hasIssues: true,
  hasWiki: false,
  allowSquashMerge: true,
  allowRebaseMerge: true,
  allowMergeCommit: false,
  deleteBranchOnMerge: false,
  canAdmin: true,
}

function scriptedClient(responses: Array<{ status?: number; body?: unknown }>) {
  const requests: RecordedRequest[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const response = responses[requests.length - 1]
    if (!response) throw new Error("Unexpected GitHub request")
    return new Response(response.status === 204 ? null : JSON.stringify(response.body ?? {}), {
      status: response.status ?? 200,
    })
  }
  return { rest: new RestClient({ fetch, getToken: () => "token" }), requests }
}

test("loads only fields GitHub returns and treats absent admin permission as read-only", async () => {
  const { rest } = scriptedClient([{ body: { has_issues: true, permissions: {} } }])
  const result = await getRepositorySettings(rest, "acme", "api")
  expect(result).toMatchObject({ hasIssues: true, canAdmin: false })
  expect(result.description).toBeUndefined()
  expect(result.allowSquashMerge).toBeUndefined()
})

test("does not make omitted API fields writable", () => {
  const current = { ...settings, description: undefined }
  const draft = { ...current, description: "Unsupported", hasIssues: false }
  expect(changedRepositorySettings(current, draft)).toEqual({ hasIssues: false })
})

test("rebases only intended edits over concurrent changes to untouched fields", () => {
  const latest = { ...settings, description: "Remote edit", hasWiki: true }
  const draft = { ...settings, description: "My edit" }
  const rebased = rebaseRepositorySettingsDraft(latest, draft, ["description"])
  const { canAdmin: _canAdmin, ...latestDraft } = latest
  expect(rebased).toEqual({ ...latestDraft, description: "My edit" })
  expect(changedRepositorySettings(latest, rebased)).toEqual({ description: "My edit" })
})

test("preflights, patches only changed supported fields, and returns authoritative values", async () => {
  const { rest, requests } = scriptedClient([
    { body: apiSettings },
    { body: {} },
    { body: { ...apiSettings, description: "Updated", has_wiki: true } },
  ])
  const draft = { ...settings, description: "Updated", hasWiki: true }

  const result = await updateRepositorySettings(rest, "acme", "api", settings, draft)

  expect(requests.map(({ method }) => method)).toEqual(["GET", "PATCH", "GET"])
  expect(requests[1]!.body).toEqual({ description: "Updated", has_wiki: true })
  expect(result).toMatchObject({ description: "Updated", hasWiki: true, canAdmin: true })
})

test("detects conflicts only on fields the user changed and preserves latest values", async () => {
  const changed = { ...settings, description: "My draft", hasWiki: true }
  const { rest, requests } = scriptedClient([
    { body: { ...apiSettings, description: "Someone else's edit" } },
  ])

  await expect(
    updateRepositorySettings(rest, "acme", "api", settings, changed),
  ).rejects.toMatchObject(
    new RepositorySettingsConflictError(["description"], {
      ...settings,
      description: "Someone else's edit",
    }),
  )
  expect(requests.map(({ method }) => method)).toEqual(["GET"])
})

test("uses fresh admin permission rather than trusting the initial read", async () => {
  const { rest, requests } = scriptedClient([
    { body: { ...apiSettings, permissions: { admin: false } } },
  ])
  await expect(
    updateRepositorySettings(rest, "acme", "api", settings, {
      ...settings,
      description: "Changed",
    }),
  ).rejects.toBeInstanceOf(RepositorySettingsPermissionError)
  expect(requests.map(({ method }) => method)).toEqual(["GET"])
})

test.each([403, 422])("preserves GitHub %i errors without claiming a save", async (status) => {
  const { rest, requests } = scriptedClient([
    { body: apiSettings },
    { status, body: { message: "Rejected by GitHub" } },
  ])
  await expect(
    updateRepositorySettings(rest, "acme", "api", settings, {
      ...settings,
      description: "Changed",
    }),
  ).rejects.toMatchObject({ status, message: "Rejected by GitHub" })
  expect(requests.map(({ method }) => method)).toEqual(["GET", "PATCH"])
})

test("reports an uncertain save if GitHub accepts PATCH but the readback fails", async () => {
  const { rest, requests } = scriptedClient([
    { body: apiSettings },
    { body: {} },
    { status: 503, body: { message: "Service unavailable" } },
  ])
  const error = await updateRepositorySettings(rest, "acme", "api", settings, {
    ...settings,
    description: "Changed",
  }).catch((cause: unknown) => cause)
  expect(error).toBeInstanceOf(RepositorySettingsReadbackError)
  expect(error).toMatchObject({ message: expect.stringContaining("accepted the changes") })
  expect(requests.map(({ method }) => method)).toEqual(["GET", "PATCH", "GET"])
})

test("does not allow disabling every merge method through the core action", async () => {
  const { rest, requests } = scriptedClient([{ body: apiSettings }])
  await expect(
    updateRepositorySettings(rest, "acme", "api", settings, {
      ...settings,
      allowSquashMerge: false,
      allowRebaseMerge: false,
    }),
  ).rejects.toThrow("At least one merge method must remain enabled")
  expect(requests.map(({ method }) => method)).toEqual(["GET"])
})
