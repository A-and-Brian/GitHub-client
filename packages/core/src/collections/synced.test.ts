import { BasicIndex, createLiveQueryCollection, eq } from "@tanstack/db"
import { createPersistedTableName } from "@tanstack/db-sqlite-persistence-core"
import Database from "better-sqlite3"
import { afterEach, beforeEach, expect, test } from "vitest"
import { tempDatabase } from "../test/persistence"
import { createSyncedCollection } from "./synced"

type Row = { id: string; title: string; pinOrder?: number }

let db: ReturnType<typeof tempDatabase>
beforeEach(() => {
  db = tempDatabase()
})
afterEach(() => db.close())

/** Highest row version in the collection's SQLite table; every row write bumps it. */
function latestRowVersion(file: string, collectionId: string): number {
  const reader = new Database(file, { readonly: true })
  const table = createPersistedTableName(collectionId, "c")
  const row = reader.prepare(`SELECT max(row_version) AS v FROM "${table}"`).get() as { v: number }
  reader.close()
  return row.v
}

test("replacing with identical rows writes nothing to SQLite", async () => {
  const synced = createSyncedCollection<Row, string>({
    id: "rows",
    getKey: (r) => r.id,
    persistence: db.open(),
    schemaVersion: 1,
  })
  const rows = [
    { id: "1", title: "one" },
    { id: "2", title: "two" },
  ]
  await synced.replace(rows, () => true)
  const before = latestRowVersion(db.file, "rows")

  await synced.replace(
    rows.map((r) => ({ ...r })),
    () => true,
  )
  expect(latestRowVersion(db.file, "rows")).toBe(before)

  await synced.replace([{ id: "1", title: "changed" }, rows[1]!], () => true)
  expect(latestRowVersion(db.file, "rows")).toBeGreaterThan(before)
})

test("persisted writes resume after cleanup and restart", async () => {
  const options = {
    id: "jobs",
    getKey: (row: { id: number; runId: number; name: string }) => row.id,
    schemaVersion: 1,
  }
  const synced = createSyncedCollection({ ...options, persistence: db.open() })
  await synced.collection.preload()
  await synced.collection.cleanup()

  const job = { id: 108471660925, runId: 36266350823, name: "web" }
  await synced.replace([job], (row) => row.runId === job.runId)

  expect(synced.collection.get(job.id)).toMatchObject(job)
  expect(latestRowVersion(db.file, "jobs")).toBeGreaterThan(0)
  await synced.collection.cleanup()

  const reopened = createSyncedCollection({ ...options, persistence: db.open() })
  await reopened.collection.preload()
  expect(reopened.collection.get(job.id)).toMatchObject(job)
  await reopened.collection.cleanup()
})

test.each([true, false])(
  "updates and deletes rows across repeated cleanup (persisted: %s)",
  async (persisted) => {
    const synced = createSyncedCollection<Row, string>({
      id: "rows",
      getKey: (row) => row.id,
      persistence: persisted ? db.open() : undefined,
      schemaVersion: 1,
    })
    await synced.upsert([
      { id: "one", title: "original" },
      { id: "two", title: "remove by replacement" },
    ])
    await synced.collection.cleanup()

    await synced.replace([{ id: "one", title: "updated" }], () => true)
    expect([...synced.collection.values()]).toMatchObject([{ id: "one", title: "updated" }])
    await synced.collection.cleanup()

    await synced.upsert([{ id: "three", title: "added after restart" }])
    await synced.remove(["three", "one"])
    expect(synced.collection.size).toBe(0)
    await synced.collection.cleanup()
    await synced.collection.preload()
    expect(synced.collection.size).toBe(0)
    await synced.collection.cleanup()
  },
)

test("failed writes after persisted cleanup and restart roll back and can retry", async () => {
  const synced = createRows()
  await synced.collection.preload()
  await synced.collection.cleanup()
  await synced.upsert([{ id: "1", title: "one" }])

  const triggerDb = new Database(db.file)
  const table = createPersistedTableName("rows", "c")
  triggerDb.exec(
    `CREATE TRIGGER fail_insert BEFORE INSERT ON "${table}" BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;`,
  )
  try {
    await expect(synced.upsert([{ id: "1", title: "changed" }])).rejects.toThrow(
      "injected persistence failure",
    )
    expect(synced.collection.get("1")).toMatchObject({ id: "1", title: "one" })

    const reloaded = createRows()
    await reloaded.collection.preload()
    expect(reloaded.collection.get("1")).toMatchObject({ id: "1", title: "one" })
    await reloaded.collection.cleanup()

    triggerDb.exec("DROP TRIGGER fail_insert")
    await synced.upsert([{ id: "1", title: "retried" }])
    expect(synced.collection.get("1")).toMatchObject({ id: "1", title: "retried" })
  } finally {
    await synced.collection.cleanup()
    triggerDb.close()
  }
})

test.each([
  {
    name: "insert",
    change: (synced: ReturnType<typeof createRows>) => synced.upsert([{ id: "2", title: "two" }]),
    changedKey: "2",
    changedEvent: "insert:2:two",
    restoredEvent: "delete:2:two",
    expected: undefined,
    retried: { id: "2", title: "two" },
  },
  {
    name: "update",
    change: (synced: ReturnType<typeof createRows>) =>
      synced.upsert([{ id: "1", title: "changed" }]),
    changedKey: "1",
    changedEvent: "update:1:changed",
    restoredEvent: "update:1:one",
    expected: { id: "1", title: "one" },
    retried: { id: "1", title: "changed" },
  },
  {
    name: "delete",
    change: (synced: ReturnType<typeof createRows>) => synced.remove(["1"]),
    changedKey: "1",
    changedEvent: "delete:1:one",
    restoredEvent: "insert:1:one",
    expected: { id: "1", title: "one" },
    retried: undefined,
  },
])("failed durable $name restores subscribers, disk, and the next write", async (scenario) => {
  const synced = createRows()
  await synced.upsert([{ id: "1", title: "one" }])
  const triggerDb = new Database(db.file)
  const table = createPersistedTableName("rows", "c")
  for (const action of ["INSERT", "UPDATE", "DELETE"]) {
    triggerDb.exec(
      `CREATE TRIGGER fail_${action.toLowerCase()} BEFORE ${action} ON "${table}" BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;`,
    )
  }
  const observed: string[] = []
  const subscription = synced.collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        observed.push(`${change.type}:${change.key}:${change.value.title}`)
      }
    },
    { includeInitialState: true },
  )

  try {
    await expect(scenario.change(synced)).rejects.toThrow("injected persistence failure")
    if (scenario.expected === undefined) {
      expect(synced.collection.get(scenario.changedKey)).toBeUndefined()
    } else {
      expect(synced.collection.get(scenario.changedKey)).toMatchObject(scenario.expected)
    }
    expect(observed).toContain(scenario.changedEvent)
    expect(observed.at(-1)).toBe(scenario.restoredEvent)

    const reloaded = createRows()
    await reloaded.collection.preload()
    expect(reloaded.collection.get(scenario.changedKey)).toEqual(
      scenario.expected === undefined ? undefined : expect.objectContaining(scenario.expected),
    )

    for (const action of ["insert", "update", "delete"]) {
      triggerDb.exec(`DROP TRIGGER fail_${action}`)
    }
    await scenario.change(synced)
    expect(synced.collection.get(scenario.changedKey)).toEqual(
      scenario.retried === undefined ? undefined : expect.objectContaining(scenario.retried),
    )
  } finally {
    subscription.unsubscribe()
    triggerDb.close()
  }
})

test("failed queued replace restores a row created by the preceding write", async () => {
  const persistence = db.open().resolvePersistenceForCollection!({
    collectionId: "rows",
    mode: "sync-present",
    schemaVersion: 1,
  })
  const persist = persistence.adapter.applyCommittedTx.bind(persistence.adapter)
  const triggerDb = new Database(db.file)
  let writes = 0
  persistence.adapter.applyCommittedTx = async (...args) => {
    await persist(...args)
    if (++writes === 1) {
      const table = createPersistedTableName("rows", "c")
      triggerDb.exec(
        `CREATE TRIGGER fail_delete BEFORE DELETE ON "${table}" BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;`,
      )
    }
  }
  const synced = createSyncedCollection<Row, string>({
    id: "rows",
    getKey: (row) => row.id,
    persistence,
    schemaVersion: 1,
  })
  try {
    const inserted = synced.upsert([{ id: "1", title: "one" }])
    const replaced = synced.replace([], () => true)
    await inserted
    await expect(replaced).rejects.toThrow("injected persistence failure")
    expect(synced.collection.get("1")).toMatchObject({ id: "1", title: "one" })

    const reloaded = createRows()
    await reloaded.collection.preload()
    expect(reloaded.collection.get("1")).toMatchObject({ id: "1", title: "one" })

    triggerDb.exec("DROP TRIGGER fail_delete")
    await synced.replace([], () => true)
    expect(synced.collection.get("1")).toBeUndefined()
  } finally {
    triggerDb.close()
  }
})

test("a failed update rolls back a filtered live query", async () => {
  const synced = createRows()
  await synced.upsert([{ id: "1", title: "one" }])
  synced.collection.createIndex((row) => row.title, { indexType: BasicIndex })
  const changed = createLiveQueryCollection((query) =>
    query
      .from({ row: synced.collection })
      .where(({ row }) => eq(row.title, "changed"))
      .select(({ row }) => ({ id: row.id, title: row.title })),
  )
  await changed.preload()
  const observed: string[] = []
  const subscription = changed.subscribeChanges(
    (changes) => observed.push(...changes.map((change) => change.type)),
    { includeInitialState: true },
  )
  const triggerDb = new Database(db.file)
  const table = createPersistedTableName("rows", "c")
  triggerDb.exec(
    `CREATE TRIGGER fail_update BEFORE INSERT ON "${table}" BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;`,
  )
  try {
    await expect(synced.upsert([{ id: "1", title: "changed" }])).rejects.toThrow(
      "injected persistence failure",
    )
    expect(observed).toContain("insert")
    expect(observed.at(-1)).toBe("delete")
    expect(changed.size).toBe(0)
  } finally {
    subscription.unsubscribe()
    triggerDb.close()
  }
})

test("a failed update removes an optional field absent from the committed row", async () => {
  const synced = createRows()
  await synced.upsert([{ id: "1", title: "one" }])
  const observed: Array<{ value: number | undefined; ownsField: boolean }> = []
  const subscription = synced.collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.key === "1" && change.type !== "delete") {
          observed.push({
            value: change.value.pinOrder,
            ownsField: Object.hasOwn(change.value, "pinOrder"),
          })
        }
      }
    },
    { includeInitialState: true },
  )
  const triggerDb = new Database(db.file)
  const table = createPersistedTableName("rows", "c")
  triggerDb.exec(
    `CREATE TRIGGER fail_update BEFORE INSERT ON "${table}" BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;`,
  )
  try {
    await expect(synced.upsert([{ id: "1", title: "one", pinOrder: 7 }])).rejects.toThrow(
      "injected persistence failure",
    )
    expect(observed.at(-2)).toEqual({ value: 7, ownsField: true })
    expect(observed.at(-1)).toEqual({ value: undefined, ownsField: false })
    expect(Object.hasOwn(synced.collection.get("1")!, "pinOrder")).toBe(false)

    const reloaded = createRows()
    await reloaded.collection.preload()
    expect(Object.hasOwn(reloaded.collection.get("1")!, "pinOrder")).toBe(false)
  } finally {
    subscription.unsubscribe()
    triggerDb.close()
  }
})

function createRows() {
  return createSyncedCollection<Row, string>({
    id: "rows",
    getKey: (row) => row.id,
    persistence: db.open(),
    schemaVersion: 1,
  })
}
