import { createPersistedTableName } from "@tanstack/db-sqlite-persistence-core"
import Database from "better-sqlite3"
import { afterEach, beforeEach, expect, test } from "vitest"
import { tempDatabase } from "../test/persistence"
import { createSyncedCollection } from "./synced"

type Row = { id: string; title: string }

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

test("writes jobs after an empty persisted collection is cleaned up and restarted", async () => {
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
