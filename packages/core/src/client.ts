import * as reviews from "./actions/reviews"
import * as workflows from "./actions/workflows"
import { checkToken, TokenAuthProvider, type TokenCheck } from "./auth/auth"
import { type Collections, createCollections } from "./collections"
import type { MergeMethod } from "./domain/types"
import { prKey } from "./domain/types"
import { GraphQLClient } from "./github/graphql"
import { RestClient } from "./github/rest"
import type { Platform } from "./platform"
import { syncRunJobs, syncWorkflowRuns, syncWorkflows } from "./sync/actions"
import { syncGroups } from "./sync/groups"
import { Poller } from "./sync/poller"
import { syncPullDetail, syncPullFiles } from "./sync/pull-detail"
import { syncGroupPulls } from "./sync/pulls"

const ACTIVE_MS = 15_000
const IDLE_MS = 2 * 60_000
const GROUPS_IDLE_MS = 15 * 60_000

export const jobKeys = {
  groups: "groups",
  groupPulls: (groupId: string) => `pulls:${groupId}`,
  pull: (repo: string, number: number) => `pull:${prKey(repo, number)}`,
  runs: (repo: string) => `runs:${repo}`,
  runJobs: (runId: number) => `run-jobs:${runId}`,
  workflows: (repo: string) => `workflows:${repo}`,
}

/**
 * The GitHub client: auth, API clients, collections, sync scheduling, and
 * write actions. One instance per app.
 */
export class GitHubClient {
  readonly auth: TokenAuthProvider
  readonly rest: RestClient
  readonly graphql: GraphQLClient
  readonly poller: Poller
  readonly collections: Collections
  readonly platform: Platform
  private syncing = false

  constructor(platform: Platform) {
    this.platform = platform
    this.auth = new TokenAuthProvider(platform)
    this.rest = new RestClient({ fetch: platform.fetch, getToken: () => this.auth.getToken() })
    this.graphql = new GraphQLClient(this.rest)
    this.poller = new Poller(this.rest.rateLimits)
    this.collections = createCollections(platform.persistence)
  }

  /** Validates `token` and stores it. Throws when GitHub rejects it. */
  async signIn(token: string): Promise<TokenCheck> {
    const probe = new RestClient({ fetch: this.platform.fetch, getToken: () => token })
    const check = await checkToken(probe)
    await this.auth.signIn(token)
    return check
  }

  async signOut(): Promise<void> {
    await this.auth.signOut()
    this.poller.stop()
  }

  /** Starts background sync of groups and of every group's pull requests. */
  startSync(): void {
    if (this.syncing) return
    this.syncing = true
    this.poller.register({
      key: jobKeys.groups,
      activeMs: ACTIVE_MS,
      idleMs: GROUPS_IDLE_MS,
      resource: "core",
      run: async () => {
        await syncGroups(this.rest, this.collections.groups, this.collections.repos)
        this.registerGroupJobs()
      },
    })
    // Groups restored from SQLite start polling before the first groups sync finishes.
    this.registerGroupJobs()
  }

  private readonly groupJobs = new Set<string>()

  private registerGroupJobs(): void {
    const current = new Set<string>()
    for (const group of this.collections.groups.collection.values()) {
      const key = jobKeys.groupPulls(group.id)
      current.add(key)
      this.poller.register(this.groupPullsJob(group.id))
      // A view may already watch a group that just appeared; load it now, not on its next tick.
      if (!this.groupJobs.has(key)) void this.poller.refresh(key)
    }
    for (const key of this.groupJobs) if (!current.has(key)) this.poller.unregister(key)
    this.groupJobs.clear()
    for (const key of current) this.groupJobs.add(key)
  }

  private groupPullsJob(groupId: string) {
    return {
      key: jobKeys.groupPulls(groupId),
      activeMs: ACTIVE_MS,
      idleMs: IDLE_MS,
      resource: "graphql" as const,
      run: async () => {
        // Read the group when the job runs: it may not be loaded yet, and team repos change.
        const group = this.collections.groups.collection.get(groupId)
        if (group) await syncGroupPulls(this.graphql, group, this.collections.pulls)
      },
    }
  }

  watchGroup(groupId: string): () => void {
    return this.poller.watch(this.groupPullsJob(groupId))
  }

  /** Keeps a pull request's detail and files fresh while a view shows it. */
  watchPull(repo: string, number: number): () => void {
    return this.poller.watch({
      key: jobKeys.pull(repo, number),
      activeMs: ACTIVE_MS,
      idleMs: Number.POSITIVE_INFINITY,
      resource: "graphql",
      run: async () => {
        await syncPullDetail(this.graphql, repo, number, this.collections.pullDetails)
        const detail = this.collections.pullDetails.collection.get(prKey(repo, number))
        if (detail) {
          await syncPullFiles(this.rest, repo, number, detail.headOid, this.collections.pullFiles)
        }
      },
    })
  }

  watchRuns(repo: string): () => void {
    return this.poller.watch({
      key: jobKeys.runs(repo),
      activeMs: ACTIVE_MS,
      idleMs: Number.POSITIVE_INFINITY,
      resource: "core",
      run: () => syncWorkflowRuns(this.rest, repo, this.collections.workflowRuns),
    })
  }

  watchRunJobs(repo: string, runId: number): () => void {
    return this.poller.watch({
      key: jobKeys.runJobs(runId),
      activeMs: ACTIVE_MS,
      idleMs: Number.POSITIVE_INFINITY,
      resource: "core",
      run: () => syncRunJobs(this.rest, repo, runId, this.collections.jobs),
    })
  }

  watchWorkflows(repo: string): () => void {
    return this.poller.watch({
      key: jobKeys.workflows(repo),
      activeMs: 5 * 60_000,
      idleMs: Number.POSITIVE_INFINITY,
      resource: "core",
      run: () => syncWorkflows(this.rest, repo, this.collections.workflows),
    })
  }

  refresh(key: string): Promise<void> {
    return this.poller.refresh(key)
  }

  // Write actions. Each one refreshes the data it changed.

  async submitReview(
    repo: string,
    number: number,
    event: reviews.ReviewEvent,
    body: string,
  ): Promise<void> {
    const key = prKey(repo, number)
    const detail = this.collections.pullDetails.collection.get(key)
    if (!detail) throw new Error(`Pull request ${key} is not loaded`)
    const drafts = [...this.collections.drafts.values()].filter((d) => d.prKey === key)
    await reviews.submitReview(this.rest, {
      repo,
      number,
      commitId: detail.headOid,
      event,
      body,
      comments: drafts,
    })
    if (drafts.length > 0)
      await this.collections.drafts.delete(drafts.map((d) => d.id)).isPersisted.promise
    await this.refresh(jobKeys.pull(repo, number))
  }

  addDraft(draft: Omit<reviews.DraftComment, "id" | "createdAt">): void {
    this.collections.drafts.insert({
      ...draft,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    })
  }

  updateDraft(id: string, body: string): void {
    this.collections.drafts.update(id, (d) => {
      d.body = body
    })
  }

  deleteDraft(id: string): void {
    this.collections.drafts.delete(id)
  }

  async reply(repo: string, number: number, commentDatabaseId: number, body: string) {
    await reviews.replyToThread(this.rest, repo, number, commentDatabaseId, body)
    await this.refresh(jobKeys.pull(repo, number))
  }

  async comment(repo: string, number: number, body: string) {
    await reviews.commentOnPull(this.rest, repo, number, body)
    await this.refresh(jobKeys.pull(repo, number))
  }

  async setThreadResolved(repo: string, number: number, threadId: string, resolved: boolean) {
    await reviews.setThreadResolved(this.graphql, threadId, resolved)
    await this.refresh(jobKeys.pull(repo, number))
  }

  async merge(repo: string, number: number, method: MergeMethod) {
    const detail = this.collections.pullDetails.collection.get(prKey(repo, number))
    if (!detail) throw new Error("Pull request is not loaded")
    await reviews.mergePull(this.rest, repo, number, method, detail.headOid)
    await this.refresh(jobKeys.pull(repo, number))
  }

  async rerunRun(repo: string, runId: number, onlyFailed: boolean) {
    await (onlyFailed
      ? workflows.rerunFailedJobs(this.rest, repo, runId)
      : workflows.rerunRun(this.rest, repo, runId))
    await Promise.all([this.refresh(jobKeys.runs(repo)), this.refresh(jobKeys.runJobs(runId))])
  }

  async rerunJob(repo: string, runId: number, jobId: number) {
    await workflows.rerunJob(this.rest, repo, jobId)
    await this.refresh(jobKeys.runJobs(runId))
  }

  async cancelRun(repo: string, runId: number) {
    await workflows.cancelRun(this.rest, repo, runId)
    await Promise.all([this.refresh(jobKeys.runs(repo)), this.refresh(jobKeys.runJobs(runId))])
  }

  fetchJobLog(repo: string, jobId: number): Promise<string> {
    return workflows.fetchJobLog(this.rest, repo, jobId)
  }

  fetchDispatchInputs(repo: string, path: string, ref: string) {
    return workflows.fetchDispatchInputs(this.rest, repo, path, ref)
  }

  async dispatchWorkflow(
    repo: string,
    workflowId: number,
    ref: string,
    inputs: Record<string, string | boolean | number>,
  ) {
    await workflows.dispatchWorkflow(this.rest, repo, workflowId, ref, inputs)
    await this.refresh(jobKeys.runs(repo))
  }
}
