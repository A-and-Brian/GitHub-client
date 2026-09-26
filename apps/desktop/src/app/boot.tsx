import { GitHubClient, GitHubError, type Viewer } from "@github-client/core"
import { Toaster } from "@github-client/ui/components/sonner"
import { TooltipProvider } from "@github-client/ui/components/tooltip"
import { RouterProvider } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { SessionContext } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { createAppRouter } from "@/app/router"
import { SIGNED_OUT_KEY, VIEWER_KEY } from "@/app/storage-keys"
import { startUpdateChecks } from "@/app/updates"
import { useTheme } from "@/components/theme-provider"
import { createPlatform } from "@/platform"
import { Setup } from "@/screens/setup"

// One client per app. Created outside React so StrictMode's double effects
// cannot open the same SQLite collections twice.
let clientPromise: Promise<GitHubClient> | undefined
const getClient = () => {
  clientPromise ??= createPlatform().then((platform) => new GitHubClient(platform))
  return clientPromise
}

type State =
  | { phase: "loading" }
  | { phase: "setup"; client: GitHubClient; error?: string }
  | { phase: "ready"; client: GitHubClient; viewer: Viewer }
  | { phase: "failed"; error: string }

/** Starts the platform, restores the token, and shows setup or the app. */
export function Boot() {
  const [state, setState] = useState<State>({ phase: "loading" })
  const { theme } = useTheme()
  useErrorToast(state.phase === "failed" ? state.error : null, {
    id: "startup-error",
    title: "Could not start GitHub-client",
  })

  useEffect(() => startUpdateChecks(), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const client = await getClient()
      const allowEnv = localStorage.getItem(SIGNED_OUT_KEY) === null
      if (!(await client.auth.restore({ allowEnv }))) return { phase: "setup", client } as State
      try {
        const viewer = await client.rest.get<{
          login: string
          name: string | null
          avatar_url: string
        }>("/user")
        return ready(client, {
          login: viewer.login,
          name: viewer.name,
          avatarUrl: viewer.avatar_url,
        })
      } catch (error) {
        if (error instanceof GitHubError && error.status === 401) {
          return {
            phase: "setup",
            client,
            error: "The saved token was rejected. Sign in again.",
          } as State
        }
        // Offline: start from cached data with the last known viewer.
        const cached = localStorage.getItem(VIEWER_KEY)
        if (cached) return ready(client, JSON.parse(cached) as Viewer)
        throw error
      }
    })()
      .then((next) => !cancelled && setState(next))
      .catch((error) => !cancelled && setState({ phase: "failed", error: String(error) }))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <TooltipProvider>
      {state.phase === "loading" && <div className="h-svh" />}
      {state.phase === "failed" && (
        <div className="p-8 text-sm text-destructive">Could not start: {state.error}</div>
      )}
      {state.phase === "setup" && (
        <Setup
          client={state.client}
          error={state.error}
          onSignedIn={(viewer) => setState(ready(state.client, viewer))}
        />
      )}
      {state.phase === "ready" && <App client={state.client} viewer={state.viewer} />}
      <Toaster theme={theme} position="bottom-right" />
    </TooltipProvider>
  )
}

function ready(client: GitHubClient, viewer: Viewer): State {
  localStorage.removeItem(SIGNED_OUT_KEY)
  localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer))
  client.startSync()
  return { phase: "ready", client, viewer }
}

function App({ client, viewer }: { client: GitHubClient; viewer: Viewer }) {
  const [router] = useState(() => createAppRouter())
  return (
    <SessionContext.Provider value={{ client, viewer }}>
      <RouterProvider router={router} />
    </SessionContext.Provider>
  )
}
