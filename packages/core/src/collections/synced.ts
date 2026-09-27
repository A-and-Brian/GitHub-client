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
  let rollbackWriter: Writer<T, K> | undefined
  let activeWriter: Writer<T, K> | undefined
  const sync: SyncConfig<T, K> = {
    sync: (params) => {
      activeWriter = params
      params.markReady()
      return () => {
        if (activeWriter === params) {
          activeWriter = undefined
          rollbackWriter = undefined
        }
      }
    },
  }
  const config = { id: options.id, getKey: options.getKey, sync, startSync: true }
  const collection = (
    options.persistence
      ? (() => {
          const persisted = persistedCollectionOptions<T, K>({
            ...config,
            persistence: options.persistence,
            schemaVersion: options.schemaVersion,
          })
          const persistedSync = persisted.sync
          return createCollection({
            ...persisted,
            sync: {
              ...persistedSync,
              sync: (params) => {
                // The persistence wrapper publishes sync changes before SQLite
                // commits. Keep the underlying sync callbacks so a failed write
                // can publish an inverse change without writing to SQLite again.
                rollbackWriter = params
                const result = persistedSync.sync(params)
                const cleanup =
                  typeof result === "function"
                    ? result
                    : result && typeof result === "object"
                      ? result.cleanup
                      : undefined
                if (!cleanup) return result
                return {
                  ...(typeof result === "object" ? result : {}),
                  cleanup: () => {
                    if (rollbackWriter === params) rollbackWriter = undefined
                    cleanup()
                  },
                }
              },
            },
          })
        })()
      : createCollection<T, K>(config)
  ) as Collection<T, K>

  // Writes are serialized so that concurrent sync jobs never interleave transactions.
  let queue: Promise<unknown> = Promise.resolve()
  const transact = (
    keys: readonly K[] | (() => readonly K[]),
    apply: (writer: Writer<T, K>) => void,
  ): Promise<void> => {
    const next = queue.then(async () => {
      await collection.preload()
      const writer = activeWriter
      if (!writer) throw new Error(`Collection "${options.id}" has no active sync writer`)
      const affectedKeys = typeof keys === "function" ? keys() : keys
      const before = new Map(
        affectedKeys.map((key) => {
          const row = collection.get(key)
          return [
            key,
            {
              row: row === undefined ? undefined : (withoutVirtualProps(row) as T),
              metadata: rollbackWriter?.metadata?.row.get(key),
            },
          ] as const
        }),
      )
      writer.begin()
      try {
        apply(writer)
      } catch (error) {
        // A failed write must not leave an open transaction on the sync stack.
        const abort = new AbortController()
        abort.abort()
        try {
          await writer.commit(abort.signal)
        } catch {
          // Preserve the original write error.
        }
        throw error
      }
      try {
        await writer.commit()
      } catch (error) {
        if (rollbackWriter) {
          rollbackWriter.begin({ immediate: true })
          for (const [key, { row, metadata }] of before) {
            const exists = collection.has(key)
            if (row === undefined) {
              if (exists) rollbackWriter.write({ type: "delete", key })
            } else if (exists) {
              // Updates merge fields by default. Delete then insert in one sync
              // transaction to remove fields introduced by the failed write.
              rollbackWriter.write({ type: "delete", key })
              rollbackWriter.write({ type: "insert", value: row })
            } else {
              rollbackWriter.write({ type: "insert", value: row })
            }
            if (metadata === undefined) rollbackWriter.metadata?.row.delete(key)
            else rollbackWriter.metadata?.row.set(key, metadata)
          }
          const restored = rollbackWriter.commit()
          if (restored !== true) await restored
        }
        throw error
      }
    })
    queue = next.catch(() => undefined)
    return next
  }

  // Unchanged rows are skipped so that polling does not rewrite SQLite or re-render.
  const upsertAll = (writer: Writer<T, K>, rows: T[]) => {
    for (const row of rows) {
      const existing = collection.get(options.getKey(row))
      if (!existing) writer.write({ type: "insert", value: row })
      else if (JSON.stringify(withoutVirtualProps(existing)) !== JSON.stringify(row)) {
        writer.write({ type: "update", value: row })
      }
    }
  }

  return {
    collection,
    replace: (rows, scope) =>
      transact(
        () => [
          ...new Set([
            ...rows.map(options.getKey),
            ...[...collection.values()].filter(scope).map(options.getKey),
          ]),
        ],
        (writer) => {
          const keep = new Set(rows.map(options.getKey))
          for (const row of collection.values()) {
            const key = options.getKey(row)
            if (scope(row) && !keep.has(key)) writer.write({ type: "delete", key })
          }
          upsertAll(writer, rows)
        },
      ),
    upsert: (rows) => transact(rows.map(options.getKey), (writer) => upsertAll(writer, rows)),
    remove: (keys) =>
      transact(keys, (writer) => {
        for (const key of keys) {
          if (collection.has(key)) writer.write({ type: "delete", key })
        }
      }),
  }
}

/** TanStack DB adds `$synced`, `$origin`, and similar props to the rows it returns. */
function withoutVirtualProps<T extends object>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.startsWith("$")),
  ) as Partial<T>
}
