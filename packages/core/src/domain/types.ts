export interface Viewer {
  login: string
  name: string | null
  avatarUrl: string
}

export interface Repo {
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
  /** Repos of team and starred groups (`owner/name`). Org and `me` groups use a search qualifier instead. */
  repos?: string[]
}

export type CheckState = "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED" | null

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null

export interface Label {
  name: string
  color: string
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
  number: number
  title: string
  url: string
  author: string | null
  authorAvatarUrl: string | null
  isDraft: boolean
  createdAt: string
  updatedAt: string
  headRef: string
  baseRef: string
  reviewDecision: ReviewDecision
  checkState: CheckState
  labels: Label[]
  /** Logins and `org/team` slugs whose review is requested. */
  reviewRequests: string[]
  comments: number
  additions: number
  deletions: number
}

export interface Actor {
  login: string
  avatarUrl: string
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
  kind: "check-run" | "status"
  name: string
  /** Check run: QUEUED, IN_PROGRESS, COMPLETED, ... Status context: the state. */
  status: string
  conclusion: string | null
  url: string | null
  /** Workflow run id, when the check comes from GitHub Actions. */
  workflowRunId: number | null
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
