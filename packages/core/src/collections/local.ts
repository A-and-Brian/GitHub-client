import type { DraftComment } from "../actions/reviews"
import type { InboxPreference } from "../inbox"
import { readRepository } from "./identities"
import type { NormalizedDatabase, ScopedRow } from "./normalized"
import { ensurePullIdentity, findPull } from "./pulls"

interface PreferenceRow extends ScopedRow, Omit<InboxPreference, "key" | "pullId"> {
  pullKey: string
}
interface DraftRow extends ScopedRow, Omit<DraftComment, "prKey"> {
  pullKey: string
}
export interface ViewedFile {
  key: string
  prKey: string
  headOid: string
  path: string
}
interface ViewedRow extends ScopedRow, Omit<ViewedFile, "key" | "prKey"> {
  pullKey: string
}

export function createLocalCollections(db: NormalizedDatabase) {
  const preferenceRows = db.table<PreferenceRow>("inboxPreferences")
  const draftRows = db.table<DraftRow>("drafts")
  const viewedRows = db.table<ViewedRow>("viewedFiles")
  const route = (pullKey: string) => {
    const pull = findPull(db, pullKey)
    if (!pull?.repositoryId) return undefined
    const repository = readRepository(db, pull.repositoryId)
    return repository ? `${repository.fullName}#${pull.number}` : undefined
  }
  const pullForRoute = (prKey: string) => {
    const separator = prKey.lastIndexOf("#")
    return ensurePullIdentity(db, {
      repo: prKey.slice(0, separator),
      number: Number(prKey.slice(separator + 1)),
    })
  }
  const inboxPreferences = db.projection<InboxPreference, string>(
    "inboxPreferences",
    (row) => row.key,
    () =>
      db.rows(preferenceRows).flatMap(({ key: _key, scope: _scope, pullKey, ...row }) => {
        const pull = findPull(db, pullKey)
        if (!pull?.nodeId) return []
        return [
          { ...row, key: `${row.accountLogin.toLowerCase()}:${pull.nodeId}`, pullId: pull.nodeId },
        ]
      }),
    async (rows) => {
      const next: PreferenceRow[] = []
      for (const row of rows) {
        const pullKey = await ensurePullIdentity(db, { nodeId: row.pullId })
        const { key: _key, pullId: _pullId, ...fields } = row
        next.push({
          ...fields,
          key: db.key("preference", row.accountLogin.toLowerCase(), pullKey),
          scope: db.scope,
          pullKey,
        })
      }
      await preferenceRows.upsert(next)
    },
    async (keys) => {
      const selected = new Set(keys)
      await preferenceRows.remove(
        db
          .rows(preferenceRows)
          .filter((row) => {
            const pull = findPull(db, row.pullKey)
            return pull?.nodeId && selected.has(`${row.accountLogin.toLowerCase()}:${pull.nodeId}`)
          })
          .map((row) => row.key),
      )
    },
    { trackWrites: false },
  )
  const drafts = db.projection<DraftComment, string>(
    "drafts",
    (row) => row.id,
    () =>
      db.rows(draftRows).flatMap(({ key: _key, scope: _scope, pullKey, ...row }) => {
        const prKey = route(pullKey)
        return prKey ? [{ ...row, prKey }] : []
      }),
    async (rows) => {
      const next: DraftRow[] = []
      for (const row of rows) {
        const pullKey = await pullForRoute(row.prKey)
        const { prKey: _prKey, ...fields } = row
        next.push({ ...fields, key: db.key("draft", row.id), scope: db.scope, pullKey })
      }
      await draftRows.upsert(next)
    },
    async (ids) => {
      await draftRows.remove(ids.map((id) => db.key("draft", id)))
    },
    { trackWrites: false },
  )
  const viewedFiles = db.projection<ViewedFile, string>(
    "viewedFiles",
    (row) => row.key,
    () =>
      db.rows(viewedRows).flatMap(({ key: _key, scope: _scope, pullKey, ...row }) => {
        const prKey = route(pullKey)
        return prKey ? [{ ...row, key: JSON.stringify([prKey, row.headOid, row.path]), prKey }] : []
      }),
    async (rows) => {
      for (const row of rows) {
        const pullKey = await pullForRoute(row.prKey)
        await viewedRows.upsert([
          {
            key: db.key("viewed", pullKey, row.headOid, row.path),
            scope: db.scope,
            pullKey,
            headOid: row.headOid,
            path: row.path,
          },
        ])
      }
    },
    async (keys) => {
      const selected = new Set(keys)
      await viewedRows.remove(
        db
          .rows(viewedRows)
          .filter((row) => {
            const prKey = route(row.pullKey)
            return prKey && selected.has(JSON.stringify([prKey, row.headOid, row.path]))
          })
          .map((row) => row.key),
      )
    },
    { trackWrites: false },
  )
  return { inboxPreferences, drafts: drafts.collection, viewedFiles }
}
