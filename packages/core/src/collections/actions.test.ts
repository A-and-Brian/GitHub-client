import { afterEach, expect, test } from "vitest"
import type { CanonicalActor, CanonicalRepository, Job, WorkflowRun } from "../domain/types"
import { tempDatabase } from "../test/persistence"
import { createActionsCollections } from "./actions"
import { NormalizedDatabase } from "./normalized"

const files: ReturnType<typeof tempDatabase>[] = []
afterEach(() => {
  for (const file of files.splice(0)) file.close()
})
function create(db: NormalizedDatabase) {
  db.table<CanonicalActor>("actors")
  db.table<CanonicalRepository>("repositories")
  return createActionsCollections(db)
}
const run: WorkflowRun = {
  id: 1,
  repo: "acme/api",
  workflowId: 2,
  name: "Build",
  displayTitle: "Build change",
  runNumber: 3,
  runAttempt: 1,
  event: "pull_request",
  status: "completed",
  conclusion: "success",
  headBranch: "feature",
  headSha: "abc",
  actor: "octo",
  createdAt: "2026-09-01",
  updatedAt: "2026-09-02",
  url: "https://github.com/acme/api/actions/runs/1",
}
const job: Job = {
  id: 10,
  runId: 1,
  repo: "acme/api",
  name: "test",
  status: "completed",
  conclusion: "success",
  startedAt: null,
  completedAt: null,
  url: "https://github.com/acme/api/actions/runs/1/jobs/10",
  steps: [
    {
      number: 1,
      name: "Build",
      status: "completed",
      conclusion: "success",
      startedAt: null,
      completedAt: null,
    },
  ],
}

test("Actions persists parent references and individual steps, and hydrates after restart", async () => {
  const file = tempDatabase()
  files.push(file)
  const db = new NormalizedDatabase(file.open())
  const actions = create(db)
  await actions.workflowRuns.upsert([run])
  await actions.jobs.upsert([job])
  const stored = [...db.table("jobs").collection.values()][0]!
  expect(stored).toHaveProperty("runKey")
  expect(stored).not.toHaveProperty("steps")
  expect(stored).not.toHaveProperty("repo")
  expect(db.table("jobSteps").collection.size).toBe(1)
  const reopened = create(new NormalizedDatabase(file.open()))
  await reopened.jobs.collection.preload()
  expect(reopened.jobs.collection.get(10)).toMatchObject(job)
  await reopened.workflowRuns.collection.preload()
  expect(reopened.workflowRuns.collection.get(1)).toMatchObject(run)
})

test("replacing one run's jobs removes only its steps and keeps another run intact", async () => {
  const db = new NormalizedDatabase()
  const actions = create(db)
  await actions.jobs.upsert([job, { ...job, id: 11, runId: 2 }])
  await actions.jobs.replace([], (row) => row.runId === 1)
  expect([...actions.jobs.collection.keys()]).toEqual([11])
  expect(db.table("jobSteps").collection.size).toBe(1)
})

test("an older run attempt cannot replace a newer observed attempt", async () => {
  const actions = create(new NormalizedDatabase())
  await actions.workflowRuns.upsert([{ ...run, runAttempt: 2, status: "in_progress" }])
  await actions.workflowRuns.upsert([run])
  expect(actions.workflowRuns.collection.get(1)?.runAttempt).toBe(2)
  expect(actions.workflowRuns.collection.get(1)?.status).toBe("in_progress")
})
