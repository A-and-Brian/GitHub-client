import type { SyncedCollection } from "../collections/synced"
import type { CheckState, Group, PullRequest, ReviewDecision } from "../domain/types"
import type { GraphQLClient } from "../github/graphql"
import { groupSearchQueries } from "./groups"

const MAX_PAGES_PER_QUERY = 4

const SEARCH_PULLS = /* GraphQL */ `
  query SearchPulls($q: String!, $cursor: String) {
    search(type: ISSUE, query: $q, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          id
          number
          title
          url
          isDraft
          createdAt
          updatedAt
          headRefName
          baseRefName
          reviewDecision
          additions
          deletions
          repository { nameWithOwner }
          author { login avatarUrl }
          labels(first: 10) { nodes { name color } }
          comments { totalCount }
          reviewRequests(first: 10) {
            nodes { requestedReviewer { ... on User { login } ... on Team { combinedSlug } } }
          }
          commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        }
      }
    }
  }
`

export interface SearchPullNode {
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  headRefName: string
  baseRefName: string
  reviewDecision: ReviewDecision
  additions: number
  deletions: number
  repository: { nameWithOwner: string }
  author: { login: string; avatarUrl: string } | null
  labels: { nodes: Array<{ name: string; color: string }> }
  comments: { totalCount: number }
  reviewRequests: {
    nodes: Array<{ requestedReviewer: { login?: string; combinedSlug?: string } | null }>
  }
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: CheckState } | null } }> }
}

interface SearchResult {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: Array<SearchPullNode | Record<string, never>>
  }
}

export function toPullRequest(groupId: string, node: SearchPullNode): PullRequest {
  return {
    key: `${groupId}:${node.id}`,
    groupId,
    id: node.id,
    repo: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? null,
    authorAvatarUrl: node.author?.avatarUrl ?? null,
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    headRef: node.headRefName,
    baseRef: node.baseRefName,
    reviewDecision: node.reviewDecision,
    checkState: node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    labels: node.labels.nodes,
    reviewRequests: node.reviewRequests.nodes
      .map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.combinedSlug)
      .filter((v): v is string => Boolean(v)),
    comments: node.comments.totalCount,
    additions: node.additions,
    deletions: node.deletions,
  }
}

/** Replaces the open PRs of one group with the current search results. */
export async function syncGroupPulls(
  graphql: GraphQLClient,
  group: Group,
  pulls: SyncedCollection<PullRequest, string>,
): Promise<void> {
  const rows: PullRequest[] = []
  for (const q of groupSearchQueries(group)) {
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
      const result: SearchResult = await graphql.query<SearchResult>(SEARCH_PULLS, {
        q: `${q} sort:updated-desc`,
        cursor,
      })
      for (const node of result.search.nodes) {
        if ("id" in node) rows.push(toPullRequest(group.id, node as SearchPullNode))
      }
      if (!result.search.pageInfo.hasNextPage) break
      cursor = result.search.pageInfo.endCursor
    }
  }
  await pulls.replace(rows, (row) => row.groupId === group.id)
}
