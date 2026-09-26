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
