import { type Collection, createCollection, type SyncConfig } from "@tanstack/db"
import {
  type PersistedCollectionPersistence,
  persistedCollectionOptions,
} from "@tanstack/db-sqlite-persistence-core"

type Key = string | number

/**
 * A collection whose rows come from GitHub sync jobs.
 * Rows are persisted when `persistence` is given, so the UI renders the last
 * known state at startup before the first poll finishes.
 */
export interface SyncedCollection<T extends object, K extends Key> {
  collection: Collection<T, K>
  /** Upserts `rows` and deletes rows in `scope` that are not in `rows`. */
  replace(rows: T[], scope: (row: T) => boolean): Promise<void>
  upsert(rows: T[]): Promise<void>
  remove(keys: K[]): Promise<void>
}

export interface SyncedCollectionOptions<T extends object, K extends Key> {
  id: string
  getKey: (row: T) => K
  persistence?: PersistedCollectionPersistence
  /** Bump when the row shape changes; persisted rows of older versions are dropped. */
  schemaVersion: number
}

type Writer<T extends object, K extends Key> = Parameters<SyncConfig<T, K>["sync"]>[0]

export function createSyncedCollection<T extends object, K extends Key>(
  options: SyncedCollectionOptions<T, K>,
): SyncedCollection<T, K> {
  let resolveWriter: (writer: Writer<T, K>) => void
  const writerReady = new Promise<Writer<T, K>>((resolve) => {
    resolveWriter = resolve
  })
  const sync: SyncConfig<T, K> = {
    sync: (params) => {
      resolveWriter(params)
      params.markReady()
    },
  }
  const config = { id: options.id, getKey: options.getKey, sync, startSync: true }
  const collection = (
    options.persistence
      ? createCollection(
          persistedCollectionOptions<T, K>({
            ...config,
            persistence: options.persistence,
            schemaVersion: options.schemaVersion,
          }),
        )
      : createCollection<T, K>(config)
  ) as Collection<T, K>

  // Writes are serialized so that concurrent sync jobs never interleave transactions.
  let queue: Promise<unknown> = Promise.resolve()
  const transact = (apply: (writer: Writer<T, K>) => void): Promise<void> => {
    const next = queue.then(async () => {
      const writer = await writerReady
      await collection.preload()
      writer.begin()
      apply(writer)
      await writer.commit()
    })
    queue = next.catch(() => undefined)
    return next
  }

  // Unchanged rows are skipped so that polling does not rewrite SQLite or re-render.
  const upsertAll = (writer: Writer<T, K>, rows: T[]) => {
    for (const row of rows) {
      const existing = collection.get(options.getKey(row))
      if (!existing) writer.write({ type: "insert", value: row })
      else if (JSON.stringify(existing) !== JSON.stringify(row)) {
        writer.write({ type: "update", value: row })
      }
    }
  }

  return {
    collection,
    replace: (rows, scope) =>
      transact((writer) => {
        const keep = new Set(rows.map(options.getKey))
        for (const row of collection.values()) {
          const key = options.getKey(row)
          if (scope(row) && !keep.has(key)) writer.write({ type: "delete", key })
        }
        upsertAll(writer, rows)
      }),
    upsert: (rows) => transact((writer) => upsertAll(writer, rows)),
    remove: (keys) =>
      transact((writer) => {
        for (const key of keys) {
          if (collection.has(key)) writer.write({ type: "delete", key })
        }
      }),
  }
}
