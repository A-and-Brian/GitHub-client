import type { PullRequest } from "@github-client/core"
import { useEffect, useMemo, useState } from "react"
import { useSession } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { useRepositoryPages } from "@/app/repository-cache"

type RepositoryPull = {
  inboxObservedAt?: string
  node_id?: string
  number?: number
  title?: string
  html_url?: string
  user?: { login?: string; avatar_url?: string } | null
  draft?: boolean
  created_at?: string
  updated_at?: string
  head?: { ref?: string; sha?: string }
  base?: { ref?: string }
  requested_reviewers?: { login: string }[]
  requested_teams?: { slug: string }[]
  labels?: { name: string; color: string }[]
}
const EMPTY_ROWS: RepositoryPull[] = []

function toPullRequest(row: RepositoryPull, repo: string, owner: string): PullRequest | null {
  // Older cache rows may contain only the repository screen's compact summary.
  // Keep those rows out of Inbox until a complete REST record is available; in
  // particular, never invent a GraphQL node ID used by preference state.
  if (
    !row.node_id ||
    !row.number ||
    !row.title ||
    !row.html_url ||
    !row.created_at ||
    !row.updated_at ||
    !row.head?.ref ||
    !row.head.sha ||
    !row.base?.ref
  )
    return null
  return {
    id: row.node_id,
    key: `repo:${repo}:${row.node_id}`,
    groupId: `repo:${repo}`,
    repo,
    number: row.number,
    title: row.title,
    url: row.html_url,
    author: row.user?.login ?? null,
    authorAvatarUrl: row.user?.avatar_url ?? null,
    isDraft: row.draft ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: "OPEN",
    syncedAt: row.inboxObservedAt,
    headOid: row.head.sha,
    headRef: row.head.ref,
    baseRef: row.base.ref,
    reviewDecision: null,
    checkState: null,
    checkSnapshotComplete: false,
    labels: row.labels ?? [],
    reviewRequests: [
      ...(row.requested_reviewers ?? []).map((reviewer) => reviewer.login),
      ...(row.requested_teams ?? []).map((team) => `${owner}/${team.slug}`),
    ],
    comments: 0,
    additions: 0,
    deletions: 0,
  }
}

/** Repository REST pages supplement Inbox; synced rows remain preference authority. */
export function useRepositoryInboxData(repo: string | undefined, active = true) {
  const { client, viewer } = useSession()
  const [owner, name] = repo?.split("/") ?? []
  const resource = useRepositoryPages(
    {
      kind: "pulls",
      host: client.rest.url("/"),
      accountLogin: viewer.login,
      owner: owner ?? "",
      repo: name ?? "",
      page: 1,
      pageSize: 30,
      query: "state=open",
    },
    Boolean(active && repo && owner && name),
  )
  const rows = (resource.state.data?.items ?? EMPTY_ROWS) as RepositoryPull[]
  const items = useMemo(
    () =>
      rows.flatMap((row) => {
        const pull = repo && owner ? toPullRequest(row, repo, owner) : null
        return pull ? [pull] : []
      }),
    [rows, repo, owner],
  )
  const [syncError, setSyncError] = useState<unknown>(null)
  const [syncing, setSyncing] = useState(false)
  useErrorToast(syncError, {
    id: `repository-inbox-sync:${repo}`,
    title: "Could not update repository inbox state",
  })
  const complete = resource.state.data?.hasMore === false
  useEffect(() => {
    setSyncing(false)
    if (
      !active ||
      !repo ||
      !resource.state.loaded ||
      resource.state.refreshing ||
      resource.state.error
    )
      return
    let current = true
    setSyncError(null)
    setSyncing(true)
    void client
      .syncRepositoryInbox(viewer.login, repo, items, { complete })
      .catch((error: unknown) => {
        if (current) setSyncError(error)
      })
      .finally(() => {
        if (current) setSyncing(false)
      })
    return () => {
      current = false
    }
  }, [
    active,
    client,
    complete,
    items,
    repo,
    resource.state.loaded,
    resource.state.refreshing,
    resource.state.error,
    viewer.login,
  ])
  return {
    items,
    state: resource.state,
    loading: !resource.state.loaded && !resource.state.error,
    refreshing: resource.state.refreshing || syncing,
    error: resource.state.error,
    pages: resource.state.data?.pages ?? 0,
    more: resource.state.data?.hasMore ?? false,
    loadMore: () => void resource.loadMore(),
    retry: () => void resource.retry(),
    refresh: () => void resource.refresh(),
  }
}
