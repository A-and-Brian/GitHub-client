export interface Viewer {
  login: string
  name: string | null
  avatarUrl: string
}

export interface Repo {
  nodeId?: string
  databaseId?: number
  ownerNodeId?: string
  ownerDatabaseId?: number
  ownerKind?: "user" | "organization"
  /** `owner/name` */
  fullName: string
  owner: string
  name: string
  private: boolean
  archived: boolean
  defaultBranch: string
  pushedAt: string | null
}

export type GroupKind = "me" | "org" | "team" | "starred"

export interface Group {
  /** `me`, `org:acme`, `team:acme/core`, `starred` */
  id: string
  kind: GroupKind
  name: string
  /** Sort position in the sidebar. */
  order: number
  org?: string
  /** GitHub team parent identity within `org`; never inferred from names. */
  parentSlug?: string | null
  parentName?: string | null
  /** Repos of team and starred groups (`owner/name`). Org and `me` groups use a search qualifier instead. */
  repos?: string[]
  /** Transient API identities used to keep normalized org/team references stable. */
  orgNodeId?: string
  teamNodeId?: string
  parentTeamNodeId?: string | null
}

export type CheckState = "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED" | null

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null

export interface Label {
  id?: string
  name: string
  color: string
}

export interface ReviewRequestTarget {
  kind: "user" | "team"
  login: string
  nodeId?: string
}

/** An open pull request as listed in one group. The same PR appears once per group. */
export interface PullRequest {
  /** `groupId:id` */
  key: string
  groupId: string
  /** GraphQL node id */
  id: string
  /** `owner/name` */
  repo: string
  repoNodeId?: string
  authorNodeId?: string
  number: number
  title: string
  url: string
  author: string | null
  authorAvatarUrl: string | null
  isDraft: boolean
  createdAt: string
  updatedAt: string
  /** Local time when this group copy was fetched. */
  syncedAt?: string
  /** Last authoritative lifecycle observation; absent on legacy cached rows. */
  stateObservedAt?: string
  /** GitHub lifecycle state. Missing legacy values are treated as OPEN. */
  state?: "OPEN" | "CLOSED" | "MERGED"
  /** Whether this row includes an authoritative checks snapshot. */
  checkSnapshotComplete?: boolean
  /** Latest known commit OID; older cached rows may not have this field. */
  headOid?: string
  headRef: string
  baseRef: string
  reviewDecision: ReviewDecision
  checkState: CheckState
  labels: Label[]
  labelsComplete?: boolean
  /** Logins and `org/team` slugs whose review is requested. */
  reviewRequests: string[]
  reviewRequestTargets?: ReviewRequestTarget[]
  reviewRequestsComplete?: boolean
  comments: number
  additions: number
  deletions: number
}

export interface Actor {
  login: string
  avatarUrl: string
  id?: string
}

export interface TimelineComment {
  kind: "comment"
  id: string
  databaseId: number
  author: Actor | null
  bodyHTML: string
  createdAt: string
}

export interface TimelineReview {
  kind: "review"
  id: string
  author: Actor | null
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"
  bodyHTML: string
  createdAt: string
}

export interface TimelineCommit {
  kind: "commit"
  id: string
  oid: string
  messageHeadline: string
  author: string | null
  authorIdentity?: Actor | null
  createdAt: string
}

export interface TimelineEvent {
  kind: "event"
  id: string
  actor: string | null
  /** Human-readable summary, for example "added label bug". */
  text: string
  createdAt: string
}

export type TimelineItem = TimelineComment | TimelineReview | TimelineCommit | TimelineEvent

export interface ReviewComment {
  id: string
  databaseId: number
  author: Actor | null
  body: string
  bodyHTML: string
  createdAt: string
}

export interface ReviewThread {
  id: string
  path: string
  /** Null when the thread is outdated. */
  line: number | null
  startLine: number | null
  side: "LEFT" | "RIGHT"
  isResolved: boolean
  isOutdated: boolean
  viewerCanResolve: boolean
  comments: ReviewComment[]
}

export interface Check {
  id?: string
  kind: "check-run" | "status"
  name: string
  /** Check run: QUEUED, IN_PROGRESS, COMPLETED, ... Status context: the state. */
  status: string
  conclusion: string | null
  url: string | null
  /** Workflow run id, when the check comes from GitHub Actions. */
  workflowRunId: number | null
  workflowId?: number | null
  workflowName: string | null
}

export type MergeMethod = "merge" | "squash" | "rebase"

export interface PullRequestDetail {
  /** `owner/name#number` */
  key: string
  id: string
  repo: string
  number: number
  title: string
  url: string
  state: "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean
  author: Actor | null
  bodyHTML: string
  createdAt: string
  headRef: string
  headOid: string
  baseRef: string
  baseOid: string
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  mergeStateStatus: string
  reviewDecision: ReviewDecision
  mergeMethods: MergeMethod[]
  viewerCanUpdate: boolean
  additions: number
  deletions: number
  changedFiles: number
  timeline: TimelineItem[]
  threads: ReviewThread[]
  checks: Check[]
  timelineComplete?: boolean
  threadsComplete?: boolean
  checksComplete?: boolean
  observedAt?: string
  repositoryNodeId?: string
  ownerNodeId?: string
  ownerKind?: "user" | "organization"
  ownerLogin?: string
}

export interface PullRequestFile {
  filename: string
  previousFilename: string | null
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged"
  additions: number
  deletions: number
  /** Missing for binary files and for files GitHub considers too large. */
  patch: string | null
}

export interface PullRequestFiles {
  /** `owner/name#number` */
  key: string
  headOid: string
  files: PullRequestFile[]
  complete?: boolean
}

export interface WorkflowRun {
  id: number
  repo: string
  workflowId: number
  name: string
  displayTitle: string
  runNumber: number
  runAttempt: number
  event: string
  status: string
  conclusion: string | null
  headBranch: string | null
  headSha: string
  actor: string | null
  actorId?: string
  actorAvatarUrl?: string
  createdAt: string
  updatedAt: string
  url: string
}

export interface JobStep {
  number: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface Job {
  id: number
  runId: number
  repo: string
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  url: string
  steps: JobStep[]
}

export interface Workflow {
  id: number
  repo: string
  name: string
  path: string
  state: string
}

export const prKey = (repo: string, number: number) => `${repo}#${number}`

/** Canonical rows stored by the normalized collection layer. */
export interface ScopedRow {
  key: string
  scope: string
}

export interface CanonicalGroup extends ScopedRow {
  id: string
  kind: GroupKind
  name: string
  order: number
  orgId: string | null
  teamId?: string | null
}

export interface CanonicalTeam extends ScopedRow {
  id: string
  nodeId?: string
  organizationId: string
  name: string
  slug: string
  parentTeamId: string | null
}

export interface CanonicalActor extends ScopedRow {
  id: string
  nodeId?: string
  databaseId?: number
  kind: "user" | "organization"
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface CanonicalRepository extends ScopedRow {
  id: string
  nodeId?: string
  databaseId?: number
  ownerId: string | null
  fullName: string
  name: string
  private?: boolean
  archived?: boolean
  defaultBranch?: string
  pushedAt?: string | null
  description?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  htmlUrl?: string
  canAdmin?: boolean
}

export interface CanonicalPullRequest extends ScopedRow {
  id: string
  nodeId?: string
  repositoryId?: string
  number: number
  title?: string
  url?: string
  authorId?: string | null
  isDraft?: boolean
  createdAt?: string
  updatedAt?: string
  state?: "OPEN" | "CLOSED" | "MERGED"
  stateObservedAt?: string
  checkSnapshotComplete?: boolean
  labelsComplete?: boolean
  reviewRequestsComplete?: boolean
  headOid?: string
  headRef?: string
  baseRef?: string
  reviewDecision?: ReviewDecision
  checkState?: CheckState
  comments?: number
  additions?: number
  deletions?: number
  bodyHTML?: string
  baseOid?: string
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  mergeStateStatus?: string
  mergeMethods?: MergeMethod[]
  viewerCanUpdate?: boolean
  changedFiles?: number
  detailObservedAt?: string
  listObservedAt?: string
  scalarObservedAt?: string
}

export interface GroupRepository extends ScopedRow {
  groupId: string
  repositoryId: string
  order: number
}

export interface GroupPull extends ScopedRow {
  groupId: string
  pullId: string
  syncedAt: string
  observedAt: string
}

export interface CanonicalLabel extends ScopedRow {
  id: string
  nodeId?: string
  repositoryId: string
  name: string
  color: string
}

export interface PullLabel extends ScopedRow {
  pullId: string
  labelId: string
  order: number
}

export interface PullReviewRequest extends ScopedRow {
  pullId: string
  targetKind: "user" | "team"
  targetId: string
  order: number
}

export interface PullDetailObservation extends ScopedRow {
  pullId: string
  observedAt: string
  timelineComplete: boolean
  threadsComplete: boolean
  checksComplete: boolean
}

export interface CanonicalTimelineItem extends ScopedRow {
  pullId: string
  kind: TimelineItem["kind"]
  id: string
  order: number
  authorId: string | null
  authorText?: string | null
  databaseId?: number
  commitId?: string
  state?: TimelineReview["state"]
  bodyHTML?: string
  text?: string
  createdAt: string
}

export interface CanonicalCommit extends ScopedRow {
  id: string
  repositoryId: string
  oid: string
  messageHeadline: string
  authorId: string | null
  authorText: string | null
  createdAt: string
}

export interface CanonicalReviewThread extends ScopedRow {
  pullId: string
  id: string
  path: string
  line: number | null
  startLine: number | null
  side: ReviewThread["side"]
  isResolved: boolean
  isOutdated: boolean
  viewerCanResolve: boolean
  order: number
}

export interface CanonicalReviewComment extends ScopedRow {
  pullId: string
  threadId: string
  id: string
  databaseId: number
  authorId: string | null
  body: string
  bodyHTML: string
  createdAt: string
  order: number
}

export interface CanonicalCheck extends ScopedRow {
  id: string
  repositoryId: string
  kind: Check["kind"]
  name: string
  status: string
  conclusion: string | null
  url: string | null
  workflowRunKey: string | null
}

export interface PullCheck extends ScopedRow {
  pullId: string
  headOid: string
  checkId: string
  order: number
}

export interface PullFileObservation extends ScopedRow {
  pullId: string
  headOid: string
  observedAt: string
  complete: boolean
}

export interface CanonicalPullFile extends ScopedRow {
  pullId: string
  headOid: string
  filename: string
  previousFilename: string | null
  status: PullRequestFile["status"]
  additions: number
  deletions: number
  patch: string | null
  order: number
}
