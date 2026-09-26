import type { GitHubClient, JobStatus, Viewer } from "@github-client/core"
import { createContext, useContext, useEffect, useSyncExternalStore } from "react"

export interface Session {
  client: GitHubClient
  viewer: Viewer
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error("useSession outside of a signed-in session")
  return session
}

export const useClient = () => useSession().client

/** Keeps a sync job polling while the calling component is mounted. */
export function useWatch(watch: (client: GitHubClient) => () => void, deps: unknown[]): void {
  const client = useClient()
  // biome-ignore lint/correctness/useExhaustiveDependencies: callers pass the dependencies of `watch`
  useEffect(() => watch(client), [client, ...deps])
}

/** Status of one sync job, updated as it runs. */
export function useJobStatus(key: string): JobStatus | undefined {
  const client = useClient()
  return useSyncExternalStore(
    (listener) => client.poller.subscribe(listener),
    () => client.poller.status(key),
  )
}
