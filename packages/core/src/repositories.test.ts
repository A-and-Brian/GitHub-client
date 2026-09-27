import { expect, test } from "vitest"
import { RestClient } from "./github/rest"
import {
  getContents,
  getReadme,
  listBranches,
  listRepositories,
  type RepositorySummary,
} from "./repositories"

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function scriptedClient(results: Response[]) {
  const urls: URL[] = []
  const headers: Headers[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    urls.push(new URL(String(input)))
    headers.push(new Headers(init?.headers))
    const result = results.shift()
    if (!result) throw new Error("Unexpected GitHub request")
    return result
  }
  return { rest: new RestClient({ fetch, getToken: () => "token" }), urls, headers }
}

const repository: RepositorySummary = {
  id: 12,
  fullName: "acme/api",
  name: "api",
  owner: "acme",
  description: "API",
  private: true,
  archived: false,
  defaultBranch: "main",
  htmlUrl: "https://github.com/acme/api",
  canAdmin: true,
}

function apiRepository(overrides: Record<string, unknown> = {}) {
  return {
    id: repository.id,
    full_name: repository.fullName,
    name: repository.name,
    owner: { login: repository.owner },
    description: repository.description,
    private: repository.private,
    archived: repository.archived,
    default_branch: repository.defaultBranch,
    html_url: repository.htmlUrl,
    permissions: { admin: repository.canAdmin },
    ...overrides,
  }
}

test("lists org and team repositories with explicit 100-item pages and a conservative hasMore flag", async () => {
  const { rest, urls } = scriptedClient([
    response([apiRepository()]),
    response(Array.from({ length: 100 }, (_, id) => apiRepository({ id }))),
  ])

  const org = await listRepositories(rest, { kind: "org", org: "acme inc" }, 2)
  const team = await listRepositories(rest, { kind: "team", org: "acme", slug: "platform" })

  expect(org).toEqual({ items: [repository], hasMore: false })
  expect(team.items).toHaveLength(100)
  expect(team.hasMore).toBe(true)
  expect(urls[0]?.pathname).toBe("/orgs/acme%20inc/repos")
  expect(urls[0]?.searchParams.get("page")).toBe("2")
  expect(urls[0]?.searchParams.get("per_page")).toBe("100")
  expect(urls[0]?.searchParams.get("type")).toBe("all")
  expect(urls[1]?.pathname).toBe("/orgs/acme/teams/platform/repos")
})

test("lists branches without truncating pages and encodes repository path segments", async () => {
  const { rest, urls } = scriptedClient([
    response(Array.from({ length: 100 }, (_, i) => ({ name: `branch-${i}` }))),
  ])
  const page = await listBranches(rest, "acme/team", "repo name", 3)

  expect(page.items).toHaveLength(100)
  expect(page.hasMore).toBe(true)
  expect(urls[0]?.pathname).toBe("/repos/acme%2Fteam/repo%20name/branches")
  expect(urls[0]?.searchParams.get("page")).toBe("3")
  expect(urls[0]?.searchParams.get("per_page")).toBe("100")
})

test("preserves slash refs and nested paths through Contents API query encoding", async () => {
  const encoded = btoa("hello")
  const { rest, urls } = scriptedClient([
    response({
      name: "index.ts",
      path: "src/lib/index.ts",
      type: "file",
      size: 5,
      encoding: "base64",
      content: encoded,
    }),
  ])
  const result = await getContents(rest, "acme", "api", "src/lib/index.ts", "feature/new")

  expect(result).toMatchObject({ kind: "file", entry: { path: "src/lib/index.ts" }, text: "hello" })
  expect(urls[0]?.pathname).toBe("/repos/acme/api/contents/src/lib/index.ts")
  expect(urls[0]?.searchParams.get("ref")).toBe("feature/new")
})

test("marks the 1,000-entry directory cap and recognizes submodules ahead of their dir type", async () => {
  const entries = Array.from({ length: 1000 }, (_, i) => ({
    name: `f${i}`,
    path: `f${i}`,
    type: "file",
    size: 1,
  }))
  const { rest } = scriptedClient([
    response(entries),
    response({
      name: "vendor",
      path: "vendor",
      type: "file",
      size: 0,
      submodule_git_url: "https://github.com/acme/vendor",
    }),
  ])

  await expect(getContents(rest, "acme", "api", "", "main")).resolves.toMatchObject({
    kind: "directory",
    limited: true,
  })
  await expect(getContents(rest, "acme", "api", "vendor", "main")).resolves.toMatchObject({
    kind: "file",
    entry: { type: "submodule" },
    text: null,
    reason: "submodule",
  })
})

test("does not decode oversized or binary file payloads as text", async () => {
  const { rest } = scriptedClient([
    response({
      name: "large.bin",
      path: "large.bin",
      type: "file",
      size: 1024 * 1024 + 1,
      encoding: "none",
    }),
    response({
      name: "image",
      path: "image",
      type: "file",
      size: 2,
      encoding: "base64",
      content: btoa("\0x"),
    }),
  ])

  await expect(getContents(rest, "acme", "api", "large.bin", "main")).resolves.toMatchObject({
    text: null,
    reason: "too-large",
  })
  await expect(getContents(rest, "acme", "api", "image", "main")).resolves.toMatchObject({
    text: null,
    reason: "binary",
  })
})

test("uses rendered README only after checking the size bound and returns null for a missing README", async () => {
  const { rest, urls, headers } = scriptedClient([
    response({ path: "README.md", size: 7 }),
    new Response("<h1>README</h1>", { headers: { "Content-Type": "text/html" } }),
  ])
  await expect(getReadme(rest, "acme", "api", "feature/new")).resolves.toEqual({
    html: "<h1>README</h1>",
    path: "README.md",
  })
  expect(urls[0]?.searchParams.get("ref")).toBe("feature/new")
  expect(urls[1]?.searchParams.get("ref")).toBe("feature/new")
  expect(headers[1]?.get("Accept")).toBe("application/vnd.github.html+json")

  const { rest: oversized } = scriptedClient([
    response({ path: "README.md", size: 1024 * 1024 + 1 }),
  ])
  await expect(getReadme(oversized, "acme", "api", "main")).resolves.toBeNull()

  const { rest: missing } = scriptedClient([response({ message: "Not Found" }, 404)])
  await expect(getReadme(missing, "acme", "api", "main")).resolves.toBeNull()
})

test("propagates repository catalog authorization failures", async () => {
  const { rest } = scriptedClient([
    response({ message: "Resource not accessible by integration" }, 403),
  ])
  await expect(listRepositories(rest, { kind: "org", org: "acme" })).rejects.toMatchObject({
    status: 403,
    message: "Resource not accessible by integration",
  })
})
