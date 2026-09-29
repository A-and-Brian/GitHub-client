import type { PersistedCollectionPersistence } from "@tanstack/db-sqlite-persistence-core"
import { createActionsCollections } from "./actions"
import { createLocalCollections } from "./local"
import { NormalizedDatabase } from "./normalized"
import { createPullCollections } from "./pulls"
import { createResourceCollection } from "./resources"

export type { SyncedCollection } from "./synced"

/** Canonical persisted tables; UI collections below are transient joins. */
export function createCollections(persistence?: PersistedCollectionPersistence) {
  const database = new NormalizedDatabase(persistence)
  const pulls = createPullCollections(database)
  return {
    database,
    groups: pulls.groups,
    repos: pulls.repos,
    pulls: pulls.pulls,
    pullDetails: pulls.pullDetails,
    pullFiles: pulls.pullFiles,
    ...createLocalCollections(database),
    ...createActionsCollections(database),
    repositoryResources: createResourceCollection(database, pulls),
  }
}

export type Collections = ReturnType<typeof createCollections>
