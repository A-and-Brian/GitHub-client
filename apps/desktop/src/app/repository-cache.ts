import {
  getContents,
  getReadme,
  getRepository,
  listBranches,
  listRepositories,
  type Page,
  type RepositoryContents,
  type RepositorySummary,
} from "@github-client/core/repositories"
import type {
  RepositoryResourceHandle,
  RepositoryResourceKey,
  RepositoryResourceSnapshot,
} from "@github-client/core/repository-cache"
import { useEffect, useMemo, useSyncExternalStore } from "react"
import { useSession } from "./client"

type SingleKey = Extract<RepositoryResourceKey, { kind: "summary" | "contents" | "readme" }>
type PagedKey = Extract<RepositoryResourceKey, { kind: "catalog" | "branches" | "pulls" }>
type ResourceData = {
  summary: RepositorySummary
  contents: RepositoryContents
  readme: Awaited<ReturnType<typeof getReadme>>
}
type PullSummary = {
  node_id?: string
  number: number
  title: string
  draft: boolean
  user?: { login?: string }
  html_url?: string
  created_at?: string
  updated_at?: string
  head?: { ref?: string; sha?: string }
  base?: { ref?: string }
  requested_reviewers?: { login: string }[]
  requested_teams?: { slug: string }[]
  labels?: { name: string; color: string }[]
}
type PageItem = { catalog: RepositorySummary; branches: { name: string }; pulls: PullSummary }
const EMPTY = { loaded: false, refreshing: false, persisted: false, data: undefined } as const

function useHandle<T>(handle: RepositoryResourceHandle<T>, enabled: boolean) {
  const snapshot = useSyncExternalStore(
    enabled ? handle.subscribe : () => () => undefined,
    handle.snapshot,
  )
  useEffect(() => {
    if (!enabled) return
    void handle.load()
    const reconnect = () => void handle.load()
    window.addEventListener("online", reconnect)
    return () => window.removeEventListener("online", reconnect)
  }, [handle, enabled])
  return (snapshot ?? EMPTY) as Pick<
    RepositoryResourceSnapshot<T>,
    "data" | "loaded" | "refreshing" | "persisted" | "error" | "saveError"
  >
}

export function useRepositoryResource<K extends SingleKey>(key: K, enabled = true) {
  const { client } = useSession()
  const identity = JSON.stringify(key)
  const handle = useMemo(() => {
    const resource = JSON.parse(identity) as K
    const fetcher = () => {
      switch (resource.kind) {
        case "summary":
          return getRepository(client.rest, resource.owner, resource.repo)
        case "contents":
          return getContents(
            client.rest,
            resource.owner,
            resource.repo,
            resource.path,
            resource.ref,
          )
        case "readme":
          return getReadme(client.rest, resource.owner, resource.repo, resource.ref)
      }
    }
    // The discriminator selects both the endpoint and its result type.
    return client.repositoryCache.resource(
      resource,
      fetcher as () => Promise<ResourceData[K["kind"]]>,
    )
  }, [client, identity])
  return { state: useHandle(handle, enabled), refresh: handle.retry, retry: handle.retry }
}

export function useRepositoryPages<K extends PagedKey>(key: K, enabled = true) {
  const { client } = useSession()
  const identity = JSON.stringify(key)
  const handle = useMemo(() => {
    const resource = JSON.parse(identity) as K
    const fetchPage = async (page: number) => {
      switch (resource.kind) {
        case "catalog":
          return listRepositories(client.rest, resource.scope, page)
        case "branches":
          return listBranches(client.rest, resource.owner, resource.repo, page)
        case "pulls": {
          const items = await client.rest.get<PullSummary[]>(
            `/repos/${encodeURIComponent(resource.owner)}/${encodeURIComponent(resource.repo)}/pulls`,
            { state: "open", per_page: resource.pageSize, page },
          )
          return { items, hasMore: items.length === resource.pageSize }
        }
      }
    }
    return client.repositoryCache.paginated(
      resource,
      fetchPage as (page: number) => Promise<Page<PageItem[K["kind"]]>>,
      (item) => ("id" in item ? item.id : "number" in item ? item.number : item.name),
    )
  }, [client, identity])
  return {
    state: useHandle(handle, enabled),
    refresh: () => handle.load({ force: true }),
    retry: handle.retry,
    loadMore: handle.loadMore,
  }
}
