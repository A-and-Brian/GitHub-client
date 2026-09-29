import { expect, test } from "vitest"
import { ensureActor, ensureRepository, readActor, readRepository } from "./identities"
import { createCollections } from "./index"

test("stable identities enrich route stubs and keep references through renames", async () => {
  const { database: db } = createCollections()
  await db.setScope("https://api.github.com", "alice")
  let actorKey = ""
  let repositoryKey = ""
  await db.mutate(async () => {
    actorKey = await ensureActor(db, { login: "owner" })
    repositoryKey = await ensureRepository(db, { fullName: "owner/project" })
    expect(await ensureActor(db, { nodeId: "U_1", login: "owner", avatarUrl: "avatar" })).toBe(
      actorKey,
    )
    expect(
      await ensureRepository(db, {
        nodeId: "R_1",
        fullName: "owner/project",
        description: "description",
      }),
    ).toBe(repositoryKey)
    expect(await ensureActor(db, { nodeId: "U_1", login: "renamed" })).toBe(actorKey)
    expect(
      await ensureRepository(db, {
        nodeId: "R_1",
        fullName: "renamed/project",
        ownerNodeId: "U_1",
      }),
    ).toBe(repositoryKey)
  })
  expect(readRepository(db, repositoryKey)).toMatchObject({
    ownerId: actorKey,
    fullName: "renamed/project",
    description: "description",
  })
  expect(readActor(db, actorKey)).toMatchObject({ login: "renamed", avatarUrl: "avatar" })
  await db.setScope("https://enterprise.example/api/v3", "alice")
  expect(readRepository(db, repositoryKey)).toBeUndefined()
  await db.mutate(async () => {
    expect(
      await ensureRepository(db, {
        nodeId: "R_1",
        fullName: "renamed/project",
        ownerNodeId: "U_1",
      }),
    ).not.toBe(repositoryKey)
  })
  await db.setScope("https://api.github.com", "alice")
  expect(readRepository(db, repositoryKey)?.ownerId).toBe(actorKey)
})
