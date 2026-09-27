import type { PullRequest } from "@github-client/core"
import { useEffect, useRef, useState } from "react"
import { useSession } from "@/app/client"

interface RepositoryPull {
  node_id: string
  number: number
  title: string
  html_url: string
  user: { login: string; avatar_url: string } | null
  draft: boolean
  created_at: string
  updated_at: string
  head: { ref: string; sha: string }
  base: { ref: string }
  requested_reviewers?: { login: string }[]
  requested_teams?: { slug: string }[]
  labels?: { name: string; color: string }[]
}

/** Keep repository pagination coverage without writing partial REST rows over synced PRs. */
export function useRepositoryInboxData(repo: string | undefined) {
  const { client } = useSession()
  const [items, setItems] = useState<PullRequest[]>([])
  const [page, setPage] = useState(1)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [more, setMore] = useState(false)
  const generation = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry and refresh explicitly reload this page.
  useEffect(() => {
    if (!repo) return
    const request = ++generation.current
    setLoading(true)
    setError(null)
    const [owner, name] = repo.split("/")
    void client.rest
      .get<RepositoryPull[]>(
        `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}/pulls`,
        {
          state: "open",
          per_page: 30,
          page,
        },
      )
      .then((rows) => {
        if (request !== generation.current) return
        const mapped: PullRequest[] = rows.map((row) => ({
          id: row.node_id,
          key: `repo:${repo}:${row.node_id}`,
          groupId: `repo:${repo}`,
          repo,
          number: row.number,
          title: row.title,
          url: row.html_url,
          author: row.user?.login ?? null,
          authorAvatarUrl: row.user?.avatar_url ?? null,
          isDraft: row.draft,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          headOid: row.head?.sha,
          headRef: row.head?.ref ?? "",
          baseRef: row.base?.ref ?? "",
          reviewDecision: null,
          checkState: null,
          labels: row.labels ?? [],
          reviewRequests: [
            ...(row.requested_reviewers ?? []).map((r) => r.login),
            ...(row.requested_teams ?? []).map((t) => `${owner}/${t.slug}`),
          ],
          comments: 0,
          additions: 0,
          deletions: 0,
        }))
        setItems((current) =>
          page === 1
            ? mapped
            : [...new Map([...current, ...mapped].map((p) => [p.id, p])).values()],
        )
        setMore(rows.length === 30)
      })
      .catch((cause: unknown) => {
        if (request !== generation.current) return
        setError(cause)
        if (
          typeof cause === "object" &&
          cause &&
          "status" in cause &&
          [401, 403, 404].includes(Number(cause.status))
        ) {
          setItems([])
          setMore(false)
        }
      })
      .finally(() => {
        if (request === generation.current) setLoading(false)
      })
    return () => {
      generation.current++
    }
  }, [client, repo, page, version])
  return {
    items,
    loading,
    error,
    more,
    loadMore: () => setPage((current) => current + 1),
    retry: () => setVersion((current) => current + 1),
    refresh: () => {
      setPage(1)
      setVersion((current) => current + 1)
    },
  }
}
