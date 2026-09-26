import { type GitHubClient, REQUIRED_SCOPES, type Viewer } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Input } from "@github-client/ui/components/input"
import { Label } from "@github-client/ui/components/label"
import { Alert, AlertDescription, AlertTitle } from "@github-client/ui/components/reui/alert"
import { useState } from "react"
import { toast } from "sonner"
import { showError, useErrorToast } from "@/app/errors"
import { isDesktop, openExternal } from "@/platform"

const NEW_TOKEN_URL = `https://github.com/settings/tokens/new?description=GitHub-client&scopes=${REQUIRED_SCOPES.join(",")},notifications`

export function Setup({
  client,
  error,
  onSignedIn,
}: {
  client: GitHubClient
  error?: string
  onSignedIn: (viewer: Viewer) => void
}) {
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(error)
  useErrorToast(error, { id: "setup-error", title: "Sign-in required" })

  const signIn = async (value: string) => {
    setBusy(true)
    setProblem(undefined)
    try {
      const check = await client.signIn(value.trim())
      if (check.missingScopes.length > 0) {
        toast.warning(
          `Token is missing scopes: ${check.missingScopes.join(", ")}. Some features will fail.`,
        )
      }
      onSignedIn(check.viewer)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setProblem(detail)
      showError("Sign-in failed", e)
    } finally {
      setBusy(false)
    }
  }

  const useEnvToken = async () => {
    try {
      const envToken = await client.platform.envToken?.()
      if (envToken) await signIn(envToken)
      else {
        const message = "GITHUB_TOKEN is not set in the environment the app was started from."
        setProblem(message)
        showError("GITHUB_TOKEN is unavailable", message)
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setProblem(`Could not read GITHUB_TOKEN: ${detail}`)
      showError("Could not read GITHUB_TOKEN", e)
    }
  }

  const importFromGh = async () => {
    try {
      const ghToken = await client.platform.ghToken?.()
      if (ghToken) await signIn(ghToken)
      else {
        const message = "The GitHub CLI is not installed or not logged in (`gh auth login`)."
        setProblem(message)
        showError("GitHub CLI token unavailable", message)
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setProblem(`Could not read a token from GitHub CLI: ${detail}`)
      showError("Could not read GitHub CLI token", e)
    }
  }

  return (
    <div className="flex h-svh items-center justify-center p-6">
      <form
        className="flex w-full max-w-md flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void signIn(token)
        }}
      >
        <div>
          <h1 className="text-lg font-semibold">Sign in to GitHub</h1>
          <p className="text-sm text-muted-foreground">
            Paste a classic personal access token with the scopes{" "}
            <code>{REQUIRED_SCOPES.join(", ")}</code>.{" "}
            {isDesktop
              ? "It is stored in your system keychain."
              : "Development mode: the token is kept for this browser tab only."}
          </p>
        </div>
        {problem && (
          <Alert variant="destructive">
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="token">Personal access token</Label>
          <Input
            id="token"
            type="password"
            autoFocus
            autoComplete="off"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !token.trim()}>
            Sign in
          </Button>
          {client.platform.ghToken && (
            <Button type="button" variant="outline" disabled={busy} onClick={importFromGh}>
              Use GitHub CLI token
            </Button>
          )}
          {client.platform.envToken && (
            <Button type="button" variant="outline" disabled={busy} onClick={useEnvToken}>
              Use GITHUB_TOKEN
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => openExternal(NEW_TOKEN_URL)}>
            Create a token
          </Button>
        </div>
      </form>
    </div>
  )
}
