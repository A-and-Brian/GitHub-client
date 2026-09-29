import { type Collection, createCollection, type SyncConfig } from "@tanstack/db"
import type { PersistedCollectionPersistence } from "@tanstack/db-sqlite-persistence-core"
import { createSyncedCollection, type SyncedCollection } from "./synced"

export interface ScopedRow {
  key: string
  scope: string
}

interface WriteObservation extends ScopedRow {
  complete: boolean
}

/** Persistent domain tables and non-persistent, reactive views of their joins. */
export class NormalizedDatabase {
  scope = JSON.stringify(["https://api.github.com", ""])
  private readonly tables = new Map<string, SyncedCollection<ScopedRow, string>>()
  private readonly views: Array<() => Promise<void>> = []
  private queue: Promise<unknown> = Promise.resolve()
  private hydration?: Promise<void>
  private generation = 0
  private readonly persistence?: PersistedCollectionPersistence
  private readonly observations: SyncedCollection<WriteObservation, string>

  constructor(persistence?: PersistedCollectionPersistence) {
    this.persistence = persistence
    this.observations = this.table<WriteObservation>("writeObservations")
  }

  key(...parts: (string | number)[]): string {
    return JSON.stringify([this.scope, ...parts])
  }

  table<T extends ScopedRow>(name: string): SyncedCollection<T, string> {
    let table = this.tables.get(name)
    if (!table) {
      const persisted = createSyncedCollection<ScopedRow, string>({
        id: `normalized:${name}`,
        getKey: (row) => row.key,
        persistence: this.persistence,
        schemaVersion: 1,
        startSync: false,
      })
      table = {
        ...persisted,
        upsert: (rows) => persisted.upsert(rows.map(plain)),
        replace: (rows, scope) => persisted.replace(rows.map(plain), scope),
      }
      this.tables.set(name, table)
    }
    return table as unknown as SyncedCollection<T, string>
  }

  rows<T extends ScopedRow>(table: SyncedCollection<T, string>): T[] {
    return [...table.collection.values()].filter((row) => row.scope === this.scope).map(plain)
  }

  async ready(): Promise<void> {
    // Construction registers every domain table before hydration starts.
    await Promise.resolve()
    if (!this.hydration) {
      this.hydration = (async () => {
        // The adapter does not coalesce concurrent global schema initialization.
        // Hydrate one table first so every other table reuses that completed setup.
        await this.observations.collection.preload()
        await Promise.all([...this.tables.values()].map((table) => table.collection.preload()))
      })().finally(() => {
        this.hydration = undefined
      })
    }
    await this.hydration
  }

  async setScope(host: string, account: string): Promise<void> {
    const scope = JSON.stringify([host.replace(/\/$/, "").toLowerCase(), account.toLowerCase()])
    if (scope === this.scope) return
    this.generation++
    await this.enqueue(async () => {
      await this.ready()
      this.scope = scope
      await this.publish()
    })
  }

  /** All domain writes are serialized; views publish only after persistence succeeds. */
  mutate(work: () => Promise<void>): Promise<void> {
    const generation = this.generation
    return this.enqueue(async () => {
      if (generation !== this.generation) return
      await this.ready()
      await work()
      if (generation === this.generation) await this.publish()
    })
  }

  async clear(): Promise<void> {
    this.generation++
    await this.enqueue(async () => {
      await this.ready()
      for (const table of this.tables.values()) await table.replace([], () => true)
      await this.publish()
    })
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async publish(): Promise<void> {
    for (const publish of this.views) await publish()
  }

  projection<T extends object, K extends string | number>(
    name: string,
    getKey: (row: T) => K,
    read: () => T[],
    write: (rows: T[]) => Promise<void>,
    remove: (keys: K[]) => Promise<void>,
    options: { trackWrites?: boolean } = {},
  ): SyncedCollection<T, K> {
    type Writer = Parameters<SyncConfig<T, K>["sync"]>[0]
    let writer: Writer | undefined
    let collection: Collection<T, K>
    let publishedScope = this.scope
    const publish = async () => {
      if (!writer || !collection) return
      if (publishedScope !== this.scope) {
        writer.begin({ immediate: true })
        for (const row of collection.values()) writer.write({ type: "delete", key: getKey(row) })
        await writer.commit()
        publishedScope = this.scope
      }
      if (
        options.trackWrites !== false &&
        this.observations.collection.get(this.key("write", name))?.complete === false
      ) {
        writer.markReady()
        return
      }
      const rows = read()
      const keys = new Set(rows.map(getKey))
      writer.begin({ immediate: true })
      for (const row of collection.values()) {
        const key = getKey(row)
        if (!keys.has(key)) writer.write({ type: "delete", key })
      }
      for (const row of rows) {
        const key = getKey(row)
        const previous = collection.get(key)
        if (!previous) writer.write({ type: "insert", value: row })
        else if (JSON.stringify(plain(previous)) !== JSON.stringify(row)) {
          writer.write({ type: "delete", key })
          writer.write({ type: "insert", value: row })
        }
      }
      await writer.commit()
      writer.markReady()
    }
    const change = (work: () => Promise<void>) =>
      this.mutate(async () => {
        const key = this.key("write", name)
        if (options.trackWrites !== false)
          await this.observations.upsert([{ key, scope: this.scope, complete: false }])
        await work()
        if (options.trackWrites !== false)
          await this.observations.upsert([{ key, scope: this.scope, complete: true }])
      })
    this.views.push(publish)
    collection = createCollection<T, K>({
      id: `view:${name}`,
      getKey,
      startSync: true,
      sync: {
        sync: (next) => {
          writer = next
          void this.ready()
            .then(publish)
            .catch((error: unknown) => next.markError(error))
          return () => {
            if (writer === next) writer = undefined
          }
        },
      },
      onInsert: async ({ transaction }) => {
        await change(() => write(transaction.mutations.map((mutation) => plain(mutation.modified))))
      },
      onUpdate: async ({ transaction }) => {
        await change(() => write(transaction.mutations.map((mutation) => plain(mutation.modified))))
      },
      onDelete: async ({ transaction }) => {
        await change(() =>
          remove(transaction.mutations.map((mutation) => getKey(mutation.original))),
        )
      },
    }) as Collection<T, K>
    return {
      collection,
      upsert: (rows) => change(() => write(rows)),
      remove: (keys) => change(() => remove(keys)),
      replace: (rows, scope) =>
        change(async () => {
          const keep = new Set(rows.map(getKey))
          const removed = read()
            .filter((row) => scope(row) && !keep.has(getKey(row)))
            .map(getKey)
          // Publish memberships only after their entities have been written.
          await write(rows)
          await remove(removed)
        }),
    }
  }
}

export function plain<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("$"))) as T
}
