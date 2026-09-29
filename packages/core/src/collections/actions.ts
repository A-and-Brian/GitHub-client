import type { Job, JobStep, Workflow, WorkflowRun } from "../domain/types"
import { ensureActor, ensureRepository, readActor, readRepository } from "./identities"
import type { NormalizedDatabase, ScopedRow } from "./normalized"

export interface WorkflowRow extends ScopedRow, Omit<Workflow, "repo"> {
  repositoryKey: string
  listed: boolean
}
export interface RunRow extends ScopedRow {
  listed?: boolean
  id: number
  repositoryKey: string
  workflowKey?: string
  actorKey?: string | null
  displayTitle?: string
  runNumber?: number
  runAttempt?: number
  event?: string
  status?: string
  conclusion?: string | null
  headBranch?: string | null
  headSha?: string
  createdAt?: string
  updatedAt?: string
  url?: string
}
interface JobRow extends ScopedRow, Omit<Job, "repo" | "runId" | "steps"> {
  runKey: string
}
interface StepRow extends ScopedRow, JobStep {
  jobKey: string
}

export function createActionsCollections(db: NormalizedDatabase) {
  const workflowRows = db.table<WorkflowRow>("workflows")
  const runRows = db.table<RunRow>("workflowRuns")
  const jobRows = db.table<JobRow>("jobs")
  const stepRows = db.table<StepRow>("jobSteps")
  const workflowKey = (id: number) => db.key("workflow", id)
  const runKey = (id: number) => db.key("workflowRun", id)
  const jobKey = (id: number) => db.key("job", id)

  const workflows = db.projection<Workflow, number>(
    "workflows",
    (row) => row.id,
    () =>
      db.rows(workflowRows).flatMap((row) => {
        const repository = readRepository(db, row.repositoryKey)
        return repository && row.listed
          ? [
              {
                id: row.id,
                repo: repository.fullName,
                name: row.name,
                path: row.path,
                state: row.state,
              },
            ]
          : []
      }),
    async (rows) => {
      for (const row of rows) {
        const repositoryKey = await ensureRepository(db, {
          fullName: row.repo,
          ownerLogin: row.repo.split("/")[0]!,
        })
        const { repo: _repo, ...fields } = row
        await workflowRows.upsert([
          { ...fields, key: workflowKey(row.id), scope: db.scope, repositoryKey, listed: true },
        ])
      }
    },
    async (ids) => {
      for (const id of ids) {
        const row = workflowRows.collection.get(workflowKey(id))
        if (row) await workflowRows.upsert([{ ...row, listed: false }])
      }
    },
  )
  const workflowRuns = db.projection<WorkflowRun, number>(
    "workflowRuns",
    (row) => row.id,
    () =>
      db.rows(runRows).flatMap((row) => {
        const repository = readRepository(db, row.repositoryKey)
        const workflow = row.workflowKey ? workflowRows.collection.get(row.workflowKey) : undefined
        if (!repository || !workflow || !row.listed || row.updatedAt === undefined) return []
        const actor = row.actorKey ? readActor(db, row.actorKey) : undefined
        return [
          {
            id: row.id,
            repo: repository.fullName,
            workflowId: workflow.id,
            name: workflow.name,
            displayTitle: row.displayTitle!,
            runNumber: row.runNumber!,
            runAttempt: row.runAttempt!,
            event: row.event!,
            status: row.status!,
            conclusion: row.conclusion ?? null,
            headBranch: row.headBranch ?? null,
            headSha: row.headSha!,
            actor: actor?.login ?? null,
            createdAt: row.createdAt!,
            updatedAt: row.updatedAt,
            url: row.url!,
          },
        ]
      }),
    async (rows) => {
      for (const row of rows) {
        const key = runKey(row.id)
        const previous = runRows.collection.get(key)
        if (
          previous?.updatedAt &&
          (previous.updatedAt > row.updatedAt || (previous.runAttempt ?? 0) > row.runAttempt)
        )
          continue
        const repositoryKey = await ensureRepository(db, {
          fullName: row.repo,
          ownerLogin: row.repo.split("/")[0]!,
        })
        const parentKey = workflowKey(row.workflowId)
        if (!workflowRows.collection.has(parentKey)) {
          await workflowRows.upsert([
            {
              key: parentKey,
              scope: db.scope,
              id: row.workflowId,
              repositoryKey,
              name: row.name,
              path: "",
              state: "",
              listed: false,
            },
          ])
        }
        const actorKey = row.actor
          ? await ensureActor(db, {
              login: row.actor,
              nodeId: row.actorId,
              avatarUrl: row.actorAvatarUrl,
            })
          : null
        const {
          repo: _repo,
          workflowId: _workflowId,
          name: _name,
          actor: _actor,
          actorId: _actorId,
          actorAvatarUrl: _avatar,
          ...fields
        } = row
        await runRows.upsert([
          {
            ...fields,
            key,
            scope: db.scope,
            repositoryKey,
            workflowKey: parentKey,
            actorKey,
            listed: true,
          },
        ])
      }
    },
    async (ids) => {
      // Jobs retain their parent identity even after a run leaves the latest-runs list.
      for (const id of ids) {
        const row = runRows.collection.get(runKey(id))
        if (!row) continue
        await runRows.upsert([{ ...row, listed: false }])
      }
    },
  )
  const jobs = db.projection<Job, number>(
    "jobs",
    (row) => row.id,
    () =>
      db.rows(jobRows).flatMap((row) => {
        const run = runRows.collection.get(row.runKey)
        const repository = run ? readRepository(db, run.repositoryKey) : undefined
        if (!run || !repository) return []
        const { key, scope: _scope, runKey: _runKey, ...fields } = row
        return [
          {
            ...fields,
            repo: repository.fullName,
            runId: run.id,
            steps: db
              .rows(stepRows)
              .filter((step) => step.jobKey === key)
              .sort((a, b) => a.number - b.number)
              .map(({ key: _key, scope: _scope, jobKey: _jobKey, ...step }) => step),
          },
        ]
      }),
    async (rows) => {
      for (const row of rows) {
        const parentKey = runKey(row.runId)
        if (!runRows.collection.has(parentKey)) {
          const repositoryKey = await ensureRepository(db, {
            fullName: row.repo,
            ownerLogin: row.repo.split("/")[0]!,
          })
          await runRows.upsert([{ key: parentKey, scope: db.scope, id: row.runId, repositoryKey }])
        }
        const key = jobKey(row.id)
        const { repo: _repo, runId: _runId, steps, ...fields } = row
        await jobRows.upsert([{ ...fields, key, scope: db.scope, runKey: parentKey }])
        await stepRows.replace(
          steps.map((step) => ({
            ...step,
            key: db.key("jobStep", row.id, step.number),
            scope: db.scope,
            jobKey: key,
          })),
          (step) => step.scope === db.scope && step.jobKey === key,
        )
      }
    },
    async (ids) => {
      const keys = new Set(ids.map(jobKey))
      await stepRows.remove(
        db
          .rows(stepRows)
          .filter((step) => keys.has(step.jobKey))
          .map((step) => step.key),
      )
      await jobRows.remove([...keys])
    },
  )
  return { workflows, workflowRuns, jobs }
}
