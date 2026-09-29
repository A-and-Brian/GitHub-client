import type { CanonicalPullRequest, CanonicalRepository, ScopedRow } from "../domain/types"
import type {
  ContentEntry,
  RepositoryContents,
  RepositoryRelease,
  RepositoryReleaseAsset,
  RepositorySummary,
} from "../repositories"
import {
  type RepositoryResourceKey,
  type RepositoryResourceRow,
  repositoryResourceKey,
} from "../repository-cache"
import {
  ensureRepositories,
  ensureRepository,
  type RepositoryInput,
  readActor,
  readRepository,
} from "./identities"
import type { NormalizedDatabase } from "./normalized"
import {
  type CanonicalPullInput,
  ingestPullRequest,
  type PullCollections,
  readPullSummary,
} from "./pulls"
import type { SyncedCollection } from "./synced"

type PageItem = RepositorySummary | { name: string } | RepositoryRelease | PullSummary
type PullSummary = {
  inboxObservedAt?: string
  node_id?: string
  number: number
  title: string
  draft: boolean
  user?: { login?: string; node_id?: string; avatar_url?: string } | null
  html_url?: string
  created_at?: string
  updated_at?: string
  head?: { ref?: string; sha?: string }
  base?: { ref?: string }
  requested_reviewers?: { login: string; node_id?: string }[]
  requested_teams?: { slug: string; node_id?: string }[]
  labels?: { node_id?: string; name: string; color: string }[]
}

interface ResourceMembership extends ScopedRow {
  accountLogin: string
  kind: RepositoryResourceKey["kind"]
  identity: string
  complete: boolean
  fetchedAt: number
  lastAccessedAt: number
  payloadBytes: number
  shape?: "null" | "directory" | "file" | "readme"
  limited?: boolean
  reason?: string
}

export interface RepositoryResourceCollection
  extends SyncedCollection<RepositoryResourceRow, string> {
  /** Serialized normalized rows reachable from resource memberships, counted once per entity. */
  storageBytes(excludedResourceKeys?: ReadonlySet<string>): number
  /** Updates only active, complete memberships still owned by the same observation. */
  touchAccess(
    updates: readonly { key: string; fetchedAt: number; lastAccessedAt: number }[],
  ): Promise<void>
}

interface ResourcePage extends ScopedRow {
  resourceKey: string
  page: number
  hasMore: boolean
  observedAt?: string
}

interface ResourceItem extends ScopedRow {
  resourceKey: string
  page: number
  position: number
  entityKey: string
}

interface ReleaseRow extends ScopedRow {
  repositoryId: string
  id: number
  name: string | null
  tagName: string
  body: string | null
  draft: boolean
  prerelease: boolean
  publishedAt: string | null
  htmlUrl: string
}

interface ReleaseAssetRow extends ScopedRow, RepositoryReleaseAsset {
  releaseId: string
  position: number
}

interface BranchRow extends ScopedRow {
  repositoryId: string
  name: string
}

interface ContentRow extends ScopedRow, ContentEntry {
  repositoryId: string
  ref: string
  text?: string | null
  renderedHtml?: string | null
}

/**
 * Resource DTOs remain reactive views. Persistent resource rows contain only
 * cache metadata; ordered page and item relations point at canonical entities.
 */
export function createResourceCollection(
  db: NormalizedDatabase,
  pullDomain: PullCollections,
): RepositoryResourceCollection {
  const memberships = db.table<ResourceMembership>("repositoryResourceMemberships")
  const pages = db.table<ResourcePage>("repositoryResourcePages")
  const items = db.table<ResourceItem>("repositoryResourceItems")
  const releases = db.table<ReleaseRow>("repositoryReleases")
  const assets = db.table<ReleaseAssetRow>("repositoryReleaseAssets")
  const branches = db.table<BranchRow>("repositoryBranches")
  const contents = db.table<ContentRow>("repositoryContents")

  const collection = db.projection<RepositoryResourceRow, string>(
    "repository-resources",
    (row) => row.key,
    () =>
      db.rows(memberships).flatMap((membership) => {
        if (!membership.complete) return []
        const key = parseKey(membership.identity)
        if (!key) return []
        const orderedPages = readPages(db, pages, items, membership.key)
        const data = materialize(db, pullDomain, membership, key, orderedPages, items)
        return data === MISSING
          ? []
          : [
              {
                key: membership.key,
                accountLogin: membership.accountLogin,
                kind: membership.kind,
                identity: membership.identity,
                data,
                fetchedAt: membership.fetchedAt,
                lastAccessedAt: membership.lastAccessedAt,
                payloadBytes: membership.payloadBytes,
              },
            ]
      }),
    async (rows) => {
      const activeScopeRows = rows.filter((row) => isActiveScope(db, row))
      if (activeScopeRows.length !== rows.length)
        throw new Error("Repository resource account does not match the active database scope.")
      for (const row of activeScopeRows) {
        const key = parseKey(row.identity)
        if (!key || repositoryResourceKey(key) !== row.key) continue
        await writeResource(
          db,
          pullDomain,
          key,
          row,
          memberships,
          pages,
          items,
          releases,
          assets,
          branches,
          contents,
        )
      }
    },
    async (keys) => {
      await removeResources(db, keys, memberships, pages, items)
      await pruneOwnedRows(db, memberships, items, releases, assets, branches, contents)
    },
    { trackWrites: false },
  )
  const assertScope = (rows: RepositoryResourceRow[]) => {
    if (rows.some((row) => !isActiveScope(db, row)))
      throw new Error("Repository resource account does not match the active database scope.")
  }
  return {
    ...collection,
    async upsert(rows) {
      assertScope(rows)
      await collection.upsert(rows)
    },
    async replace(rows, scope) {
      assertScope(rows)
      await collection.replace(rows, scope)
    },
    async touchAccess(updates) {
      if (!updates.length) return
      const requested = new Map(updates.map((update) => [update.key, update]))
      await db.mutate(async () => {
        const touched = db.rows(memberships).flatMap((membership) => {
          const update = requested.get(membership.key)
          if (
            !update ||
            membership.scope !== db.scope ||
            !membership.complete ||
            membership.fetchedAt !== update.fetchedAt
          )
            return []
          const lastAccessedAt = Math.max(membership.lastAccessedAt, update.lastAccessedAt)
          return lastAccessedAt === membership.lastAccessedAt
            ? []
            : [{ ...membership, lastAccessedAt }]
        })
        if (touched.length) await memberships.upsert(touched)
      })
    },
    storageBytes(excludedResourceKeys: ReadonlySet<string> = new Set()): number {
      const keptMemberships = db
        .rows(memberships)
        .filter((row) => !excludedResourceKeys.has(row.key))
      const keptKeys = new Set(keptMemberships.map((row) => row.key))
      const keptPages = db.rows(pages).filter((row) => keptKeys.has(row.resourceKey))
      const keptItems = db.rows(items).filter((row) => keptKeys.has(row.resourceKey))
      const referenced = new Set(keptItems.map((row) => row.entityKey))
      const liveReleases = new Set(
        db
          .rows(releases)
          .filter((row) => referenced.has(row.key))
          .map((row) => row.key),
      )
      const tables = [
        keptMemberships.map(({ payloadBytes: _payloadBytes, ...row }) => row),
        keptPages,
        keptItems,
        db
          .rows(db.table<CanonicalRepository>("repositories"))
          .filter((row) => referenced.has(row.key)),
        db
          .rows(db.table<CanonicalPullRequest>("pullRequests"))
          .filter((row) => referenced.has(row.key)),
        db.rows(releases).filter((row) => liveReleases.has(row.key)),
        db.rows(assets).filter((row) => liveReleases.has(row.releaseId)),
        db.rows(branches).filter((row) => referenced.has(row.key)),
        db.rows(contents).filter((row) => referenced.has(row.key)),
      ]
      return tables.flat().reduce((size, row) => size + byteSize(row), 0)
    },
  }
}

const MISSING = Symbol("missing-resource")

interface PageItems {
  page: number
  ids: string[]
  hasMore: boolean
  observedAt?: string
}

function materialize(
  db: NormalizedDatabase,
  pullDomain: PullCollections,
  membership: ResourceMembership,
  key: RepositoryResourceKey,
  pages: PageItems[],
  items: SyncedCollection<ResourceItem, string>,
): unknown | typeof MISSING {
  if (["catalog", "pulls", "branches", "releases", "summary"].includes(key.kind) && !pages.length)
    return MISSING
  if (key.kind === "summary") {
    const id = pages[0]?.ids[0]
    const repository = id ? readRepository(db, id) : undefined
    return repository ? toSummary(db, repository) : MISSING
  }
  if (key.kind === "catalog")
    return pageResult(pages, (id) => {
      const repository = readRepository(db, id)
      return repository ? toSummary(db, repository) : undefined
    })
  if (key.kind === "pulls")
    return pageResult(pages, (id, page) => {
      if (!pullDomain.canonical.pullRequests.collection.has(id)) return undefined
      const pull = readPullSummary(db, id)
      return pull ? { ...pull, inboxObservedAt: pages[page]?.observedAt } : undefined
    })
  if (key.kind === "branches")
    return pageResult(pages, (id) => {
      const branch = db
        .rows(db.table<BranchRow>("repositoryBranches"))
        .find((row) => row.key === id)
      return branch ? { name: branch.name } : undefined
    })
  if (key.kind === "releases")
    return pageResult(pages, (id) => {
      const release = db
        .rows(db.table<ReleaseRow>("repositoryReleases"))
        .find((row) => row.key === id)
      if (!release) return undefined
      const orderedAssets = db
        .rows(db.table<ReleaseAssetRow>("repositoryReleaseAssets"))
        .filter((asset) => asset.releaseId === release.key)
        .sort((a, b) => a.position - b.position)
        .map(({ id, name, size, downloadUrl }) => ({ id, name, size, downloadUrl }))
      return {
        id: release.id,
        name: release.name,
        tagName: release.tagName,
        body: release.body,
        draft: release.draft,
        prerelease: release.prerelease,
        publishedAt: release.publishedAt,
        htmlUrl: release.htmlUrl,
        assets: orderedAssets,
      }
    })
  if (key.kind === "contents") {
    const resourceItems = db
      .rows(items)
      .filter((item) => item.resourceKey === membership.key)
      .sort((a, b) => a.position - b.position)
    const entries = db.rows(db.table<ContentRow>("repositoryContents"))
    if (membership.shape === "directory") {
      const directory = resourceItems.flatMap(({ entityKey }) => {
        const entry = entries.find((row) => row.key === entityKey)
        return entry ? [entryDto(entry)] : []
      })
      if (directory.length !== resourceItems.length) return MISSING
      return {
        kind: "directory",
        entries: directory,
        limited: membership.limited ?? false,
      } satisfies RepositoryContents
    }
    if (membership.shape === "file") {
      const entityKey = resourceItems[0]?.entityKey
      const entry = entries.find((row) => row.key === entityKey)
      return entry
        ? {
            kind: "file",
            entry: entryDto(entry),
            text: entry.text ?? null,
            ...(membership.reason ? { reason: membership.reason } : {}),
          }
        : MISSING
    }
    return MISSING
  }
  if (membership.shape === "null") return null
  const readmeItem = db.rows(items).find((item) => item.resourceKey === membership.key)
  const readme =
    readmeItem &&
    db
      .rows(db.table<ContentRow>("repositoryContents"))
      .find((row) => row.key === readmeItem.entityKey)
  return readme?.renderedHtml != null ? { html: readme.renderedHtml, path: readme.path } : MISSING
}

function pageResult<T extends object>(
  pages: PageItems[],
  read: (id: string, page: number) => T | undefined,
):
  | {
      items: T[]
      hasMore: boolean
      pages: number
      pageData: Array<{ items: T[]; hasMore: boolean }>
    }
  | typeof MISSING {
  const pageData = pages.map((page) => ({
    items: page.ids.flatMap((id) => {
      const item = read(id, page.page)
      return item ? [item] : []
    }),
    hasMore: page.hasMore,
  }))
  if (pageData.some((page, index) => page.items.length !== pages[index]?.ids.length)) return MISSING
  const seen = new Set<string>()
  const items = pageData
    .flatMap((page) => page.items)
    .filter((item) => {
      const candidate = item as { id?: string | number; number?: number; name?: string }
      const id = String(candidate.id ?? candidate.number ?? candidate.name ?? "")
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  return { items, hasMore: pages.at(-1)?.hasMore ?? false, pages: pages.length, pageData }
}

async function writeResource(
  db: NormalizedDatabase,
  pullDomain: PullCollections,
  key: RepositoryResourceKey,
  row: RepositoryResourceRow,
  memberships: SyncedCollection<ResourceMembership, string>,
  pages: SyncedCollection<ResourcePage, string>,
  items: SyncedCollection<ResourceItem, string>,
  releases: SyncedCollection<ReleaseRow, string>,
  assets: SyncedCollection<ReleaseAssetRow, string>,
  branches: SyncedCollection<BranchRow, string>,
  contents: SyncedCollection<ContentRow, string>,
): Promise<void> {
  await memberships.upsert([
    {
      key: row.key,
      scope: db.scope,
      accountLogin: row.accountLogin,
      kind: row.kind,
      identity: row.identity,
      complete: false,
      fetchedAt: row.fetchedAt,
      lastAccessedAt: row.lastAccessedAt,
      payloadBytes: row.payloadBytes,
    },
  ])
  const result = await ingest(db, pullDomain, key, row, releases, assets, branches, contents)
  const oldItems = db.rows(items).filter((item) => item.resourceKey === row.key)
  const oldPages = db.rows(pages).filter((page) => page.resourceKey === row.key)
  if (oldItems.length) await items.remove(oldItems.map((item) => item.key))
  if (oldPages.length) await pages.remove(oldPages.map((page) => page.key))
  if (result.items.length) await items.upsert(result.items)
  if (result.pages.length) await pages.upsert(result.pages)
  await memberships.upsert([{ ...result.membership, complete: true }])
  await pruneOwnedRows(db, memberships, items, releases, assets, branches, contents)
}

interface NormalizedResource {
  membership: ResourceMembership
  pages: ResourcePage[]
  items: ResourceItem[]
}

async function ingest(
  db: NormalizedDatabase,
  _pullDomain: PullCollections,
  key: RepositoryResourceKey,
  row: RepositoryResourceRow,
  releases: SyncedCollection<ReleaseRow, string>,
  assets: SyncedCollection<ReleaseAssetRow, string>,
  branches: SyncedCollection<BranchRow, string>,
  contents: SyncedCollection<ContentRow, string>,
): Promise<NormalizedResource> {
  const membership: ResourceMembership = {
    key: row.key,
    scope: db.scope,
    accountLogin: row.accountLogin,
    kind: row.kind,
    identity: row.identity,
    complete: false,
    fetchedAt: row.fetchedAt,
    lastAccessedAt: row.lastAccessedAt,
    payloadBytes: row.payloadBytes,
  }
  const pageRows: ResourcePage[] = []
  const itemRows: ResourceItem[] = []
  const addPage = (page: number, entityKeys: string[], hasMore: boolean, observedAt?: string) => {
    pageRows.push({
      key: db.key("resource-page", row.key, page),
      scope: db.scope,
      resourceKey: row.key,
      page,
      hasMore,
      observedAt,
    })
    for (const [position, entityKey] of entityKeys.entries())
      itemRows.push({
        key: db.key("resource-item", row.key, page, position),
        scope: db.scope,
        resourceKey: row.key,
        page,
        position,
        entityKey,
      })
  }
  const data = row.data as { pageData?: Array<{ items: PageItem[]; hasMore: boolean }> }

  if (key.kind === "summary") {
    addPage(0, [await writeRepository(db, row.data as RepositorySummary)], false)
  } else if (key.kind === "catalog") {
    for (const [index, page] of (data.pageData ?? []).entries()) {
      const ids = await ensureRepositories(
        db,
        (page.items as RepositorySummary[]).map(repositoryInput),
      )
      addPage(index, ids, page.hasMore)
    }
  } else if (key.kind === "pulls") {
    const repository = await repositoryForRoute(db, key.owner, key.repo)
    for (const [index, page] of (data.pageData ?? []).entries()) {
      const ids: string[] = []
      let observedAt: string | undefined
      for (const raw of page.items as PullSummary[]) {
        observedAt ??= raw.inboxObservedAt
        ids.push(await ingestPullRequest(db, toPullInput(key.owner, repository.key, raw)))
      }
      addPage(index, ids, page.hasMore, observedAt)
    }
  } else if (key.kind === "branches") {
    const repository = await repositoryForRoute(db, key.owner, key.repo)
    for (const [index, page] of (data.pageData ?? []).entries()) {
      const rows = page.items as Array<{ name: string }>
      const ids = rows.map(({ name }) => db.key("repository-branch", repository.key, name))
      await branches.upsert(
        rows.map(({ name }) => ({
          key: db.key("repository-branch", repository.key, name),
          scope: db.scope,
          repositoryId: repository.key,
          name,
        })),
      )
      addPage(index, ids, page.hasMore)
    }
  } else if (key.kind === "releases") {
    const repository = await repositoryForRoute(db, key.owner, key.repo)
    for (const [index, page] of (data.pageData ?? []).entries()) {
      const ids: string[] = []
      const releaseRows: ReleaseRow[] = []
      const assetRows: ReleaseAssetRow[] = []
      const releaseIds = new Set<string>()
      for (const release of page.items as RepositoryRelease[]) {
        const releaseId = db.key("repository-release", repository.key, release.id)
        ids.push(releaseId)
        releaseIds.add(releaseId)
        releaseRows.push({
          key: releaseId,
          scope: db.scope,
          repositoryId: repository.key,
          id: release.id,
          name: release.name,
          tagName: release.tagName,
          body: release.body,
          draft: release.draft,
          prerelease: release.prerelease,
          publishedAt: release.publishedAt,
          htmlUrl: release.htmlUrl,
        })
        assetRows.push(
          ...release.assets.map((asset, position) => ({
            ...asset,
            key: db.key("repository-release-asset", releaseId, asset.id),
            scope: db.scope,
            releaseId,
            position,
          })),
        )
      }
      if (releaseRows.length) await releases.upsert(releaseRows)
      const oldAssets = db.rows(assets).filter((asset) => releaseIds.has(asset.releaseId))
      if (oldAssets.length) await assets.remove(oldAssets.map((asset) => asset.key))
      if (assetRows.length) await assets.upsert(assetRows)
      addPage(index, ids, page.hasMore)
    }
  } else if (key.kind === "contents") {
    const repository = await repositoryForRoute(db, key.owner, key.repo)
    const result = row.data as RepositoryContents
    if (result.kind === "directory") {
      const ids = result.entries.map((entry) => contentKey(db, repository.key, key.ref, entry.path))
      for (const entry of result.entries) {
        await upsertContent(contents, db, {
          ...entry,
          key: contentKey(db, repository.key, key.ref, entry.path),
          scope: db.scope,
          repositoryId: repository.key,
          ref: key.ref,
        })
      }
      membership.shape = "directory"
      membership.limited = result.limited
      addPage(0, ids, false)
    } else {
      const id = contentKey(db, repository.key, key.ref, result.entry.path)
      await upsertContent(contents, db, {
        ...result.entry,
        key: id,
        scope: db.scope,
        repositoryId: repository.key,
        ref: key.ref,
        text: result.text,
      })
      membership.shape = "file"
      membership.reason = result.reason
      addPage(0, [id], false)
    }
  } else if (key.kind === "readme") {
    const result = row.data as {
      html: string
      path: string
      sha?: string
      size?: number
      htmlUrl?: string
    } | null
    if (!result) membership.shape = "null"
    else {
      const repository = await repositoryForRoute(db, key.owner, key.repo)
      const id = contentKey(db, repository.key, key.ref, result.path)
      await upsertContent(contents, db, {
        key: id,
        scope: db.scope,
        repositoryId: repository.key,
        ref: key.ref,
        name: result.path.split("/").at(-1) ?? result.path,
        path: result.path,
        type: "file",
        size: result.size ?? 0,
        htmlUrl: result.htmlUrl ?? null,
        sha: result.sha,
        renderedHtml: result.html,
      })
      membership.shape = "readme"
      addPage(0, [id], false)
    }
  }
  return { membership, pages: pageRows, items: itemRows }
}

async function removeResources(
  db: NormalizedDatabase,
  keys: string[],
  memberships: SyncedCollection<ResourceMembership, string>,
  pages: SyncedCollection<ResourcePage, string>,
  items: SyncedCollection<ResourceItem, string>,
) {
  const selected = new Set(keys)
  const selectedMemberships = db.rows(memberships).filter((row) => selected.has(row.key))
  if (selectedMemberships.length)
    await memberships.upsert(selectedMemberships.map((row) => ({ ...row, complete: false })))
  const pageKeys = db
    .rows(pages)
    .filter((page) => selected.has(page.resourceKey))
    .map((page) => page.key)
  const itemKeys = db
    .rows(items)
    .filter((item) => selected.has(item.resourceKey))
    .map((item) => item.key)
  if (itemKeys.length) await items.remove(itemKeys)
  if (pageKeys.length) await pages.remove(pageKeys)
  await memberships.remove(keys)
}

async function pruneOwnedRows(
  db: NormalizedDatabase,
  memberships: SyncedCollection<ResourceMembership, string>,
  items: SyncedCollection<ResourceItem, string>,
  releases: SyncedCollection<ReleaseRow, string>,
  assets: SyncedCollection<ReleaseAssetRow, string>,
  branches: SyncedCollection<BranchRow, string>,
  contents: SyncedCollection<ContentRow, string>,
) {
  const liveIds = new Set(db.rows(items).map((item) => item.entityKey))
  const liveReleaseIds = new Set(
    db
      .rows(memberships)
      .filter((row) => row.kind === "releases")
      .flatMap((row) =>
        db
          .rows(items)
          .filter((item) => item.resourceKey === row.key)
          .map((item) => item.entityKey),
      ),
  )
  const orphanReleases = db.rows(releases).filter((row) => !liveReleaseIds.has(row.key))
  const orphanReleaseIds = new Set(orphanReleases.map((row) => row.key))
  const orphanAssetIds = db
    .rows(assets)
    .filter((row) => orphanReleaseIds.has(row.releaseId))
    .map((row) => row.key)
  if (orphanAssetIds.length) await assets.remove(orphanAssetIds)
  if (orphanReleases.length) await releases.remove(orphanReleases.map((row) => row.key))
  const orphanBranches = db
    .rows(branches)
    .filter((row) => !liveIds.has(row.key))
    .map((row) => row.key)
  if (orphanBranches.length) await branches.remove(orphanBranches)
  const orphanContents = db
    .rows(contents)
    .filter((row) => !liveIds.has(row.key))
    .map((row) => row.key)
  if (orphanContents.length) await contents.remove(orphanContents)
}

function readPages(
  db: NormalizedDatabase,
  pages: SyncedCollection<ResourcePage, string>,
  items: SyncedCollection<ResourceItem, string>,
  resourceKey: string,
): PageItems[] {
  const resourceItems = db.rows(items).filter((item) => item.resourceKey === resourceKey)
  return db
    .rows(pages)
    .filter((page) => page.resourceKey === resourceKey)
    .sort((a, b) => a.page - b.page)
    .map((page) => ({
      page: page.page,
      hasMore: page.hasMore,
      observedAt: page.observedAt,
      ids: resourceItems
        .filter((item) => item.page === page.page)
        .sort((a, b) => a.position - b.position)
        .map((item) => item.entityKey),
    }))
}

function isActiveScope(db: NormalizedDatabase, row: RepositoryResourceRow): boolean {
  const key = parseKey(row.identity)
  if (!key) return false
  const host = key.host.replace(/\/$/, "").toLowerCase()
  const account = key.accountLogin.trim().toLowerCase()
  return db.scope === JSON.stringify([host, account])
}

async function writeRepository(
  db: NormalizedDatabase,
  summary: RepositorySummary,
): Promise<string> {
  return ensureRepository(db, repositoryInput(summary))
}

function repositoryInput(summary: RepositorySummary): RepositoryInput {
  return {
    nodeId: summary.nodeId ?? undefined,
    databaseId: summary.id,
    fullName: summary.fullName,
    ownerLogin: summary.owner,
    ownerNodeId: summary.ownerNodeId,
    ownerDatabaseId: summary.ownerDatabaseId,
    ownerKind: summary.ownerKind,
    name: summary.name,
    description: summary.description,
    private: summary.private,
    archived: summary.archived,
    defaultBranch: summary.defaultBranch,
    htmlUrl: summary.htmlUrl,
    canAdmin: summary.canAdmin,
  }
}

async function repositoryForRoute(
  db: NormalizedDatabase,
  owner: string,
  repo: string,
): Promise<CanonicalRepository> {
  const fullName = `${owner}/${repo}`
  const existing = db
    .rows(db.table<CanonicalRepository>("repositories"))
    .find((row) => row.fullName.toLowerCase() === fullName.toLowerCase())
  if (existing) return existing
  const key = await ensureRepository(db, { fullName, ownerLogin: owner, name: repo })
  return readRepository(db, key)!
}

function toSummary(db: NormalizedDatabase, row: CanonicalRepository): RepositorySummary {
  const owner = readActor(db, row.ownerId ?? "")
  return {
    nodeId: row.nodeId ?? null,
    id: row.databaseId ?? 0,
    fullName: row.fullName,
    name: row.name,
    owner: owner?.login ?? row.fullName.split("/")[0] ?? "",
    ...(owner?.nodeId ? { ownerNodeId: owner.nodeId } : {}),
    ...(owner?.databaseId === undefined ? {} : { ownerDatabaseId: owner.databaseId }),
    ...(owner?.kind ? { ownerKind: owner.kind } : {}),
    description: row.description ?? null,
    private: row.private ?? false,
    archived: row.archived ?? false,
    defaultBranch: row.defaultBranch ?? "",
    htmlUrl: row.htmlUrl ?? "",
    canAdmin: row.canAdmin ?? false,
  }
}

function entryDto(row: ContentRow): ContentEntry {
  return {
    name: row.name,
    path: row.path,
    ...(row.sha ? { sha: row.sha } : {}),
    type: row.type,
    size: row.size,
    htmlUrl: row.htmlUrl,
  }
}

async function upsertContent(
  table: SyncedCollection<ContentRow, string>,
  db: NormalizedDatabase,
  incoming: ContentRow,
) {
  const previous = db.rows(table).find((row) => row.key === incoming.key)
  const changed = Boolean(previous?.sha && incoming.sha && previous.sha !== incoming.sha)
  await table.upsert([
    {
      ...previous,
      ...incoming,
      text:
        incoming.text === undefined ? (changed ? null : (previous?.text ?? null)) : incoming.text,
      renderedHtml:
        incoming.renderedHtml === undefined
          ? changed
            ? null
            : (previous?.renderedHtml ?? null)
          : incoming.renderedHtml,
    },
  ])
}

function toPullInput(owner: string, repositoryId: string, raw: PullSummary): CanonicalPullInput {
  const reviewRequestsComplete =
    raw.requested_reviewers !== undefined && raw.requested_teams !== undefined
  return {
    source: "resource",
    observedAt: raw.inboxObservedAt,
    nodeId: raw.node_id,
    repositoryId,
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    isDraft: raw.draft,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    headRef: raw.head?.ref,
    headOid: raw.head?.sha,
    baseRef: raw.base?.ref,
    author:
      raw.user === null
        ? null
        : raw.user?.login
          ? { id: raw.user.node_id, login: raw.user.login, avatarUrl: raw.user.avatar_url }
          : undefined,
    labels: raw.labels?.map((label) => ({
      id: label.node_id,
      name: label.name,
      color: label.color,
    })),
    labelsComplete: raw.labels !== undefined,
    reviewRequestsComplete,
    reviewRequestTargets: reviewRequestsComplete
      ? [
          ...(raw.requested_reviewers ?? []).flatMap((reviewer) =>
            reviewer.login
              ? [{ kind: "user" as const, login: reviewer.login, nodeId: reviewer.node_id }]
              : [],
          ),
          ...(raw.requested_teams ?? []).map((team) => ({
            kind: "team" as const,
            login: `${owner}/${team.slug}`,
            nodeId: team.node_id,
          })),
        ]
      : undefined,
  }
}

function contentKey(db: NormalizedDatabase, repositoryId: string, ref: string, path: string) {
  return db.key("repository-content", repositoryId, ref, path)
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function parseKey(identity: string): RepositoryResourceKey | undefined {
  try {
    return JSON.parse(identity) as RepositoryResourceKey
  } catch {
    return undefined
  }
}
