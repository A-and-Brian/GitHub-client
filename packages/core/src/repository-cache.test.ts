import { expect, test, vi } from "vitest"
import { createCollections } from "./collections"
import { RateLimits } from "./github/rate-limit"
import { GitHubError } from "./github/rest"
import { RepositoryCache, repositoryResourceKey } from "./repository-cache"
import { tempDatabase } from "./test/persistence"

const key = {
  kind: "contents" as const,
  host: "https://api.github.com",
  accountLogin: "Yi",
  owner: "acme",
  repo: "api",
  ref: "main",
  path: "src/index.ts",
}

const catalogKey = {
  kind: "catalog" as const,
  host: key.host,
  accountLogin: key.accountLogin,
  scope: { kind: "org" as const, org: "acme" },
  page: 1,
  pageSize: 2,
}
const readmeKey = {
  kind: "readme" as const,
  host: key.host,
  accountLogin: key.accountLogin,
  owner: key.owner,
  repo: key.repo,
  ref: key.ref,
}
const contentKey = (path: string, accountLogin = "Yi") => ({ ...key, path, accountLogin })
const releasesKey = (overrides: Partial<typeof releaseKeyBase> = {}) => ({
  ...releaseKeyBase,
  ...overrides,
})
const releaseKeyBase = {
  kind: "releases" as const,
  host: key.host,
  accountLogin: key.accountLogin,
  owner: key.owner,
  repo: key.repo,
  page: 1,
  pageSize: 2,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test("deduplicates requests and serves a fresh revisit without fetching", async () => {
  const cache = new RepositoryCache(createCollections().repositoryResources)
  const fetcher = vi.fn(async () => "saved")
  const resource = cache.resource(key, fetcher)
  await Promise.all([resource.load(), resource.load()])
  await resource.load()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(resource.snapshot()).toMatchObject({ loaded: true, data: "saved", persisted: false })
})

test("rehydrates a persisted snapshot from a reopened SQLite database", async () => {
  const database = tempDatabase()
  try {
    const first = new RepositoryCache(createCollections(database.open()).repositoryResources, true)
    const resource = first.resource(key, async () => ({ text: "durable" }))
    await resource.load()
    expect(resource.snapshot()?.persisted).toBe(true)

    const reopened = new RepositoryCache(
      createCollections(database.open()).repositoryResources,
      true,
    )
    const offline = reopened.resource(key, async () => {
      throw new Error("network must not run")
    })
    const unsubscribe = offline.subscribe(() => {})
    // Loading hydrates SQLite before freshness is checked.
    await offline.load()
    expect(offline.snapshot()).toMatchObject({
      loaded: true,
      persisted: true,
      data: { text: "durable" },
    })
    unsubscribe()
  } finally {
    database.close()
  }
})

test("sign-out generation prevents a late response from restoring the account cache", async () => {
  const rows = createCollections().repositoryResources
  const cache = new RepositoryCache(rows)
  let resolve!: (value: string) => void
  let started!: () => void
  const requestStarted = new Promise<void>((done) => {
    started = done
  })
  const resource = cache.resource(
    key,
    () =>
      new Promise<string>((done) => {
        resolve = done
        started()
      }),
  )
  const pending = resource.load()
  await requestStarted
  await cache.clearAccount("yi")
  resolve("late")
  await pending
  expect(resource.snapshot()?.loaded).toBe(false)
  expect(rows.collection.size).toBe(0)
})

test("paginated refresh stages loaded pages and retries a failed next page", async () => {
  const cache = new RepositoryCache(createCollections().repositoryResources)
  const pageCalls: number[] = []
  let failSecond = true
  const fetchPage = async (page: number) => {
    pageCalls.push(page)
    if (page === 2 && failSecond) {
      failSecond = false
      throw new Error("temporary")
    }
    return page === 1
      ? { items: [{ id: "a" }, { id: "b" }], hasMore: true }
      : { items: [{ id: "b" }, { id: "c" }], hasMore: false }
  }
  const resource = cache.paginated(catalogKey, fetchPage, (item) => item.id)
  await resource.load()
  await resource.loadMore()
  expect(resource.snapshot()?.data?.items.map((item) => item.id)).toEqual(["a", "b"])
  expect(resource.snapshot()?.error?.message).toBe("temporary")
  const revisited = cache.paginated(catalogKey, fetchPage, (item) => item.id)
  await revisited.load()
  await revisited.retry()
  expect(pageCalls.slice(-1)).toEqual([2])
  expect(revisited.snapshot()?.data).toMatchObject({
    items: [{ id: "a" }, { id: "b" }, { id: "c" }],
    pages: 2,
    hasMore: false,
  })
  await resource.load({ force: true })
  expect(resource.snapshot()?.data?.items.map((item) => item.id)).toEqual(["a", "b", "c"])
  expect(resource.snapshot()?.error).toBeUndefined()
})

test("release pages paginate and stay isolated by host, account, and repository", async () => {
  const cache = new RepositoryCache(createCollections().repositoryResources)
  const seen: string[] = []
  const first = cache.paginated(
    releasesKey(),
    async (page) => {
      seen.push(`main:${page}`)
      return page === 1
        ? { items: [{ id: 1 }, { id: 2 }], hasMore: true }
        : { items: [{ id: 3 }], hasMore: false }
    },
    (release) => release.id,
  )
  await first.load()
  await first.loadMore()
  expect(first.snapshot()?.data).toMatchObject({
    items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    pages: 2,
    hasMore: false,
  })

  for (const [name, overrides] of [
    ["account", { accountLogin: "other" }],
    ["host", { host: "https://github.example/api/v3" }],
    ["repository", { repo: "other" }],
  ] as const) {
    const resource = cache.paginated(
      releasesKey(overrides),
      async () => {
        seen.push(name)
        return { items: [{ id: name }], hasMore: false }
      },
      (release) => release.id,
    )
    await resource.load()
    expect(resource.snapshot()?.data?.items).toEqual([{ id: name }])
  }
  expect(seen).toEqual(["main:1", "main:2", "account", "host", "repository"])
})

test("keeps stale data during refresh errors and saves resolved null and empty pages", async () => {
  const db = tempDatabase()
  const clock = vi.spyOn(Date, "now")
  try {
    let now = 1_000_000
    clock.mockImplementation(() => now)
    const rows = createCollections(db.open()).repositoryResources
    const cache = new RepositoryCache(rows, true)
    const fetcher = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"))
    const absent = cache.resource(readmeKey, fetcher)
    const empty = cache.paginated(
      catalogKey,
      async () => ({ items: [], hasMore: false }),
      (item: string) => item,
    )
    await absent.load()
    await empty.load()
    expect(absent.snapshot()).toMatchObject({ loaded: true, data: null, persisted: true })
    expect(empty.snapshot()?.data).toMatchObject({ items: [], pages: 1, hasMore: false })
    now += 59_000
    await absent.load()
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 2_000
    await absent.load()
    expect(absent.snapshot()).toMatchObject({
      loaded: true,
      data: null,
      persisted: true,
      error: expect.any(Error),
    })

    const reopened = new RepositoryCache(createCollections(db.open()).repositoryResources, true)
    const offlineAbsent = reopened.resource(readmeKey, async () => {
      throw new Error("network")
    })
    const offlineEmpty = reopened.paginated(
      catalogKey,
      async () => {
        throw new Error("network")
      },
      (item: string) => item,
    )
    await Promise.all([offlineAbsent.load(), offlineEmpty.load()])
    expect(offlineAbsent.snapshot()).toMatchObject({ loaded: true, data: null, persisted: true })
    expect(offlineEmpty.snapshot()?.data?.items).toEqual([])
  } finally {
    clock.mockRestore()
    db.close()
  }
})

test("refresh replaces loaded pages atomically and serializes load more", async () => {
  const cache = new RepositoryCache(createCollections().repositoryResources)
  const second = deferred<{ items: { id: string }[]; hasMore: boolean }>()
  let started!: () => void
  const secondStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  let refreshing = false
  const pages = vi.fn(async (page: number) => {
    if (!refreshing) return { items: [{ id: page === 1 ? "old-a" : "old-b" }], hasMore: page === 1 }
    if (page === 1) return { items: [{ id: "new-a" }], hasMore: true }
    started()
    return second.promise
  })
  const resource = cache.paginated(catalogKey, pages, (item) => item.id)
  await resource.load()
  await resource.loadMore()
  refreshing = true
  const refresh = resource.load({ force: true })
  await secondStarted
  expect(resource.snapshot()?.data?.items.map((item) => item.id)).toEqual(["old-a", "old-b"])
  const more = resource.loadMore()
  expect(pages.mock.calls.map(([page]) => page)).toEqual([1, 2, 1, 2])
  second.resolve({ items: [{ id: "new-b" }], hasMore: false })
  await Promise.all([refresh, more])
  expect(resource.snapshot()?.data).toMatchObject({
    items: [{ id: "new-a" }, { id: "new-b" }],
    pages: 2,
    hasMore: false,
  })
  expect(pages).toHaveBeenCalledTimes(4)
})

test("failed range refresh keeps prior pages and a terminal refresh drops stale retry pages", async () => {
  const cache = new RepositoryCache(createCollections().repositoryResources)
  let phase = "initial"
  const calls: number[] = []
  const resource = cache.paginated(
    catalogKey,
    async (page) => {
      calls.push(page)
      if (phase === "initial") return { items: [{ id: String(page) }], hasMore: true }
      if (phase === "failed-more" && page === 3) throw new Error("page 3")
      if (phase === "failed-refresh" && page === 2) throw new Error("page 2")
      return { items: [{ id: "new" }], hasMore: false }
    },
    (item) => item.id,
  )
  await resource.load()
  await resource.loadMore()
  phase = "failed-more"
  await resource.loadMore()
  expect(resource.snapshot()?.data?.pages).toBe(2)
  phase = "failed-refresh"
  await resource.load({ force: true })
  // Page 1 is terminal in this phase, so the old page 2 is removed in one update.
  expect(resource.snapshot()?.data).toMatchObject({
    items: [{ id: "new" }],
    pages: 1,
    hasMore: false,
  })
  await resource.retry()
  expect(calls.at(-1)).toBe(1)
  expect(calls).not.toContain(4)
})

test("a failed refresh retains the complete old range", async () => {
  const cache = new RepositoryCache(createCollections().repositoryResources)
  let fail = false
  const resource = cache.paginated(
    catalogKey,
    async (page) => {
      if (fail && page === 2) throw new Error("offline")
      return { items: [{ id: String(page) }], hasMore: page === 1 }
    },
    (item) => item.id,
  )
  await resource.load()
  await resource.loadMore()
  fail = true
  await resource.load({ force: true })
  expect(resource.snapshot()?.data?.items.map((item) => item.id)).toEqual(["1", "2"])
  expect(resource.snapshot()?.error?.message).toBe("offline")
})

test("summary denial clears its repository and ignores a late path response", async () => {
  const db = tempDatabase()
  try {
    const rows = createCollections(db.open()).repositoryResources
    const cache = new RepositoryCache(rows, true)
    const summaryKey = {
      kind: "summary" as const,
      host: key.host,
      accountLogin: "Yi",
      owner: "acme",
      repo: "api",
    }
    let deny = false
    const summary = cache.resource(summaryKey, async () => {
      if (deny) throw new GitHubError(404, "missing")
      return { name: "api" }
    })
    const pendingPath = deferred<string>()
    let pathCalls = 0
    const path = cache.resource(key, () =>
      ++pathCalls === 1 ? Promise.resolve("old") : pendingPath.promise,
    )
    await Promise.all([summary.load(), path.load()])
    const refreshPath = path.load({ force: true })
    deny = true
    await summary.load({ force: true })
    expect(summary.snapshot()).toMatchObject({ loaded: false, error: expect.any(GitHubError) })
    expect(path.snapshot()).toBeUndefined()
    pendingPath.resolve("late")
    await refreshPath
    expect(rows.collection.size).toBe(0)
    const reopened = new RepositoryCache(createCollections(db.open()).repositoryResources, true)
    const offline = reopened.resource(key, async () => {
      throw new Error("offline")
    })
    await offline.load()
    expect(offline.snapshot()?.loaded).toBe(false)
  } finally {
    db.close()
  }
})

test("load-more permission denial hides the old catalog while rate limits retain it", async () => {
  const rows = createCollections().repositoryResources
  const cache = new RepositoryCache(rows)
  let failure: Error | undefined
  const resource = cache.paginated(
    catalogKey,
    async (page) => {
      if (page === 2 && failure) throw failure
      return { items: [{ id: "saved" }], hasMore: true }
    },
    (item) => item.id,
  )
  await resource.load()
  failure = new GitHubError(403, "secondary rate limit", undefined, true)
  await resource.loadMore()
  expect(resource.snapshot()).toMatchObject({ loaded: true, error: failure })
  failure = new GitHubError(403, "forbidden")
  await resource.retry()
  expect(resource.snapshot()).toMatchObject({ loaded: false, error: failure })
})

test("sign-out waits for an in-progress disk write and removes its late row", async () => {
  const db = tempDatabase()
  try {
    const rows = createCollections(db.open()).repositoryResources
    const write = rows.upsert
    const release = deferred<void>()
    let started!: () => void
    const writeStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    rows.upsert = async (values) => {
      started()
      await release.promise
      await write(values)
    }
    const cache = new RepositoryCache(rows, true)
    const resource = cache.resource(key, async () => "late")
    const loading = resource.load()
    await writeStarted
    const clearing = cache.clearAccount("yi")
    expect(resource.snapshot()?.loaded).toBe(false)
    release.resolve()
    await Promise.all([loading, clearing])
    expect(rows.collection.size).toBe(0)
    const reopened = new RepositoryCache(createCollections(db.open()).repositoryResources, true)
    const offline = reopened.resource(key, async () => {
      throw new Error("offline")
    })
    await offline.load()
    expect(offline.snapshot()?.loaded).toBe(false)
  } finally {
    db.close()
  }
})

test("sign-out ignores a late failure, and account keys remain isolated", async () => {
  const rows = createCollections().repositoryResources
  const cache = new RepositoryCache(rows)
  const alice = cache.resource(contentKey("file", "alice"), async () => "Alice")
  const bob = cache.resource(contentKey("file", "bob"), async () => "Bob")
  await alice.load()
  expect(bob.snapshot()?.loaded).toBe(false)
  await bob.load()
  expect(bob.snapshot()?.data).toBe("Bob")
  const late = deferred<string>()
  const started = deferred<void>()
  const pending = cache.resource(contentKey("pending", "alice"), () => {
    started.resolve(undefined)
    return late.promise
  })
  const loading = pending.load()
  await started.promise
  await cache.clearAccount("alice")
  late.reject(new GitHubError(403, "forbidden"))
  await loading
  expect(pending.snapshot()?.loaded).toBe(false)
  expect(pending.snapshot()?.error).toBeUndefined()
  expect(alice.snapshot()?.loaded).toBe(false)
  expect(bob.snapshot()).toMatchObject({ loaded: true, data: "Bob" })
})

test("signing back into the same account does not join its old request", async () => {
  const cache = new RepositoryCache(createCollections().repositoryResources)
  const oldRequest = deferred<string>()
  const oldStarted = deferred<void>()
  const oldHandle = cache.resource(key, () => {
    oldStarted.resolve(undefined)
    return oldRequest.promise
  })
  const oldLoad = oldHandle.load()
  await oldStarted.promise
  await cache.clearAccount("yi")

  const newRequest = deferred<string>()
  const newStarted = deferred<void>()
  const fetchNew = vi.fn(() => {
    newStarted.resolve(undefined)
    return newRequest.promise
  })
  const newHandle = cache.resource(key, fetchNew)
  const newLoad = newHandle.load()
  await newStarted.promise
  oldRequest.resolve("old")
  await oldLoad
  const joined = newHandle.load()
  newRequest.resolve("new")
  await Promise.all([newLoad, joined])
  expect(fetchNew).toHaveBeenCalledTimes(1)
  expect(newHandle.snapshot()).toMatchObject({ loaded: true, data: "new" })
})

test("a path 404 removes only that visited path and ref", async () => {
  const db = tempDatabase()
  try {
    const rows = createCollections(db.open()).repositoryResources
    const cache = new RepositoryCache(rows, true)
    let denied = false
    const missingKey = contentKey("src/missing.ts")
    const siblingKey = contentKey("src/kept.ts")
    const missing = cache.resource(missingKey, async () => {
      if (denied) throw new GitHubError(404, "missing")
      return "old"
    })
    const sibling = cache.resource(siblingKey, async () => "kept")
    await Promise.all([missing.load(), sibling.load()])
    denied = true
    await missing.load({ force: true })
    expect(missing.snapshot()).toMatchObject({ loaded: false, error: expect.any(GitHubError) })
    expect(rows.collection.has(repositoryResourceKey(missingKey))).toBe(false)
    expect(sibling.snapshot()).toMatchObject({ loaded: true, data: "kept", persisted: true })
    expect(rows.collection.has(repositoryResourceKey(siblingKey))).toBe(true)
  } finally {
    db.close()
  }
})

test("evicts inactive least-recently-used rows and reports unsaved oversized or failed writes", async () => {
  const db = tempDatabase()
  try {
    const rows = createCollections(db.open()).repositoryResources
    const cache = new RepositoryCache(rows, true, undefined, 22)
    const first = cache.resource(contentKey("a"), async () => "123456789")
    const second = cache.resource(contentKey("b"), async () => "123456789")
    const third = cache.resource(contentKey("c"), async () => "123456789")
    const unsubscribe = first.subscribe(() => {})
    await Promise.all([first.load(), second.load()])
    await third.load()
    expect(rows.collection.has(repositoryResourceKey(contentKey("a")))).toBe(true)
    expect(rows.collection.has(repositoryResourceKey(contentKey("b")))).toBe(false)
    expect(rows.collection.has(repositoryResourceKey(contentKey("c")))).toBe(true)
    expect(second.snapshot()).toMatchObject({ loaded: true, persisted: false })
    const protectedLarge = cache.resource(contentKey("protected"), async () => "x".repeat(13))
    await protectedLarge.load()
    expect(protectedLarge.snapshot()).toMatchObject({
      loaded: true,
      persisted: false,
      saveError: expect.any(Error),
    })
    expect(rows.collection.size).toBe(2)
    const oversized = cache.resource(contentKey("d"), async () => "x".repeat(30))
    await oversized.load()
    expect(oversized.snapshot()).toMatchObject({
      loaded: true,
      persisted: false,
      saveError: expect.any(Error),
    })
    expect(rows.collection.size).toBe(2)
    unsubscribe()

    const originalReplace = rows.replace
    rows.replace = async () => {
      throw new Error("disk full")
    }
    const failed = cache.resource(contentKey("e"), async () => "123456789")
    await failed.load()
    expect(failed.snapshot()).toMatchObject({
      loaded: true,
      persisted: false,
      saveError: expect.objectContaining({ message: "disk full" }),
    })
    rows.replace = originalReplace
    expect(rows.collection.size).toBe(2)
  } finally {
    db.close()
  }
})

test("waits for the core rate-limit reset before a network refresh", async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(0)
    const limits = new RateLimits()
    limits.update(
      new Headers({
        "X-RateLimit-Resource": "core",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": "2",
      }),
    )
    const fetcher = vi.fn(async () => "ready")
    const cache = new RepositoryCache(createCollections().repositoryResources, false, limits)
    const resource = cache.resource(key, fetcher)
    const loading = resource.load()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    await loading
    expect(fetcher).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

test("checks rate-limit state again between pages of a staged refresh", async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(1_000_000)
    const limits = new RateLimits()
    const cache = new RepositoryCache(createCollections().repositoryResources, false, limits)
    let refresh = false
    const firstPage = deferred<void>()
    const calls: number[] = []
    const resource = cache.paginated(
      catalogKey,
      async (page) => {
        calls.push(page)
        if (refresh && page === 1) {
          limits.update(
            new Headers({
              "X-RateLimit-Resource": "core",
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": "1002",
            }),
          )
          firstPage.resolve(undefined)
        }
        return { items: [{ id: `${refresh ? "new" : "old"}-${page}` }], hasMore: page === 1 }
      },
      (item) => item.id,
    )
    await resource.load()
    await resource.loadMore()
    refresh = true
    const loading = resource.load({ force: true })
    await firstPage.promise
    expect(resource.snapshot()?.data?.items.map((item) => item.id)).toEqual(["old-1", "old-2"])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toEqual([1, 2, 1])
    await vi.advanceTimersByTimeAsync(1_000)
    await loading
    expect(calls).toEqual([1, 2, 1, 2])
    expect(resource.snapshot()?.data?.items.map((item) => item.id)).toEqual(["new-1", "new-2"])
  } finally {
    vi.useRealTimers()
  }
})
