import { afterEach, expect, test, vi } from "vitest"
import type { CanonicalPullRequest, CanonicalRepository, ScopedRow } from "../domain/types"
import type { RepositoryContents, RepositorySummary } from "../repositories"
import { RepositoryCache, repositoryResourceKey } from "../repository-cache"
import { tempDatabase } from "../test/persistence"
import { NormalizedDatabase } from "./normalized"
import { createPullCollections, ingestPullRequest } from "./pulls"
import { createResourceCollection } from "./resources"

const files: ReturnType<typeof tempDatabase>[] = []
afterEach(() => {
  for (const file of files.splice(0)) file.close()
})

const host = "https://api.github.com"
const repoName = "acme/api"
const pullRouteKey = {
  kind: "pulls" as const,
  host,
  accountLogin: "alice",
  owner: "acme",
  repo: "api",
  page: 1,
  pageSize: 1,
}
const catalogKey = {
  kind: "catalog" as const,
  host,
  accountLogin: "alice",
  scope: { kind: "org" as const, org: "acme" },
  page: 1,
  pageSize: 1,
}

const repository: RepositorySummary = {
  nodeId: "R_repo",
  id: 19,
  fullName: repoName,
  name: "api",
  owner: "acme",
  ownerNodeId: "O_acme",
  ownerDatabaseId: 7,
  ownerKind: "organization",
  description: "API",
  private: true,
  archived: false,
  defaultBranch: "main",
  htmlUrl: "https://github.com/acme/api",
  canAdmin: true,
}

function pull(title = "Initial title") {
  return {
    node_id: "PR_node",
    number: 3,
    title,
    draft: false,
    user: { login: "yi", node_id: "U_yi", avatar_url: "https://example.com/avatar.png" },
    html_url: "https://github.com/acme/api/pull/3",
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-21T00:00:00Z",
    head: { ref: "topic", sha: "abc123" },
    base: { ref: "main" },
    requested_reviewers: [],
    requested_teams: [],
    labels: [{ name: "bug", color: "ff0000" }],
    inboxObservedAt: "2026-09-21T00:00:00Z",
  }
}

async function setup(persistence: ReturnType<ReturnType<typeof tempDatabase>["open"]>) {
  const db = new NormalizedDatabase(persistence)
  const pulls = createPullCollections(db)
  const resources = createResourceCollection(db, pulls)
  await db.setScope(host, "alice")
  await resources.collection.preload()
  return { db, pulls, resources, cache: new RepositoryCache(resources, true) }
}

test("shares canonical repositories and pulls across resource pages, reloads by ordered IDs, and notifies views", async () => {
  const file = tempDatabase()
  files.push(file)
  const first = await setup(file.open())
  const pullFetch = vi.fn(async (page: number) => ({
    items: [pull(page === 1 ? "Initial title" : "Repeated title")],
    hasMore: page === 1,
  }))
  const pullPage = first.cache.paginated(
    pullRouteKey,
    pullFetch,
    (item) => item.node_id ?? item.number,
  )
  await pullPage.load()
  await pullPage.loadMore()
  expect(pullFetch).toHaveBeenCalledTimes(2)
  expect(pullPage.snapshot()?.data?.items).toHaveLength(1)

  const catalogFetch = vi.fn(async (page: number) => ({ items: [repository], hasMore: page === 1 }))
  const catalog = first.cache.paginated(catalogKey, catalogFetch, (item) => item.id)
  await catalog.load()
  await catalog.loadMore()

  const repoRows = first.db.rows(first.db.table<CanonicalRepository>("repositories"))
  const pullRows = first.db.rows(first.db.table<CanonicalPullRequest>("pullRequests"))
  expect(repoRows).toHaveLength(1)
  expect(pullRows).toHaveLength(1)
  expect(pullPage.snapshot()?.data?.items[0]?.title).toBe("Repeated title")

  const membershipRows = first.db.rows(
    first.db.table<ScopedRow & { data?: unknown; pages?: unknown }>(
      "repositoryResourceMemberships",
    ),
  )
  expect(membershipRows.every((row) => !("data" in row) && !("pages" in row))).toBe(true)
  const itemRows = first.db.rows(
    first.db.table<ScopedRow & { resourceKey: string; entityKey: string }>(
      "repositoryResourceItems",
    ),
  )
  expect(
    itemRows.filter((row) => row.resourceKey === repositoryResourceKey(pullRouteKey)),
  ).toHaveLength(2)

  const listener = vi.fn()
  const stop = pullPage.subscribe(listener)
  const pullId = pullRows[0]!.key
  await first.db.mutate(() =>
    ingestPullRequest(first.db, {
      source: "detail",
      repositoryId: repoRows[0]!.key,
      nodeId: "PR_node",
      number: 3,
      title: "Canonical title updated",
    }).then(() => undefined),
  )
  expect(listener).toHaveBeenCalled()
  expect(pullPage.snapshot()?.data?.items[0]?.title).toBe("Canonical title updated")
  expect(
    first.db.rows(first.db.table<CanonicalPullRequest>("pullRequests")).map((row) => row.key),
  ).toEqual([pullId])
  stop()

  const reopened = await setup(file.open())
  const offline = reopened.cache.paginated<ReturnType<typeof pull>>(
    pullRouteKey,
    async () => {
      throw new Error("unexpected fetch after persisted reload")
    },
    (item) => item.node_id ?? item.number,
  )
  await offline.load()
  expect(offline.snapshot()).toMatchObject({
    loaded: true,
    persisted: true,
    data: { items: [{ title: "Canonical title updated" }], pages: 2 },
  })

  await reopened.resources.remove([repositoryResourceKey(catalogKey)])
  expect(reopened.db.rows(reopened.db.table<CanonicalRepository>("repositories"))).toHaveLength(1)
  expect(reopened.db.rows(reopened.db.table<CanonicalPullRequest>("pullRequests"))).toHaveLength(1)
})

test("resource identities cannot ingest into a different active account scope", async () => {
  const file = tempDatabase()
  files.push(file)
  const first = await setup(file.open())
  let finishAlice!: (value: RepositorySummary) => void
  const aliceSummaryKey = {
    kind: "summary" as const,
    host,
    accountLogin: "alice",
    owner: "acme",
    repo: "api",
  }
  const alice = first.cache.resource(
    aliceSummaryKey,
    () =>
      new Promise((resolve) => {
        finishAlice = resolve
      }),
  )
  const aliceLoad = alice.load()

  await first.db.setScope(host, "bob")
  const bobSummaryKey = { ...aliceSummaryKey, accountLogin: "bob" }
  const bob = first.cache.resource(bobSummaryKey, async () => repository)
  await bob.load()
  finishAlice(repository)
  await aliceLoad

  expect(
    first.db
      .rows(
        first.db.table<ScopedRow & { accountLogin: string; complete: boolean }>(
          "repositoryResourceMemberships",
        ),
      )
      .find((row) => row.accountLogin === "bob")?.complete,
  ).toBe(true)
  expect(bob.snapshot()).toMatchObject({ loaded: true, data: repository, persisted: true })
  expect(first.db.rows(first.db.table<CanonicalRepository>("repositories"))).toHaveLength(1)
  expect(
    first.db
      .rows(first.db.table<ScopedRow & { accountLogin: string }>("repositoryResourceMemberships"))
      .map((row) => row.accountLogin),
  ).toEqual(["bob"])
})

test("a failed resource write does not hide previously saved resources after reload", async () => {
  const file = tempDatabase()
  files.push(file)
  const first = await setup(file.open())
  const resourceKey = (path: string) => ({
    kind: "contents" as const,
    host,
    accountLogin: "alice",
    owner: "acme",
    repo: "api",
    ref: "main",
    path,
  })
  const savedKey = resourceKey("saved.txt")
  const saved = first.cache.resource<RepositoryContents>(savedKey, async () => ({
    kind: "file",
    entry: {
      name: "saved.txt",
      path: "saved.txt",
      type: "file",
      size: 5,
      htmlUrl: "https://github.com/acme/api/blob/main/saved.txt",
    },
    text: "saved",
  }))
  await saved.load()
  expect(saved.snapshot()).toMatchObject({ loaded: true, persisted: true })

  const contentRows = first.db.table<ScopedRow & { path: string }>("repositoryContents")
  const upsert = contentRows.upsert
  contentRows.upsert = async (rows) => {
    if (rows.some((row) => row.path === "broken.txt"))
      throw new Error("injected content write failure")
    await upsert(rows)
  }
  const broken = first.cache.resource<RepositoryContents>(resourceKey("broken.txt"), async () => ({
    kind: "file",
    entry: {
      name: "broken.txt",
      path: "broken.txt",
      type: "file",
      size: 7,
      htmlUrl: "https://github.com/acme/api/blob/main/broken.txt",
    },
    text: "broken",
  }))
  await broken.load()
  expect(broken.snapshot()).toMatchObject({ loaded: true, persisted: false })

  const reopened = await setup(file.open())
  const offline = reopened.cache.resource<RepositoryContents>(savedKey, async () => {
    throw new Error("saved resource should hydrate offline")
  })
  await offline.load()
  expect(offline.snapshot()).toMatchObject({
    loaded: true,
    persisted: true,
    data: { kind: "file", text: "saved" },
  })
  const retry = reopened.cache.resource<RepositoryContents>(
    resourceKey("broken.txt"),
    async () => ({
      kind: "file",
      entry: {
        name: "broken.txt",
        path: "broken.txt",
        type: "file",
        size: 7,
        htmlUrl: "https://github.com/acme/api/blob/main/broken.txt",
      },
      text: "recovered",
    }),
  )
  await retry.load()
  expect(retry.snapshot()).toMatchObject({
    loaded: true,
    persisted: true,
    data: { text: "recovered" },
  })
})

test("catalog and release pages persist with bounded transaction counts", async () => {
  const file = tempDatabase()
  files.push(file)
  const persistence = file.open()
  const driver = (
    persistence as unknown as {
      adapter: { driver: { transaction: (...args: never[]) => unknown } }
    }
  ).adapter.driver
  const originalTransaction = driver.transaction.bind(driver)
  let transactionCount = 0
  driver.transaction = (...args) => {
    transactionCount++
    return originalTransaction(...args)
  }
  const state = await setup(persistence)
  transactionCount = 0

  const catalogPageKey = {
    ...catalogKey,
    scope: { kind: "org" as const, org: "batching" },
    pageSize: 100,
  }
  const summaries = Array.from({ length: 100 }, (_, index) => ({
    ...repository,
    nodeId: `R_batch_${index}`,
    id: index + 1,
    fullName: `acme/repo-${index}`,
    name: `repo-${index}`,
  }))
  const catalogData = {
    items: summaries,
    hasMore: false,
    pages: 1,
    pageData: [{ items: summaries, hasMore: false }],
  }
  const timestamp = Date.now()
  await state.resources.upsert([
    {
      key: repositoryResourceKey(catalogPageKey),
      accountLogin: "alice",
      kind: "catalog",
      identity: JSON.stringify(catalogPageKey),
      data: catalogData,
      fetchedAt: timestamp,
      lastAccessedAt: timestamp,
      payloadBytes: JSON.stringify(catalogData).length,
    },
  ])
  expect(transactionCount).toBeLessThanOrEqual(10)
  expect(state.db.rows(state.db.table<CanonicalRepository>("repositories"))).toHaveLength(100)

  const firstRepository = state.db
    .rows(state.db.table<CanonicalRepository>("repositories"))
    .find((row) => row.nodeId === "R_batch_0")!
  const renamed = { ...summaries[0]!, fullName: "acme/renamed" }
  const renamedData = {
    items: [renamed],
    hasMore: false,
    pages: 1,
    pageData: [{ items: [renamed], hasMore: false }],
  }
  await state.resources.upsert([
    {
      key: repositoryResourceKey(catalogPageKey),
      accountLogin: "alice",
      kind: "catalog",
      identity: JSON.stringify(catalogPageKey),
      data: renamedData,
      fetchedAt: timestamp + 1,
      lastAccessedAt: timestamp + 1,
      payloadBytes: JSON.stringify(renamedData).length,
    },
  ])
  expect(
    state.db
      .rows(state.db.table<CanonicalRepository>("repositories"))
      .find((row) => row.nodeId === "R_batch_0"),
  ).toMatchObject({ key: firstRepository.key, fullName: "acme/renamed" })

  const releaseKey = {
    kind: "releases" as const,
    host,
    accountLogin: "alice",
    owner: "acme",
    repo: "api",
    page: 1,
    pageSize: 100,
  }
  const releases = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    name: `Release ${index}`,
    tagName: `v${index}`,
    body: "",
    draft: false,
    prerelease: false,
    publishedAt: null,
    htmlUrl: `https://github.com/acme/api/releases/tag/v${index}`,
    assets: [
      {
        id: index * 2 + 1,
        name: `asset-${index}-1`,
        size: 1,
        downloadUrl: "https://example.test/1",
      },
      {
        id: index * 2 + 2,
        name: `asset-${index}-2`,
        size: 1,
        downloadUrl: "https://example.test/2",
      },
    ],
  }))
  const releaseData = {
    items: releases,
    hasMore: false,
    pages: 1,
    pageData: [{ items: releases, hasMore: false }],
  }
  transactionCount = 0
  await state.resources.upsert([
    {
      key: repositoryResourceKey(releaseKey),
      accountLogin: "alice",
      kind: "releases",
      identity: JSON.stringify(releaseKey),
      data: releaseData,
      fetchedAt: timestamp,
      lastAccessedAt: timestamp,
      payloadBytes: JSON.stringify(releaseData).length,
    },
  ])
  expect(transactionCount).toBeLessThanOrEqual(10)
  expect(
    state.db.rows(state.db.table<ScopedRow & { releaseId: string }>("repositoryReleaseAssets")),
  ).toHaveLength(200)

  const refreshedReleases = releases.map((release, index) =>
    index === 0 ? { ...release, assets: [] } : release,
  )
  const refreshedData = {
    items: refreshedReleases,
    hasMore: false,
    pages: 1,
    pageData: [{ items: refreshedReleases, hasMore: false }],
  }
  transactionCount = 0
  await state.resources.upsert([
    {
      key: repositoryResourceKey(releaseKey),
      accountLogin: "alice",
      kind: "releases",
      identity: JSON.stringify(releaseKey),
      data: refreshedData,
      fetchedAt: timestamp + 1,
      lastAccessedAt: timestamp + 1,
      payloadBytes: JSON.stringify(refreshedData).length,
    },
  ])
  expect(transactionCount).toBeLessThanOrEqual(10)
  expect(
    state.db.rows(state.db.table<ScopedRow & { releaseId: string }>("repositoryReleaseAssets")),
  ).toHaveLength(198)
})

test("shared content keeps bodies across directory and README observations, and clears stale data on SHA changes", async () => {
  const file = tempDatabase()
  files.push(file)
  const state = await setup(file.open())
  const path = "README.md"
  const contentsKey = {
    kind: "contents" as const,
    host,
    accountLogin: "alice",
    owner: "acme",
    repo: "api",
    ref: "main",
    path,
  }
  const directoryKey = { ...contentsKey, path: "" }
  const readmeKey = {
    kind: "readme" as const,
    host,
    accountLogin: "alice",
    owner: "acme",
    repo: "api",
    ref: "main",
  }
  const docEntry = {
    name: "README.md",
    path,
    sha: "sha-one",
    type: "file" as const,
    size: 4,
    htmlUrl: "https://github.com/acme/api/blob/main/README.md",
  }
  const directory = state.cache.resource<RepositoryContents>(directoryKey, async () => ({
    kind: "directory",
    entries: [docEntry],
    limited: false,
  }))
  const document = state.cache.resource<RepositoryContents>(contentsKey, async () => ({
    kind: "file",
    entry: docEntry,
    text: "text",
  }))
  const readme = state.cache.resource(readmeKey, async () => ({
    html: "<h1>README</h1>",
    path,
    sha: "sha-one",
    size: 4,
    htmlUrl: docEntry.htmlUrl,
  }))
  await directory.load()
  await document.load()
  await readme.load()

  const sameContentDirectory = state.cache.resource<RepositoryContents>(directoryKey, async () => ({
    kind: "directory",
    entries: [{ ...docEntry, htmlUrl: "https://github.com/acme/api/blob/main/README.md?new" }],
    limited: false,
  }))
  await sameContentDirectory.load({ force: true })
  expect(document.snapshot()?.data).toMatchObject({ kind: "file", text: "text" })
  expect(readme.snapshot()?.data).toEqual({ html: "<h1>README</h1>", path })

  const changed = state.cache.resource<RepositoryContents>(contentsKey, async () => ({
    kind: "file",
    entry: { ...docEntry, sha: "sha-two", size: 5 },
    text: "newer",
  }))
  await changed.load({ force: true })
  expect(changed.snapshot()?.data).toMatchObject({ kind: "file", text: "newer" })
  expect(readme.snapshot()?.data).toBeUndefined()
  expect(directory.snapshot()?.data).toMatchObject({
    kind: "directory",
    entries: [{ sha: "sha-two" }],
  })
})
