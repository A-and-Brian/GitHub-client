import type { Platform } from "@github-client/core"
import { createTauriSQLitePersistence } from "@tanstack/tauri-db-sqlite-persistence"
import { invoke } from "@tauri-apps/api/core"
import { fetch } from "@tauri-apps/plugin-http"
import Database from "@tauri-apps/plugin-sql"

export async function createTauriPlatform(): Promise<Platform> {
  await invoke("initialize_database")
  const database = Database.get("sqlite:github-client.sqlite")
  return {
    // The Rust HTTP client has no CORS limits, which Actions log redirects need.
    fetch: fetch as typeof globalThis.fetch,
    persistence: createTauriSQLitePersistence({ database }),
    secrets: {
      get: () => invoke<string | null>("secret_get"),
      set: (token) => invoke("secret_set", { token }),
      clear: () => invoke("secret_clear"),
    },
    envToken: () => invoke<string | null>("env_token"),
    ghToken: () => invoke<string | null>("gh_token"),
  }
}
