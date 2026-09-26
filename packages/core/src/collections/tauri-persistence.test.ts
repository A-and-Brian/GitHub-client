import {
  createSQLiteCorePersistenceAdapter,
  type SQLiteDriver,
} from "@tanstack/db-sqlite-persistence-core"
import Database from "better-sqlite3"
import { expect, test } from "vitest"
import { createSyncedCollection } from "./synced"

function createPersistence(errorMode: "string" | "error" | "unrelated") {
  const database = new Database(":memory:")
  const driver: SQLiteDriver = {
    async exec(sql: string) {
      if (errorMode === "unrelated" && sql.includes("ALTER TABLE applied_tx")) {
        throw "unrelated database failure"
      }
      try {
        database.exec(sql)
      } catch (error) {
        if (errorMode === "string" && error instanceof Error) throw error.message
        throw error
      }
    },
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []) {
      return database.prepare(sql).all(...([...params] as never[])) as ReadonlyArray<T>
    },
    async run(sql: string, params: ReadonlyArray<unknown> = []) {
      database.prepare(sql).run(...([...params] as never[]))
    },
    async transaction<T>(run: (transactionDriver: SQLiteDriver) => Promise<T>) {
      database.exec("BEGIN")
      try {
        const result = await run(driver)
        database.exec("COMMIT")
        return result
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
  }
  return {
    database,
    persistence: { adapter: createSQLiteCorePersistenceAdapter({ driver }) },
  }
}

test.each(["string", "error"] as const)(
  "initializes and writes when SQLite reports duplicate columns as %s",
  async (errorMode) => {
    const { database, persistence } = createPersistence(errorMode)
    try {
      const synced = createSyncedCollection({
        id: "rows",
        getKey: (row: { id: string }) => row.id,
        persistence,
        schemaVersion: 1,
      })

      await expect(synced.upsert([{ id: "one" }])).resolves.toBeUndefined()
      expect(synced.collection.get("one")).toMatchObject({ id: "one" })
    } finally {
      database.close()
    }
  },
)

test("rethrows unrelated string errors during initialization", async () => {
  const { database, persistence } = createPersistence("unrelated")
  try {
    await expect(persistence.adapter.getStreamPosition!("rows")).rejects.toBe(
      "unrelated database failure",
    )
  } finally {
    database.close()
  }
})
