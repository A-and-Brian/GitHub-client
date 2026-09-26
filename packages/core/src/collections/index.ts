import { type Collection, createCollection, localOnlyCollectionOptions } from "@tanstack/db"
import {
  type PersistedCollectionPersistence,
  persistedCollectionOptions,
} from "@tanstack/db-sqlite-persistence-core"
import type { DraftComment } from "../actions/reviews"
import type {
  Group,
  Job,
  PullRequest,
  PullRequestDetail,
  PullRequestFiles,
  Repo,
  Workflow,
  WorkflowRun,
} from "../domain/types"
import type { InboxPreference } from "../inbox"
import { createSyncedCollection } from "./synced"

export type { SyncedCollection } from "./synced"

/** All client-side data. Screens read these collections and never touch SQL. */
export function createCollections(persistence?: PersistedCollectionPersistence) {
  const synced = <T extends object, K extends string | number>(
    id: string,
    getKey: (row: T) => K,
    schemaVersion = 1,
  ) => createSyncedCollection<T, K>({ id, getKey, persistence, schemaVersion })

  return {
    groups: synced<Group, string>("groups", (g) => g.id),
    repos: synced<Repo, string>("repos", (r) => r.fullName),
    pulls: synced<PullRequest, string>("pulls", (p) => p.key),
    inboxPreferences: synced<InboxPreference, string>("inbox-preferences", (p) => p.key),
    pullDetails: synced<PullRequestDetail, string>("pull-details", (p) => p.key),
    pullFiles: synced<PullRequestFiles, string>("pull-files", (p) => p.key),
    workflowRuns: synced<WorkflowRun, number>("workflow-runs", (r) => r.id),
    jobs: synced<Job, number>("jobs", (j) => j.id),
    workflows: synced<Workflow, number>("workflows", (w) => w.id),
    drafts: createDraftsCollection(persistence),
  }
}

export type Collections = ReturnType<typeof createCollections>

/** Review comments not yet submitted. Local only: they never sync from GitHub. */
function createDraftsCollection(
  persistence?: PersistedCollectionPersistence,
): Collection<DraftComment, string> {
  const base = { id: "draft-comments", getKey: (d: DraftComment) => d.id }
  return (
    persistence
      ? createCollection(
          persistedCollectionOptions<DraftComment, string>({
            ...base,
            persistence,
            schemaVersion: 1,
          }),
        )
      : createCollection(localOnlyCollectionOptions<DraftComment, string>(base))
  ) as Collection<DraftComment, string>
}
