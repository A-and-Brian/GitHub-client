import { createNodeSQLitePersistence } from "@tanstack/node-db-sqlite-persistence"
import Database from "better-sqlite3"
import { afterEach, expect, test } from "vitest"
import { tempDatabase } from "../test/persistence"
import { createCollections } from "./index"
import { NormalizedDatabase, type ScopedRow } from "./normalized"

const databases: ReturnType<typeof tempDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

test("canonical tables share one global SQLite schema initialization", async () => {
  const statements: string[] = []
  const sqlite = new Database(":memory:", { verbose: (sql) => statements.push(String(sql)) })
  try {
    const collections = createCollections(createNodeSQLitePersistence({ database: sqlite }))
    await collections.database.ready()
    await Promise.all([
      collections.groups.collection.preload(),
      collections.pulls.collection.preload(),
      collections.repositoryResources.collection.preload(),
    ])
    expect(
      statements.filter((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS collection_registry")),
    ).toHaveLength(1)
  } finally {
    sqlite.close()
  }
})

function fixture(db: NormalizedDatabase) {
  const records = db.table<ScopedRow & { id: string; title: string }>("records")
  const memberships = db.table<ScopedRow & { group: string; recordKey: string }>("memberships")
  const view = db.projection<{ id: string; title: string }, string>(
    "records",
    (row) => row.id,
    () => db.rows(records).map(({ id, title }) => ({ id, title })),
    async (rows) => {
      await records.upsert(rows.map((row) => ({ ...row, key: db.key(row.id), scope: db.scope })))
    },
    async (ids) => {
      await records.remove(ids.map((id) => db.key(id)))
    },
  )
  const groups = db.projection<{ id: string; title: string }, string>(
    "groups",
    (row) => row.id,
    () =>
      db.rows(memberships).flatMap((member) => {
        const record = records.collection.get(member.recordKey)
        return record ? [{ id: member.group, title: record.title }] : []
      }),
    async () => {},
    async () => {},
  )
  return { records, memberships, view, groups }
}

test("one canonical update publishes every dependent view and survives SQLite reopen", async () => {
  const file = tempDatabase()
  databases.push(file)
  const db = new NormalizedDatabase(file.open())
  const { view, groups, memberships, records } = fixture(db)
  await view.upsert([{ id: "pr", title: "before" }])
  await db.mutate(() =>
    memberships.upsert(
      ["one", "two"].map((group) => ({
        key: db.key(group),
        scope: db.scope,
        group,
        recordKey: db.key("pr"),
      })),
    ),
  )
  await view.upsert([{ id: "pr", title: "after" }])
  expect([...groups.collection.values()].map((row) => row.title)).toEqual(["after", "after"])
  expect(records.collection.size).toBe(1)
  const reopened = new NormalizedDatabase(file.open())
  const next = fixture(reopened)
  await next.groups.collection.preload()
  expect([...next.groups.collection.values()].map((row) => row.title)).toEqual(["after", "after"])
})

test("scope changes isolate identical entity IDs and queued writes", async () => {
  const db = new NormalizedDatabase()
  const { view } = fixture(db)
  await db.setScope("https://api.github.com", "alice")
  await view.upsert([{ id: "pr", title: "Alice" }])
  await db.setScope("https://api.github.com", "bob")
  expect(view.collection.size).toBe(0)
  await view.upsert([{ id: "pr", title: "Bob" }])
  await db.setScope("https://api.github.com", "alice")
  expect(view.collection.get("pr")?.title).toBe("Alice")
  await db.clear()
  await db.setScope("https://api.github.com", "bob")
  expect(view.collection.size).toBe(0)
})

test("switching to an incomplete account never retains the previous account's view", async () => {
  const db = new NormalizedDatabase()
  const { view } = fixture(db)
  await db.setScope("https://api.github.com", "bob")
  await db
    .table<ScopedRow & { complete: boolean }>("writeObservations")
    .upsert([{ key: db.key("write", "records"), scope: db.scope, complete: false }])
  await db.setScope("https://api.github.com", "alice")
  await view.upsert([{ id: "pr", title: "Alice's private PR" }])
  await db.setScope("https://api.github.com", "bob")
  expect(view.collection.size).toBe(0)
})

test("local optimistic edits await canonical persistence without deadlocking", async () => {
  const db = new NormalizedDatabase()
  const { view, records } = fixture(db)
  await view.collection.preload()
  await view.collection.insert({ id: "draft", title: "first" }).isPersisted.promise
  await view.collection.update("draft", (row) => {
    row.title = "edited"
  }).isPersisted.promise
  expect(records.collection.get(db.key("draft"))?.title).toBe("edited")
  await view.collection.delete("draft").isPersisted.promise
  expect(records.collection.size).toBe(0)
})

test("an interrupted multi-table write stays incomplete after reopening and recovers on retry", async () => {
  const file = tempDatabase()
  databases.push(file)
  const create = (db: NormalizedDatabase, fail: boolean) => {
    const parents = db.table<ScopedRow & { title: string }>("parents")
    const children = db.table<ScopedRow & { parent: string }>("children")
    return db.projection<{ id: string; title: string }, string>(
      "joined",
      (row) => row.id,
      () =>
        db.rows(children).flatMap((row) => {
          const parent = parents.collection.get(row.parent)
          return parent ? [{ id: row.key, title: parent.title }] : []
        }),
      async (rows) => {
        for (const row of rows) {
          await parents.upsert([{ key: db.key(row.id), scope: db.scope, title: row.title }])
          if (fail) throw new Error("interrupted")
          await children.upsert([
            { key: db.key("child", row.id), scope: db.scope, parent: db.key(row.id) },
          ])
        }
      },
      async () => {},
    )
  }
  const failed = create(new NormalizedDatabase(file.open()), true)
  await expect(failed.upsert([{ id: "one", title: "durable parent" }])).rejects.toThrow(
    "interrupted",
  )
  const recovered = create(new NormalizedDatabase(file.open()), false)
  await recovered.collection.preload()
  expect(recovered.collection.size).toBe(0)
  await recovered.upsert([{ id: "one", title: "complete" }])
  expect([...recovered.collection.values()].map((row) => row.title)).toEqual(["complete"])
})
