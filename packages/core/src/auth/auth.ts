import type { Viewer } from "../domain/types"
import type { RestClient } from "../github/rest"
import type { Platform } from "../platform"

/**
 * Supplies the token used for GitHub requests. v1 has one implementation,
 * `TokenAuthProvider`. A GitHub App provider (device flow) comes in phase 2.
 */
export interface AuthProvider {
  getToken(): string | null
  /** Loads a stored token. Returns false when none is available. */
  restore(): Promise<boolean>
  signIn(token: string): Promise<void>
  signOut(): Promise<void>
}

export type TokenSource = "stored" | "env"

export class TokenAuthProvider implements AuthProvider {
  private token: string | null = null
  source: TokenSource | null = null

  constructor(private readonly platform: Platform) {}

  getToken(): string | null {
    return this.token
  }

  async restore(): Promise<boolean> {
    const stored = await this.platform.secrets.get()
    if (stored) {
      this.token = stored
      this.source = "stored"
      return true
    }
    const env = await this.platform.envToken?.()
    if (env) {
      this.token = env
      this.source = "env"
      return true
    }
    return false
  }

  async signIn(token: string): Promise<void> {
    await this.platform.secrets.set(token)
    this.token = token
    this.source = "stored"
  }

  async signOut(): Promise<void> {
    await this.platform.secrets.clear()
    this.token = null
    this.source = null
  }
}

/** Scopes v1 needs on a classic token. Fine-grained tokens report no scopes. */
export const REQUIRED_SCOPES = ["repo", "workflow", "read:org"] as const

export interface TokenCheck {
  viewer: Viewer
  /** Null for fine-grained tokens, which do not report scopes. */
  scopes: string[] | null
  missingScopes: string[]
}

/** Validates a token by loading the viewer, and reports missing classic scopes. */
export async function checkToken(rest: RestClient): Promise<TokenCheck> {
  const response = await rest.send("GET", rest.url("/user"))
  const user = (await response.json()) as { login: string; name: string | null; avatar_url: string }
  const header = response.headers.get("X-OAuth-Scopes")
  const scopes =
    header === null
      ? null
      : header
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
  return {
    viewer: { login: user.login, name: user.name, avatarUrl: user.avatar_url },
    scopes,
    missingScopes: scopes ? REQUIRED_SCOPES.filter((s) => !hasScope(scopes, s)) : [],
  }
}

// `admin:org` and `write:org` include `read:org`.
function hasScope(scopes: string[], scope: string): boolean {
  if (scopes.includes(scope)) return true
  return scope === "read:org" && (scopes.includes("admin:org") || scopes.includes("write:org"))
}
