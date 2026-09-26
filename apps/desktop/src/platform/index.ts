import type { Platform } from "@github-client/core"
import { isTauri } from "@tauri-apps/api/core"

export const isDesktop = isTauri()

export async function createPlatform(): Promise<Platform> {
  if (isDesktop) return (await import("./tauri")).createTauriPlatform()
  return (await import("./browser")).createBrowserPlatform()
}

/** Opens a URL in the system browser. */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop) {
    const { openUrl } = await import("@tauri-apps/plugin-opener")
    await openUrl(url)
  } else {
    window.open(url, "_blank", "noopener")
  }
}
