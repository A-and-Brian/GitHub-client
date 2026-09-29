import type { SyncedCollection } from "../collections/synced"
import type {
  CheckState,
  Group,
  PullRequest,
  PullRequestDetail,
  ReviewDecision,
} from "../domain/types"
import type { GraphQLClient } from "../github/graphql"
import { groupSearchQueries } from "./groups"
import { fetchPullDetail } from "./pull-detail"

const MAX_PAGES_PER_QUERY = 4
const MAX_TERMINAL_VERIFICATIONS_PER_SYNC = 10
const terminalVerificationOffsets = new Map<string, number>()

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
          repository { id nameWithOwner }
          author { id login avatarUrl }
          labels(first: 10) { pageInfo { hasNextPage } nodes { id name color } }
          comments { totalCount }
          reviewRequests(first: 10) {
            pageInfo { hasNextPage }
            nodes { requestedReviewer { ... on User { id login } ... on Team { id combinedSlug } } }
          }
          commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
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
  repository: { id?: string; nameWithOwner: string }
  author: { id?: string; login: string; avatarUrl: string } | null
  labels: {
    pageInfo?: { hasNextPage: boolean }
    nodes: Array<{ id?: string; name: string; color: string }>
  }
  comments: { totalCount: number }
  reviewRequests: {
    pageInfo?: { hasNextPage: boolean }
    nodes: Array<{
      requestedReviewer: { id?: string; login?: string; combinedSlug?: string } | null
    }>
  }
  commits: {
    nodes: Array<{
      commit: { oid?: string; statusCheckRollup: { state: CheckState } | null }
    }>
  }
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
    repoNodeId: node.repository.id,
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? null,
    authorNodeId: node.author?.id,
    authorAvatarUrl: node.author?.avatarUrl ?? null,
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    state: "OPEN",
    checkSnapshotComplete: true,
    headOid: node.commits.nodes[0]?.commit.oid,
    headRef: node.headRefName,
    baseRef: node.baseRefName,
    reviewDecision: node.reviewDecision,
    checkState: node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    labels: node.labels.nodes.map(({ id, name, color }) => ({ id, name, color })),
    labelsComplete: !node.labels.pageInfo?.hasNextPage,
    reviewRequests: node.reviewRequests.nodes
      .map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.combinedSlug)
      .filter((v): v is string => Boolean(v)),
    reviewRequestTargets: node.reviewRequests.nodes.flatMap<
      NonNullable<PullRequest["reviewRequestTargets"]>[number]
    >(({ requestedReviewer }) => {
      if (!requestedReviewer) return []
      if (requestedReviewer.login)
        return [
          { kind: "user" as const, login: requestedReviewer.login, nodeId: requestedReviewer.id },
        ]
      if (requestedReviewer.combinedSlug)
        return [
          {
            kind: "team" as const,
            login: requestedReviewer.combinedSlug,
            nodeId: requestedReviewer.id,
          },
        ]
      return []
    }),
    reviewRequestsComplete: !node.reviewRequests.pageInfo?.hasNextPage,
    comments: node.comments.totalCount,
    additions: node.additions,
    deletions: node.deletions,
  }
}

export interface GroupPullsResult {
  rows: PullRequest[]
  observedAt: string
  complete: boolean
}

/** Fetches one group without changing local collections. */
export async function fetchGroupPulls(
  graphql: GraphQLClient,
  group: Group,
): Promise<GroupPullsResult> {
  const observedAt = new Date().toISOString()
  const rows: PullRequest[] = []
  let complete = true
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
      if (page === MAX_PAGES_PER_QUERY - 1) complete = false
    }
  }
  return { rows, observedAt, complete }
}

/** Applies fetched rows after the caller has checked its account generation. */
export async function applyGroupPulls(
  group: Group,
  result: GroupPullsResult,
  pulls: SyncedCollection<PullRequest, string>,
  details?: SyncedCollection<PullRequestDetail, string>,
  verifiedDetails?: ReadonlyMap<string, PullRequestDetail | null>,
): Promise<void> {
  await pulls.collection.preload()
  const { rows, observedAt, complete } = result
  const priorGroupRows = [...pulls.collection.values()].filter((row) => row.groupId === group.id)
  const syncedAt = observedAt
  for (const row of rows) {
    const existing = pulls.collection.get(row.key)
    const comparable = (value: PullRequest) =>
      Object.fromEntries(
        Object.entries(value).filter(
          ([key]) => key !== "syncedAt" && key !== "stateObservedAt" && !key.startsWith("$"),
        ),
      )
    row.syncedAt =
      existing &&
      JSON.stringify(sortedEntries(comparable(existing))) ===
        JSON.stringify(sortedEntries(comparable(row)))
        ? existing.syncedAt
        : syncedAt
    if (existing?.state === "OPEN" && row.state === "OPEN" && existing.stateObservedAt) {
      row.stateObservedAt = existing.stateObservedAt
    }
    const terminalCopy = [...pulls.collection.values()]
      .filter((candidate) => candidate.id === row.id && isTerminal(candidate.state))
      .sort(
        (a, b) =>
          Number(b.state === "MERGED") - Number(a.state === "MERGED") ||
          compareObservation(b.stateObservedAt, a.stateObservedAt),
      )[0]
    if (terminalCopy) {
      if (
        terminalCopy.state === "MERGED" ||
        compareObservation(observedAt, terminalCopy.stateObservedAt) <= 0
      ) {
        row.state = terminalCopy.state
        row.stateObservedAt = terminalCopy.stateObservedAt
      } else {
        row.state = "OPEN"
        row.stateObservedAt = observedAt
        await updatePullLifecycleCopies(pulls, row.id, "OPEN", observedAt)
      }
    }
  }
  if (complete && details) {
    rows.splice(
      0,
      rows.length,
      ...(await preserveTerminalPulls(
        pulls,
        details,
        priorGroupRows,
        rows,
        observedAt,
        verifiedDetails ?? new Map(),
      )),
    )
  }
  if (complete) await pulls.replace(rows, (row) => row.groupId === group.id)
  else await pulls.upsert(rows)
}

function sortedEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
}

/** Replaces the open PRs of one group with the current search results. */
export async function syncGroupPulls(
  graphql: GraphQLClient,
  group: Group,
  pulls: SyncedCollection<PullRequest, string>,
  details?: SyncedCollection<PullRequestDetail, string>,
): Promise<{ complete: boolean }> {
  const result = await fetchGroupPulls(graphql, group)
  await pulls.collection.preload()
  const priorRows = [...pulls.collection.values()].filter((row) => row.groupId === group.id)
  const verified =
    details && result.complete
      ? await verifyMissingPulls(graphql, priorRows, result.rows, group.id)
      : undefined
  await applyGroupPulls(group, result, pulls, details, verified)
  return { complete: result.complete }
}

function isTerminal(
  state: PullRequest["state"] | PullRequestDetail["state"],
): state is "CLOSED" | "MERGED" {
  return state === "CLOSED" || state === "MERGED"
}

function compareObservation(left?: string, right?: string): number {
  const leftAt = left ? Date.parse(left) : Number.NEGATIVE_INFINITY
  const rightAt = right ? Date.parse(right) : Number.NEGATIVE_INFINITY
  return leftAt - rightAt
}

export async function updatePullLifecycleCopies(
  pulls: SyncedCollection<PullRequest, string>,
  pullId: string,
  state: PullRequest["state"],
  stateObservedAt: string,
  replacement?: PullRequest,
): Promise<void> {
  const copies = [...pulls.collection.values()].filter((row) => row.id === pullId)
  if (replacement && copies.length === 0) {
    await pulls.upsert([replacement])
    return
  }
  await pulls.upsert(
    copies.map((row) =>
      row.state === "MERGED" ||
      (state !== "MERGED" && compareObservation(stateObservedAt, row.stateObservedAt) < 0)
        ? row
        : { ...row, state, stateObservedAt },
    ),
  )
}

export async function verifyMissingPulls(
  graphql: GraphQLClient,
  priorRows: readonly PullRequest[],
  currentRows: readonly PullRequest[],
  verificationKey = "default",
): Promise<Map<string, PullRequestDetail | null>> {
  const incomingIds = new Set(currentRows.map((row) => row.id))
  const candidates = [
    ...new Map(
      priorRows
        .filter((old) => !incomingIds.has(old.id) && !isTerminal(old.state))
        .map((old) => [old.id, old]),
    ).values(),
  ]
  const start =
    (terminalVerificationOffsets.get(verificationKey) ?? 0) % Math.max(candidates.length, 1)
  const selected =
    candidates.length <= MAX_TERMINAL_VERIFICATIONS_PER_SYNC
      ? candidates
      : Array.from(
          { length: MAX_TERMINAL_VERIFICATIONS_PER_SYNC },
          (_, index) => candidates[(start + index) % candidates.length]!,
        )
  terminalVerificationOffsets.set(
    verificationKey,
    candidates.length === 0 ? 0 : (start + selected.length) % candidates.length,
  )
  const verified = new Map<string, PullRequestDetail | null>()
  for (const candidate of selected) {
    try {
      verified.set(candidate.id, await fetchPullDetail(graphql, candidate.repo, candidate.number))
    } catch {
      verified.set(candidate.id, null)
    }
  }
  return verified
}

export async function preserveTerminalPulls(
  pulls: SyncedCollection<PullRequest, string>,
  details: SyncedCollection<PullRequestDetail, string>,
  priorRows: readonly PullRequest[],
  currentRows: readonly PullRequest[],
  observedAt: string,
  verifiedDetails: ReadonlyMap<string, PullRequestDetail | null> = new Map(),
): Promise<PullRequest[]> {
  const incomingIds = new Set(currentRows.map((row) => row.id))
  const candidates = [
    ...new Map(
      priorRows
        .filter((old) => !incomingIds.has(old.id) && !isTerminal(old.state))
        .map((old) => [old.id, old]),
    ).values(),
  ]
  const retained = new Map<string, PullRequest>()
  for (const old of priorRows.filter((row) => isTerminal(row.state))) {
    if (!incomingIds.has(old.id)) retained.set(old.id, old)
  }
  for (const candidate of candidates) {
    if (!verifiedDetails.has(candidate.id)) {
      retained.set(candidate.id, candidate)
      continue
    }
    try {
      const detail = verifiedDetails.get(candidate.id)
      if (!detail) {
        retained.set(candidate.id, candidate)
        continue
      }
      await details.upsert([detail])
      if (isTerminal(detail.state)) {
        const newerObservation = [...pulls.collection.values()].some(
          (copy) =>
            copy.id === candidate.id && compareObservation(copy.stateObservedAt, observedAt) > 0,
        )
        if (newerObservation && detail.state !== "MERGED") continue
        const terminal = { ...candidate, state: detail.state, stateObservedAt: observedAt }
        await updatePullLifecycleCopies(pulls, candidate.id, detail.state, observedAt, terminal)
        retained.set(candidate.id, terminal)
      }
    } catch {
      retained.set(candidate.id, candidate)
    }
  }
  const finalRows = new Map(currentRows.map((row) => [row.id, row]))
  for (const copy of pulls.collection.values()) {
    if (copy.groupId === priorRows[0]?.groupId && isTerminal(copy.state)) {
      const current = finalRows.get(copy.id)
      if (
        !current ||
        copy.state === "MERGED" ||
        (current.state !== "MERGED" &&
          compareObservation(copy.stateObservedAt, current.stateObservedAt) > 0)
      ) {
        finalRows.set(copy.id, copy)
      }
    }
  }
  for (const row of retained.values()) {
    const current = finalRows.get(row.id)
    if (
      !current ||
      row.state === "MERGED" ||
      (current.state !== "MERGED" &&
        compareObservation(row.stateObservedAt, current.stateObservedAt) > 0)
    ) {
      finalRows.set(row.id, row)
    }
  }
  return [...finalRows.values()]
}
