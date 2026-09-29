import type { CanonicalActor, CanonicalRepository, Repo } from "../domain/types"
import type { NormalizedDatabase } from "./normalized"

export interface ActorInput {
  id?: string
  nodeId?: string
  databaseId?: number
  login: string
  kind?: "user" | "organization"
  name?: string | null
  avatarUrl?: string | null
}

export type RepositoryInput = Partial<
  Omit<CanonicalRepository, "key" | "scope" | "id" | "fullName" | "name">
> &
  Partial<Omit<Repo, "owner" | "fullName" | "name">> & {
    id?: string
    nodeId?: string
    databaseId?: number
    fullName: string
    ownerLogin?: string
    ownerId?: string | null
    ownerKind?: "user" | "organization"
    ownerNodeId?: string
    ownerDatabaseId?: number
    name?: string
  }

export function readActor(db: NormalizedDatabase, key: string): CanonicalActor | undefined {
  const row = db.table<CanonicalActor>("actors").collection.get(key)
  return row?.scope === db.scope ? row : undefined
}

export function findActor(db: NormalizedDatabase, login: string): CanonicalActor | undefined {
  const normalized = login.toLocaleLowerCase()
  return db
    .rows(db.table<CanonicalActor>("actors"))
    .find((row) => row.login.toLocaleLowerCase() === normalized)
}

/** Upserts one scoped actor. The row key remains stable if a later response adds its ID. */
export async function ensureActor(db: NormalizedDatabase, input: ActorInput): Promise<string> {
  const table = db.table<CanonicalActor>("actors")
  const rows = new Map(db.rows(table).map((row) => [row.key, row]))
  const key = resolveActorRow(db, input, rows)
  await table.upsert([rows.get(key)!])
  return key
}

function resolveActorRow(
  db: NormalizedDatabase,
  input: ActorInput,
  rows: Map<string, CanonicalActor>,
): string {
  const nodeId = input.nodeId ?? input.id
  const login = input.login.trim()
  const normalizedLogin = login.toLocaleLowerCase()
  const existing =
    (nodeId ? [...rows.values()].find((row) => row.nodeId === nodeId) : undefined) ??
    [...rows.values()].find(
      (row) =>
        row.login.toLocaleLowerCase() === normalizedLogin &&
        (!nodeId || !row.nodeId || row.nodeId === nodeId),
    )
  const key = existing?.key ?? db.key("actor", nodeId ?? normalizedLogin)
  rows.set(key, {
    key,
    scope: db.scope,
    id: key,
    nodeId: nodeId ?? existing?.nodeId,
    databaseId: input.databaseId ?? existing?.databaseId,
    kind: input.kind ?? existing?.kind ?? "user",
    login: input.login || existing?.login || "",
    name: input.name === undefined ? (existing?.name ?? null) : input.name,
    avatarUrl: input.avatarUrl === undefined ? (existing?.avatarUrl ?? null) : input.avatarUrl,
  })
  return key
}

export function readRepository(
  db: NormalizedDatabase,
  key: string,
): CanonicalRepository | undefined {
  const row = db.table<CanonicalRepository>("repositories").collection.get(key)
  return row?.scope === db.scope ? row : undefined
}

export function findRepository(
  db: NormalizedDatabase,
  fullName: string,
): CanonicalRepository | undefined {
  const route = fullName.toLocaleLowerCase()
  return db
    .rows(db.table<CanonicalRepository>("repositories"))
    .find((row) => row.fullName.toLocaleLowerCase() === route)
}

/**
 * Upserts one repository by node ID when available, otherwise by its current route.
 * A route-keyed row is enriched in place when a later response supplies its ID.
 */
export async function ensureRepository(
  db: NormalizedDatabase,
  input: RepositoryInput,
): Promise<string> {
  return (await ensureRepositories(db, [input]))[0]!
}

/** Writes one batch of repository identities after batching shared owner rows. */
export async function ensureRepositories(
  db: NormalizedDatabase,
  inputs: RepositoryInput[],
): Promise<string[]> {
  if (inputs.length === 0) return []

  const actorTable = db.table<CanonicalActor>("actors")
  const stagedActors = new Map(db.rows(actorTable).map((row) => [row.key, row]))
  const touchedActors = new Set<string>()
  const ownerKeys = new Map<RepositoryInput, string | null>()
  for (const input of inputs) {
    if (input.ownerId !== undefined) {
      ownerKeys.set(input, input.ownerId)
      continue
    }
    const key = resolveActorRow(
      db,
      {
        id: input.ownerNodeId,
        databaseId: input.ownerDatabaseId,
        login: input.ownerLogin ?? input.fullName.split("/")[0] ?? "",
        kind: input.ownerKind,
      },
      stagedActors,
    )
    touchedActors.add(key)
    ownerKeys.set(input, key)
  }

  const repoTable = db.table<CanonicalRepository>("repositories")
  const stagedRepositories = new Map(db.rows(repoTable).map((row) => [row.key, row]))
  const routeKeys = new Map(
    [...stagedRepositories.values()].map((row) => [row.fullName.toLocaleLowerCase(), row.key]),
  )
  const nodeKeys = new Map(
    [...stagedRepositories.values()].flatMap((row) =>
      row.nodeId ? [[row.nodeId, row.key] as const] : [],
    ),
  )
  const result: string[] = []

  for (const input of inputs) {
    const nodeId = input.nodeId ?? input.id
    const route = input.fullName.trim()
    const routeKey = routeKeys.get(route.toLocaleLowerCase())
    const existingKey =
      (nodeId ? nodeKeys.get(nodeId) : undefined) ??
      (routeKey &&
      (!nodeId ||
        !stagedRepositories.get(routeKey)?.nodeId ||
        stagedRepositories.get(routeKey)?.nodeId === nodeId)
        ? routeKey
        : undefined)
    const previous = existingKey ? stagedRepositories.get(existingKey) : undefined
    const key = previous?.key ?? db.key("repository", nodeId ?? route.toLocaleLowerCase())
    const name = input.name ?? input.fullName.split("/")[1] ?? ""
    const fields = Object.fromEntries(
      Object.entries(input).filter(
        ([field]) =>
          ![
            "id",
            "nodeId",
            "databaseId",
            "fullName",
            "ownerLogin",
            "ownerId",
            "ownerKind",
            "ownerNodeId",
            "ownerDatabaseId",
            "name",
          ].includes(field),
      ),
    )
    const repository: CanonicalRepository = {
      ...previous,
      ...fields,
      key,
      scope: db.scope,
      id: key,
      nodeId: nodeId ?? previous?.nodeId,
      databaseId: input.databaseId ?? previous?.databaseId,
      ownerId: ownerKeys.get(input) ?? previous?.ownerId ?? null,
      fullName: route,
      name,
    }
    stagedRepositories.set(key, repository)
    routeKeys.set(route.toLocaleLowerCase(), key)
    if (nodeId) nodeKeys.set(nodeId, key)
    result.push(key)
  }

  const actorWrites = [...touchedActors].map((key) => stagedActors.get(key)!)
  if (actorWrites.length > 0) await actorTable.upsert(actorWrites)
  const repositoryWrites = result
    .map((key) => stagedRepositories.get(key)!)
    .filter((row, index) => result.indexOf(row.key) === index)
  if (repositoryWrites.length > 0) await repoTable.upsert(repositoryWrites)
  return result
}
