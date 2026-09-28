import type { SyncedCollection } from "../collections/synced"
import type {
  Actor,
  Check,
  MergeMethod,
  PullRequestDetail,
  PullRequestFile,
  PullRequestFiles,
  ReviewThread,
  TimelineItem,
} from "../domain/types"
import { prKey } from "../domain/types"
import type { GraphQLClient } from "../github/graphql"
import type { RestClient } from "../github/rest"

const ACTOR = "author { login avatarUrl }"

const PULL_DETAIL = /* GraphQL */ `
  query PullDetail($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
      pullRequest(number: $number) {
        id number title url state isDraft bodyHTML createdAt
        headRefName headRefOid baseRefName baseRefOid
        mergeable mergeStateStatus reviewDecision viewerCanUpdate
        additions deletions changedFiles
        ${ACTOR}
        timelineItems(last: 100, itemTypes: [
          ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT, LABELED_EVENT, UNLABELED_EVENT,
          MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT,
          REVIEW_REQUESTED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT
        ]) {
          nodes {
            __typename
            ... on IssueComment { id databaseId bodyHTML createdAt ${ACTOR} }
            ... on PullRequestReview { id state bodyHTML createdAt ${ACTOR} }
            ... on PullRequestCommit {
              id
              commit { oid messageHeadline committedDate author { user { login } name } }
            }
            ... on LabeledEvent { id createdAt actor { login } label { name } }
            ... on UnlabeledEvent { id createdAt actor { login } label { name } }
            ... on MergedEvent { id createdAt actor { login } }
            ... on ClosedEvent { id createdAt actor { login } }
            ... on ReopenedEvent { id createdAt actor { login } }
            ... on HeadRefForcePushedEvent { id createdAt actor { login } }
            ... on ReviewRequestedEvent {
              id createdAt actor { login }
              requestedReviewer { ... on User { login } ... on Team { combinedSlug } }
            }
            ... on ReadyForReviewEvent { id createdAt actor { login } }
            ... on ConvertToDraftEvent { id createdAt actor { login } }
          }
        }
        reviewThreads(first: 100) {
          nodes {
            id path line startLine diffSide isResolved isOutdated viewerCanResolve
            comments(first: 50) { nodes { id databaseId body bodyHTML createdAt ${ACTOR} } }
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name status conclusion detailsUrl
                      checkSuite { workflowRun { databaseId workflow { name } } }
                    }
                    ... on StatusContext { context state targetUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`

// GraphQL result shapes follow the query above; they are mapped field by field.
// biome-ignore lint/suspicious/noExplicitAny: untyped GraphQL response nodes
type Node = Record<string, any>

const actor = (node: Node | null | undefined): Actor | null =>
  node ? { login: node.login, avatarUrl: node.avatarUrl } : null

const EVENT_TEXT: Record<string, (n: Node) => string> = {
  LabeledEvent: (n) => `added label ${n.label?.name}`,
  UnlabeledEvent: (n) => `removed label ${n.label?.name}`,
  MergedEvent: () => "merged this pull request",
  ClosedEvent: () => "closed this pull request",
  ReopenedEvent: () => "reopened this pull request",
  HeadRefForcePushedEvent: () => "force-pushed the head branch",
  ReviewRequestedEvent: (n) =>
    `requested review from ${n.requestedReviewer?.login ?? n.requestedReviewer?.combinedSlug ?? "someone"}`,
  ReadyForReviewEvent: () => "marked this pull request as ready for review",
  ConvertToDraftEvent: () => "converted this pull request to draft",
}

export function toTimelineItem(n: Node): TimelineItem | null {
  switch (n.__typename) {
    case "IssueComment":
      return {
        kind: "comment",
        id: n.id,
        databaseId: n.databaseId,
        author: actor(n.author),
        bodyHTML: n.bodyHTML,
        createdAt: n.createdAt,
      }
    case "PullRequestReview":
      return {
        kind: "review",
        id: n.id,
        author: actor(n.author),
        state: n.state,
        bodyHTML: n.bodyHTML,
        createdAt: n.createdAt,
      }
    case "PullRequestCommit":
      return {
        kind: "commit",
        id: n.id,
        oid: n.commit.oid,
        messageHeadline: n.commit.messageHeadline,
        author: n.commit.author?.user?.login ?? n.commit.author?.name ?? null,
        createdAt: n.commit.committedDate,
      }
    default: {
      const text = EVENT_TEXT[n.__typename]
      if (!text) return null
      return {
        kind: "event",
        id: n.id,
        actor: n.actor?.login ?? null,
        text: text(n),
        createdAt: n.createdAt,
      }
    }
  }
}

export function toCheck(n: Node): Check {
  if (n.__typename === "StatusContext") {
    return {
      kind: "status",
      name: n.context,
      status: n.state,
      conclusion: n.state,
      url: n.targetUrl,
      workflowRunId: null,
      workflowName: null,
    }
  }
  const run = n.checkSuite?.workflowRun
  return {
    kind: "check-run",
    name: n.name,
    status: n.status,
    conclusion: n.conclusion,
    url: n.detailsUrl,
    workflowRunId: run?.databaseId ?? null,
    workflowName: run?.workflow?.name ?? null,
  }
}

export function toThread(n: Node): ReviewThread {
  return {
    id: n.id,
    path: n.path,
    line: n.line,
    startLine: n.startLine,
    side: n.diffSide,
    isResolved: n.isResolved,
    isOutdated: n.isOutdated,
    viewerCanResolve: n.viewerCanResolve,
    comments: n.comments.nodes.map((c: Node) => ({
      id: c.id,
      databaseId: c.databaseId,
      author: actor(c.author),
      body: c.body,
      bodyHTML: c.bodyHTML,
      createdAt: c.createdAt,
    })),
  }
}

export function toPullRequestDetail(repo: string, repository: Node): PullRequestDetail {
  const pr = repository.pullRequest
  const mergeMethods: MergeMethod[] = []
  if (repository.squashMergeAllowed) mergeMethods.push("squash")
  if (repository.mergeCommitAllowed) mergeMethods.push("merge")
  if (repository.rebaseMergeAllowed) mergeMethods.push("rebase")
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup
  return {
    key: prKey(repo, pr.number),
    id: pr.id,
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    author: actor(pr.author),
    bodyHTML: pr.bodyHTML,
    createdAt: pr.createdAt,
    headRef: pr.headRefName,
    headOid: pr.headRefOid,
    baseRef: pr.baseRefName,
    baseOid: pr.baseRefOid,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    mergeMethods,
    viewerCanUpdate: pr.viewerCanUpdate,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    timeline: pr.timelineItems.nodes
      .map(toTimelineItem)
      .filter((item: TimelineItem | null): item is TimelineItem => item !== null),
    threads: pr.reviewThreads.nodes.map(toThread),
    checks: (rollup?.contexts.nodes ?? []).map(toCheck),
  }
}

export async function fetchPullDetail(
  graphql: GraphQLClient,
  repo: string,
  number: number,
): Promise<PullRequestDetail> {
  const [owner, name] = repo.split("/")
  const data = await graphql.query<{ repository: Node }>(PULL_DETAIL, { owner, name, number })
  return toPullRequestDetail(repo, data.repository)
}

export async function syncPullDetail(
  graphql: GraphQLClient,
  repo: string,
  number: number,
  details: SyncedCollection<PullRequestDetail, string>,
): Promise<void> {
  await details.upsert([await fetchPullDetail(graphql, repo, number)])
}

interface RestFile {
  filename: string
  previous_filename?: string
  status: PullRequestFile["status"]
  additions: number
  deletions: number
  patch?: string
}

/** GitHub lists at most 3000 files per pull request. */
export async function syncPullFiles(
  rest: RestClient,
  repo: string,
  number: number,
  headOid: string,
  files: SyncedCollection<PullRequestFiles, string>,
): Promise<void> {
  const result = await fetchPullFiles(rest, repo, number, headOid)
  if (result) await files.upsert([result])
}

export async function fetchPullFiles(
  rest: RestClient,
  repo: string,
  number: number,
  headOid: string,
): Promise<PullRequestFiles | null> {
  const result = await rest.pollAll<RestFile>(`/repos/${repo}/pulls/${number}/files`)
  if (result.status === "not-modified") return null
  return {
    key: prKey(repo, number),
    headOid,
    files: result.data.map((f) => ({
      filename: f.filename,
      previousFilename: f.previous_filename ?? null,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
  }
}
