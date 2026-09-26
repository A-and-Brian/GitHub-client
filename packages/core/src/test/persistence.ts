import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNodeSQLitePersistence } from "@tanstack/node-db-sqlite-persistence"
import Database from "better-sqlite3"

/** A SQLite file in a temp directory; `open` can be called again to simulate a restart. */
export function tempDatabase() {
  const file = join(mkdtempSync(join(tmpdir(), "github-client-")), "db.sqlite")
  const opened: Database.Database[] = []
  return {
    file,
    open() {
      const database = new Database(file)
      opened.push(database)
      return createNodeSQLitePersistence({ database })
    },
    close() {
      for (const database of opened.splice(0)) database.close()
    },
  }
}
