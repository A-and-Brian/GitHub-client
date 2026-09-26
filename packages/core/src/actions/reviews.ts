import type { MergeMethod } from "../domain/types"
import type { GraphQLClient } from "../github/graphql"
import type { RestClient } from "../github/rest"

/** A review comment written locally and sent when the review is submitted. */
export interface DraftComment {
  id: string
  /** `owner/name#number` */
  prKey: string
  path: string
  /** Last line of the commented range, on `side`. */
  line: number
  /** First line for multi-line comments. */
  startLine: number | null
  side: "LEFT" | "RIGHT"
  body: string
  /** Head commit when the draft was written; its line numbers refer to that commit's diff. */
  commitId: string
  createdAt: string
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT"

export interface SubmitReview {
  repo: string
  number: number
  /** Head commit the comments refer to. */
  commitId: string
  event: ReviewEvent
  body: string
  comments: DraftComment[]
}

/** Creates and submits a review with all draft comments in one request. */
export function submitReview(rest: RestClient, review: SubmitReview): Promise<unknown> {
  return rest.request("POST", `/repos/${review.repo}/pulls/${review.number}/reviews`, {
    commit_id: review.commitId,
    event: review.event,
    body: review.body || undefined,
    comments: review.comments.map((c) => ({
      path: c.path,
      body: c.body,
      line: c.line,
      side: c.side,
      ...(c.startLine !== null && c.startLine !== c.line
        ? { start_line: c.startLine, start_side: c.side }
        : {}),
    })),
  })
}

export function replyToThread(
  rest: RestClient,
  repo: string,
  number: number,
  commentDatabaseId: number,
  body: string,
): Promise<unknown> {
  return rest.request(
    "POST",
    `/repos/${repo}/pulls/${number}/comments/${commentDatabaseId}/replies`,
    { body },
  )
}

export function commentOnPull(
  rest: RestClient,
  repo: string,
  number: number,
  body: string,
): Promise<unknown> {
  return rest.request("POST", `/repos/${repo}/issues/${number}/comments`, { body })
}

export function setThreadResolved(
  graphql: GraphQLClient,
  threadId: string,
  resolved: boolean,
): Promise<unknown> {
  const mutation = resolved
    ? "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }"
    : "mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id } } }"
  return graphql.query(mutation, { id: threadId })
}

export function mergePull(
  rest: RestClient,
  repo: string,
  number: number,
  method: MergeMethod,
  /** Merge fails if the head moved since the user looked at it. */
  headOid: string,
): Promise<unknown> {
  return rest.request("PUT", `/repos/${repo}/pulls/${number}/merge`, {
    merge_method: method,
    sha: headOid,
  })
}

/** Wraps lines in a GitHub suggestion block. */
export function suggestionBody(lines: string[], note = ""): string {
  const prefix = note ? `${note}\n\n` : ""
  return `${prefix}\`\`\`suggestion\n${lines.join("\n")}\n\`\`\`\n`
}
