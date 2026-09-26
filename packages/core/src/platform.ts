import type { PersistedCollectionPersistence } from "@tanstack/db-sqlite-persistence-core"
import type { Fetch } from "./github/rest"

/** Stores the GitHub token. Desktop uses the OS keychain. */
export interface SecretStore {
  get(): Promise<string | null>
  set(token: string): Promise<void>
  clear(): Promise<void>
}

/** Services that differ between desktop, browser, and tests. */
export interface Platform {
  fetch: Fetch
  /** Absent when no SQLite is available; collections then live in memory only. */
  persistence?: PersistedCollectionPersistence
  secrets: SecretStore
  /** `GITHUB_TOKEN` from the environment, when the platform can read it. */
  envToken?: () => Promise<string | null>
  /** Token of the GitHub CLI (`gh auth token`), when the platform can run it. */
  ghToken?: () => Promise<string | null>
}
