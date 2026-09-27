import type { SyncedCollection } from "./collections/synced"
import type { RateLimits } from "./github/rate-limit"
import { GitHubError } from "./github/rest"

export type RepositoryResourceKey =
  | {
      kind: "catalog"
      host: string
      accountLogin: string
      scope: { kind: "org"; org: string } | { kind: "team"; org: string; slug: string }
      page: number
      pageSize: number
      query?: string
    }
  | { kind: "summary"; host: string; accountLogin: string; owner: string; repo: string }
  | {
      kind: "branches"
      host: string
      accountLogin: string
      owner: string
      repo: string
      page: number
      pageSize: number
    }
  | {
      kind: "releases"
      host: string
      accountLogin: string
      owner: string
      repo: string
      page: number
      pageSize: number
    }
  | {
      kind: "contents"
      host: string
      accountLogin: string
      owner: string
      repo: string
      ref: string
      path: string
    }
  | { kind: "readme"; host: string; accountLogin: string; owner: string; repo: string; ref: string }
  | {
      kind: "pulls"
      host: string
      accountLogin: string
      owner: string
      repo: string
      page: number
      pageSize: number
      query?: string
    }

export interface RepositoryResourceRow {
  key: string
  accountLogin: string
  kind: RepositoryResourceKey["kind"]
  identity: string
  data: unknown
  fetchedAt: number
  lastAccessedAt: number
  payloadBytes: number
}

export interface RepositoryResourceSnapshot<T> {
  key: RepositoryResourceKey
  kind: RepositoryResourceKey["kind"]
  data?: T
  fetchedAt: number
  lastAccessedAt: number
  loaded: boolean
  refreshing: boolean
  persisted: boolean
  error?: Error
  saveError?: Error
}

export interface RepositoryResourceHandle<T> {
  snapshot(): RepositoryResourceSnapshot<T> | undefined
  subscribe(listener: () => void): () => void
  load(options?: { force?: boolean }): Promise<void>
  retry(): Promise<void>
}

const FRESH_MS = 60_000
const ACCOUNT_BUDGET = 100 * 1024 * 1024
export interface RepositoryPage<T> {
  items: T[]
  hasMore: boolean
}
export interface RepositoryPages<T> {
  items: T[]
  hasMore: boolean
  pages: number
  pageData: RepositoryPage<T>[]
}
export interface PaginatedResourceHandle<T> extends RepositoryResourceHandle<RepositoryPages<T>> {
  loadMore(): Promise<void>
}

interface RequestToken {
  account: string
  accountGeneration: number
  globalGeneration: number
  repository: string
  repositoryGeneration: number
  resource: string
  resourceGeneration: number
}

/** Typed, account-isolated cache for repository reads. Successful empty values are cached. */
export class RepositoryCache {
  private readonly rows: SyncedCollection<RepositoryResourceRow, string>
  private readonly memory = new Map<string, RepositoryResourceSnapshot<unknown>>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly pageInFlight = new Map<string, Promise<void>>()
  private readonly failedMorePages = new Map<string, number>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly active = new Map<string, number>()
  private readonly generations = new Map<string, number>()
  private globalGeneration = 0
  private readonly repoGenerations = new Map<string, number>()
  private readonly resourceGenerations = new Map<string, number>()
  private readonly clearingAccounts = new Set<string>()
  private clearingAll = false
  private retryAfterUntil = 0
  private persistQueue: Promise<void> = Promise.resolve()
  private hydrated?: Promise<void>
  private accessQueue = new Set<string>()
  private accessTimer?: ReturnType<typeof setTimeout>
  private readonly canPersist: boolean
  private readonly rateLimits?: RateLimits
  private readonly budgetBytes: number

  constructor(
    rows: SyncedCollection<RepositoryResourceRow, string>,
    canPersist = false,
    rateLimits?: RateLimits,
    budgetBytes = ACCOUNT_BUDGET,
  ) {
    this.rows = rows
    this.canPersist = canPersist
    this.rateLimits = rateLimits
    this.budgetBytes = budgetBytes
  }

  resource<T>(key: RepositoryResourceKey, fetcher: () => Promise<T>): RepositoryResourceHandle<T> {
    const id = resourceKey(key)
    if (!this.memory.has(id))
      this.memory.set(id, {
        key,
        kind: key.kind,
        loaded: false,
        refreshing: false,
        persisted: false,
        fetchedAt: 0,
        lastAccessedAt: 0,
      })
    return {
      snapshot: () => this.memory.get(id) as RepositoryResourceSnapshot<T>,
      subscribe: (listener) => {
        let set = this.listeners.get(id)
        if (!set) {
          set = new Set()
          this.listeners.set(id, set)
        }
        set.add(listener)
        this.active.set(id, (this.active.get(id) ?? 0) + 1)
        void this.hydrate().then(() => this.emit(id))
        return () => {
          set?.delete(listener)
          if (!set?.size) this.listeners.delete(id)
          const count = (this.active.get(id) ?? 1) - 1
          if (count <= 0) this.active.delete(id)
          else this.active.set(id, count)
        }
      },
      load: (options) => this.loadResource<T>(key, fetcher, options?.force ?? false),
      retry: () => this.loadResource<T>(key, fetcher, true),
    }
  }

  paginated<T>(
    key: Extract<RepositoryResourceKey, { kind: "catalog" | "branches" | "pulls" | "releases" }>,
    fetchPage: (page: number) => Promise<RepositoryPage<T>>,
    getId: (item: T) => string | number,
  ): PaginatedResourceHandle<T> {
    const firstKey = { ...key, page: 1 } as RepositoryResourceKey
    const runRange = async (): Promise<RepositoryPages<T>> => {
      const previous = this.memory.get(resourceKey(firstKey)) as
        | RepositoryResourceSnapshot<RepositoryPages<T>>
        | undefined
      const pageCount = Math.max(1, previous?.data?.pages ?? 1)
      const pages: RepositoryPage<T>[] = []
      for (let page = 1; page <= pageCount; page++) {
        await this.waitForRateLimit()
        const result = await fetchPage(page)
        pages.push(result)
        if (!result.hasMore) break
      }
      return aggregatePages(pages, getId)
    }
    const handle = this.resource(firstKey, runRange)
    const loadMore = async () => {
      const id = resourceKey(firstKey)
      const pending = this.pageInFlight.get(id)
      if (pending) return pending
      const token = this.token(firstKey)
      let request!: Promise<void>
      request = (async () => {
        try {
          await this.hydrate()
          const refresh = this.inFlight.get(id)
          if (refresh) await refresh
          if (!this.isCurrent(token)) return
          const snapshot = handle.snapshot()
          if (!snapshot?.data?.hasMore) return
          const nextPage = snapshot.data.pages + 1
          this.memory.set(id, { ...snapshot, refreshing: true, error: undefined })
          this.emit(id)
          await this.waitForRateLimit()
          if (!this.isCurrent(token)) return
          const page = await fetchPage(nextPage)
          if (!this.isCurrent(token)) return
          const current = handle.snapshot()
          if (!current?.data?.hasMore || current.data.pages !== nextPage - 1) return
          const data = aggregatePages([...current.data.pageData, page], getId)
          this.failedMorePages.delete(id)
          await this.saveResult(id, firstKey, data, token)
        } catch (error) {
          if (!this.isCurrent(token)) return
          this.failedMorePages.set(id, (handle.snapshot()?.data?.pages ?? 0) + 1)
          await this.handleFailure(firstKey, error)
        } finally {
          if (this.pageInFlight.get(id) === request) this.pageInFlight.delete(id)
        }
      })()
      this.pageInFlight.set(id, request)
      return request
    }
    return {
      ...handle,
      loadMore,
      retry: async () => {
        const snapshot = handle.snapshot()
        if (
          this.failedMorePages.get(resourceKey(firstKey)) === (snapshot?.data?.pages ?? 0) + 1 &&
          snapshot?.error &&
          snapshot.data?.hasMore
        )
          await loadMore()
        else await handle.load({ force: true })
      },
    }
  }

  /** Invalidates before waiting on persistence so stale requests cannot restore signed-out data. */
  async clearAccount(accountLogin: string): Promise<void> {
    const account = normalizeAccount(accountLogin)
    this.clearingAccounts.add(account)
    this.generations.set(account, (this.generations.get(account) ?? 0) + 1)
    for (const id of this.inFlight.keys())
      if (resourceIdAccount(id) === account) this.inFlight.delete(id)
    for (const id of this.pageInFlight.keys())
      if (resourceIdAccount(id) === account) this.pageInFlight.delete(id)
    for (const id of this.failedMorePages.keys())
      if (resourceIdAccount(id) === account) this.failedMorePages.delete(id)
    for (const [id, snapshot] of this.memory)
      if (normalizeAccount(snapshot.key.accountLogin) === account) {
        this.memory.set(id, {
          key: snapshot.key,
          kind: snapshot.kind,
          loaded: false,
          refreshing: false,
          persisted: false,
          fetchedAt: 0,
          lastAccessedAt: Date.now(),
        })
        this.emit(id)
      }
    try {
      await this.hydrate()
      await this.persistQueue
      const keys = [...this.rows.collection.values()]
        .filter((row) => normalizeAccount(row.accountLogin) === account)
        .map((row) => row.key)
      if (keys.length) await this.rows.remove(keys)
      for (const id of this.accessQueue)
        if (resourceIdAccount(id) === account) this.accessQueue.delete(id)
    } finally {
      this.clearingAccounts.delete(account)
    }
  }

  async clearAll(): Promise<void> {
    this.clearingAll = true
    this.globalGeneration++
    this.inFlight.clear()
    this.pageInFlight.clear()
    this.failedMorePages.clear()
    for (const [id, snapshot] of this.memory) {
      this.memory.set(id, {
        key: snapshot.key,
        kind: snapshot.kind,
        loaded: false,
        refreshing: false,
        persisted: false,
        fetchedAt: 0,
        lastAccessedAt: Date.now(),
      })
      this.emit(id)
    }
    try {
      await this.hydrate()
      await this.persistQueue
      const accounts = new Set(
        [...this.rows.collection.values()].map((row) => normalizeAccount(row.accountLogin)),
      )
      for (const snapshot of this.memory.values())
        accounts.add(normalizeAccount(snapshot.key.accountLogin))
      await Promise.all([...accounts].map((account) => this.clearAccount(account)))
    } finally {
      this.clearingAll = false
    }
  }

  private async loadResource<T>(
    key: RepositoryResourceKey,
    fetcher: () => Promise<T>,
    force: boolean,
  ): Promise<void> {
    const token = this.token(key)
    await this.hydrate()
    if (!this.isCurrent(token)) return
    const id = resourceKey(key)
    const more = this.pageInFlight.get(id)
    if (more) await more
    if (!this.isCurrent(token)) return
    const existing = this.memory.get(id) as RepositoryResourceSnapshot<T> | undefined
    const now = Date.now()
    if (existing) {
      this.memory.set(id, { ...existing, lastAccessedAt: now })
      this.queueAccess(id)
      if (!force && existing.loaded && now - existing.fetchedAt < FRESH_MS) return
    }
    const pending = this.inFlight.get(id)
    if (pending) return pending
    this.failedMorePages.delete(id)
    if (existing) {
      this.memory.set(id, { ...existing, lastAccessedAt: now, refreshing: true, error: undefined })
      this.emit(id)
    }
    let request!: Promise<void>
    request = (async () => {
      try {
        await this.waitForRateLimit()
        if (!this.isCurrent(token)) return
        const data = await fetcher()
        if (!this.isCurrent(token)) return
        await this.saveResult(id, key, data, token)
      } catch (error) {
        if (this.isCurrent(token)) await this.handleFailure(key, error)
      } finally {
        if (this.inFlight.get(id) === request) this.inFlight.delete(id)
      }
    })()
    this.inFlight.set(id, request)
    return request
  }

  private async saveResult<T>(
    id: string,
    key: RepositoryResourceKey,
    data: T,
    token: RequestToken,
  ): Promise<void> {
    const now = Date.now()
    const snapshot: RepositoryResourceSnapshot<T> = {
      key,
      kind: key.kind,
      data,
      fetchedAt: now,
      lastAccessedAt: now,
      loaded: true,
      refreshing: false,
      persisted: false,
    }
    this.memory.set(id, snapshot)
    this.emit(id)
    const payloadBytes = new TextEncoder().encode(JSON.stringify(data)).byteLength
    await this.persistWithinBudget(id, key, data, snapshot, payloadBytes, token)
  }

  private async handleFailure(key: RepositoryResourceKey, error: unknown): Promise<void> {
    const id = resourceKey(key)
    if (error instanceof GitHubError && error.rateLimited)
      this.retryAfterUntil = Math.max(this.retryAfterUntil, Date.now() + error.retryAfterMs)
    if (isAccessDenied(error)) {
      if (key.kind === "summary") {
        const repository = repositoryGenerationKey(key)
        this.repoGenerations.set(repository, (this.repoGenerations.get(repository) ?? 0) + 1)
        try {
          await this.invalidateRepository(key, asError(error))
        } catch (saveError) {
          this.setRemovalError(id, saveError)
        }
      } else {
        this.resourceGenerations.set(id, (this.resourceGenerations.get(id) ?? 0) + 1)
        this.memory.set(id, {
          key,
          kind: key.kind,
          loaded: false,
          refreshing: false,
          persisted: false,
          fetchedAt: 0,
          lastAccessedAt: Date.now(),
          error: asError(error),
        })
        this.emit(id)
        try {
          await this.enqueuePersist(async () => {
            if (this.rows.collection.has(id)) await this.rows.remove([id])
          })
        } catch (saveError) {
          this.setRemovalError(id, saveError)
        }
      }
    } else {
      const current = this.memory.get(id)
      this.memory.set(id, {
        ...(current ?? {
          key,
          kind: key.kind,
          fetchedAt: 0,
          lastAccessedAt: Date.now(),
          loaded: false,
          persisted: false,
        }),
        refreshing: false,
        error: asError(error),
      })
    }
    this.emit(id)
  }

  private setRemovalError(id: string, error: unknown): void {
    const current = this.memory.get(id)
    if (current) this.memory.set(id, { ...current, saveError: asError(error) })
    this.emit(id)
  }

  private token(key: RepositoryResourceKey): RequestToken {
    const account = normalizeAccount(key.accountLogin)
    const repository = repositoryGenerationKey(key)
    const resource = resourceKey(key)
    return {
      account,
      accountGeneration: this.generations.get(account) ?? 0,
      globalGeneration: this.globalGeneration,
      repository,
      repositoryGeneration: this.repoGenerations.get(repository) ?? 0,
      resource,
      resourceGeneration: this.resourceGenerations.get(resource) ?? 0,
    }
  }

  private isCurrent(token: RequestToken): boolean {
    return (
      !this.clearingAll &&
      !this.clearingAccounts.has(token.account) &&
      this.globalGeneration === token.globalGeneration &&
      (this.generations.get(token.account) ?? 0) === token.accountGeneration &&
      (this.repoGenerations.get(token.repository) ?? 0) === token.repositoryGeneration &&
      (this.resourceGenerations.get(token.resource) ?? 0) === token.resourceGeneration
    )
  }

  private async waitForRateLimit(): Promise<void> {
    while (true) {
      const wait = Math.max(
        this.rateLimits?.waitMs("core", 0) ?? 0,
        this.retryAfterUntil - Date.now(),
      )
      if (wait <= 0) return
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(wait, 2_147_483_647)))
    }
  }

  private async hydrate(): Promise<void> {
    if (!this.hydrated)
      this.hydrated = (async () => {
        await this.rows.collection.preload()
        for (const row of this.rows.collection.values()) {
          if (this.clearingAll || this.clearingAccounts.has(normalizeAccount(row.accountLogin)))
            continue
          const key = parseKey(row.identity)
          if (!key || resourceKey(key) !== row.key) continue
          if (this.memory.get(row.key)?.loaded) continue
          this.memory.set(row.key, {
            key,
            kind: row.kind,
            data: row.data,
            fetchedAt: row.fetchedAt,
            lastAccessedAt: row.lastAccessedAt,
            loaded: true,
            refreshing: false,
            persisted: true,
          })
        }
      })().catch((error) => {
        this.hydrated = undefined
        for (const id of this.listeners.keys()) {
          const current = this.memory.get(id)
          if (current) this.memory.set(id, { ...current, saveError: asError(error) })
          this.emit(id)
        }
      })
    return this.hydrated
  }

  private async persistWithinBudget<T>(
    id: string,
    key: RepositoryResourceKey,
    data: T,
    snapshot: RepositoryResourceSnapshot<T>,
    payloadBytes: number,
    token: RequestToken,
  ): Promise<void> {
    if (!this.canPersist) {
      this.setPersistenceState(
        id,
        snapshot,
        false,
        new Error("Persistent local storage is unavailable on this platform."),
      )
      return
    }
    const account = normalizeAccount(key.accountLogin)
    const write = async () => {
      if (!this.isCurrent(token)) return
      const rows = [...this.rows.collection.values()].filter(
        (row) => normalizeAccount(row.accountLogin) === account && row.key !== id,
      )
      let used = rows.reduce((sum, row) => sum + row.payloadBytes, 0)
      const candidates = rows
        .filter((row) => !this.active.has(row.key))
        .sort(
          (a, b) =>
            (this.memory.get(a.key)?.lastAccessedAt ?? a.lastAccessedAt) -
            (this.memory.get(b.key)?.lastAccessedAt ?? b.lastAccessedAt),
        )
      const evict: string[] = []
      for (const row of candidates) {
        if (used + payloadBytes <= this.budgetBytes) break
        used -= row.payloadBytes
        evict.push(row.key)
      }
      if (payloadBytes > this.budgetBytes || used + payloadBytes > this.budgetBytes) {
        this.setPersistenceState(
          id,
          snapshot,
          false,
          new Error(
            "This resource is available now but could not be saved for offline use because the local cache is full.",
          ),
        )
        return
      }
      try {
        const row = {
          key: id,
          accountLogin: key.accountLogin,
          kind: key.kind,
          identity: JSON.stringify(key),
          data,
          fetchedAt: snapshot.fetchedAt,
          lastAccessedAt: snapshot.lastAccessedAt,
          payloadBytes,
        }
        if (evict.length) {
          const removed = new Set(evict)
          await this.rows.replace(
            [...rows.filter((old) => !removed.has(old.key)), row],
            (old) => normalizeAccount(old.accountLogin) === account,
          )
        } else await this.rows.upsert([row])
        if (!this.isCurrent(token)) return
        this.setPersistenceState(id, snapshot, true)
        for (const evictedId of evict) {
          const evicted = this.memory.get(evictedId)
          if (evicted)
            this.memory.set(evictedId, {
              ...evicted,
              persisted: false,
              saveError: new Error("Removed from offline storage to make room."),
            })
          this.emit(evictedId)
        }
      } catch (error) {
        this.setPersistenceState(id, snapshot, false, asError(error))
      }
    }
    await this.enqueuePersist(write)
  }

  private setPersistenceState<T>(
    id: string,
    snapshot: RepositoryResourceSnapshot<T>,
    persisted: boolean,
    saveError?: Error,
  ): void {
    const current = this.memory.get(id)
    if (
      !current?.loaded ||
      current.fetchedAt !== snapshot.fetchedAt ||
      current.data !== snapshot.data
    )
      return
    this.memory.set(id, { ...current, persisted, saveError })
    this.emit(id)
  }

  private async enqueuePersist(write: () => Promise<void>): Promise<void> {
    const next = this.persistQueue.then(write)
    this.persistQueue = next.catch(() => undefined)
    await next
  }

  private async invalidateRepository(
    key: Extract<RepositoryResourceKey, { kind: "summary" }>,
    error: Error,
  ): Promise<void> {
    const sameRepo = (candidate: RepositoryResourceKey) =>
      "owner" in candidate &&
      candidate.host === key.host &&
      normalizeAccount(candidate.accountLogin) === normalizeAccount(key.accountLogin) &&
      candidate.owner.toLowerCase() === key.owner.toLowerCase() &&
      candidate.repo.toLowerCase() === key.repo.toLowerCase()
    const ids = new Set([...this.memory].filter(([, s]) => sameRepo(s.key)).map(([id]) => id))
    for (const id of ids) {
      this.memory.delete(id)
      this.emit(id)
    }
    const id = resourceKey(key)
    this.memory.set(id, {
      key,
      kind: key.kind,
      loaded: false,
      refreshing: false,
      persisted: false,
      fetchedAt: 0,
      lastAccessedAt: Date.now(),
      error,
    })
    this.emit(id)
    await this.enqueuePersist(async () => {
      const keys = [...this.rows.collection.values()]
        .filter((row) => {
          const parsed = parseKey(row.identity)
          return parsed && sameRepo(parsed)
        })
        .map((row) => row.key)
      if (keys.length) await this.rows.remove(keys)
    })
  }
  private emit(id: string): void {
    for (const listener of this.listeners.get(id) ?? []) listener()
  }
  private queueAccess(id: string): void {
    this.accessQueue.add(id)
    if (this.accessTimer) return
    this.accessTimer = setTimeout(() => {
      this.accessTimer = undefined
      const keys = [...this.accessQueue]
      this.accessQueue.clear()
      void this.enqueuePersist(async () => {
        for (const id of keys) {
          const row = this.rows.collection.get(id)
          const snapshot = this.memory.get(id)
          if (
            !row ||
            !snapshot?.loaded ||
            !snapshot.persisted ||
            row.fetchedAt !== snapshot.fetchedAt
          )
            continue
          try {
            await this.rows.upsert([
              { ...row, lastAccessedAt: Math.max(row.lastAccessedAt, snapshot.lastAccessedAt) },
            ])
          } catch {
            /* Access times are best effort. */
          }
        }
      })
    }, 1000)
  }
}

export function repositoryResourceKey(key: RepositoryResourceKey): string {
  return resourceKey(key)
}
function resourceKey(key: RepositoryResourceKey): string {
  // JSON tuple keeps keys inspectable and preserves every scope dimension.
  switch (key.kind) {
    case "catalog":
      return JSON.stringify([
        key.host,
        normalizeAccount(key.accountLogin),
        key.kind,
        key.scope.kind,
        key.scope.org.toLowerCase(),
        key.scope.kind === "team" ? key.scope.slug.toLowerCase() : null,
        key.page,
        key.pageSize,
        key.query ?? null,
      ])
    case "summary":
      return JSON.stringify([
        key.host,
        normalizeAccount(key.accountLogin),
        key.kind,
        key.owner.toLowerCase(),
        key.repo.toLowerCase(),
      ])
    case "branches":
      return JSON.stringify([
        key.host,
        normalizeAccount(key.accountLogin),
        key.kind,
        key.owner.toLowerCase(),
        key.repo.toLowerCase(),
        key.page,
        key.pageSize,
      ])
    case "releases":
      return JSON.stringify([
        key.host,
        normalizeAccount(key.accountLogin),
        key.kind,
        key.owner.toLowerCase(),
        key.repo.toLowerCase(),
        key.page,
        key.pageSize,
      ])
    case "contents":
      return JSON.stringify([
        key.host,
        normalizeAccount(key.accountLogin),
        key.kind,
        key.owner.toLowerCase(),
        key.repo.toLowerCase(),
        key.ref,
        key.path,
      ])
    case "readme":
      return JSON.stringify([
        key.host,
        normalizeAccount(key.accountLogin),
        key.kind,
        key.owner.toLowerCase(),
        key.repo.toLowerCase(),
        key.ref,
      ])
    case "pulls":
      return JSON.stringify([
        key.host,
        normalizeAccount(key.accountLogin),
        key.kind,
        key.owner.toLowerCase(),
        key.repo.toLowerCase(),
        key.page,
        key.pageSize,
        key.query ?? null,
      ])
  }
}
function parseKey(identity: string): RepositoryResourceKey | undefined {
  try {
    return JSON.parse(identity) as RepositoryResourceKey
  } catch {
    return undefined
  }
}
function normalizeAccount(account: string): string {
  return account.trim().toLowerCase()
}
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
function isAccessDenied(error: unknown): boolean {
  return (
    error instanceof GitHubError &&
    (error.status === 401 || error.status === 404 || (error.status === 403 && !error.rateLimited))
  )
}
function repositoryGenerationKey(key: RepositoryResourceKey): string {
  return "owner" in key
    ? JSON.stringify([
        key.host,
        normalizeAccount(key.accountLogin),
        key.owner.toLowerCase(),
        key.repo.toLowerCase(),
      ])
    : ""
}
function resourceIdAccount(id: string): string {
  try {
    return normalizeAccount(JSON.parse(id)[1])
  } catch {
    return ""
  }
}
function aggregatePages<T>(
  pages: RepositoryPage<T>[],
  getId: (item: T) => string | number,
): RepositoryPages<T> {
  const seen = new Set<string | number>()
  const items = pages
    .flatMap((page) => page.items)
    .filter((item) => {
      const id = getId(item)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  return { items, hasMore: pages.at(-1)?.hasMore ?? false, pages: pages.length, pageData: pages }
}
