import type { Platform } from "@github-client/core"
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from "@tanstack/browser-db-sqlite-persistence"

const TOKEN_KEY = "github-client.dev-token"

/**
 * Browser platform for development. The token lives in `sessionStorage` only,
 * so it is gone when the tab closes. Use the desktop app for real use.
 */
export async function createBrowserPlatform(): Promise<Platform> {
  let persistence: Platform["persistence"]
  try {
    const database = await openBrowserWASQLiteOPFSDatabase({ databaseName: "github-client.sqlite" })
    persistence = createBrowserWASQLitePersistence({ database })
  } catch (error) {
    console.warn("OPFS SQLite unavailable; data stays in memory", error)
  }
  return {
    fetch: globalThis.fetch.bind(globalThis),
    persistence,
    secrets: {
      get: async () => sessionStorage.getItem(TOKEN_KEY),
      set: async (token) => sessionStorage.setItem(TOKEN_KEY, token),
      clear: async () => sessionStorage.removeItem(TOKEN_KEY),
    },
  }
}
