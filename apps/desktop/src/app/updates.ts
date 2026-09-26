import type { Update } from "@tauri-apps/plugin-updater"
import { useSyncExternalStore } from "react"
import { toast } from "sonner"
import { showError } from "@/app/errors"
import { UPDATE_DISMISSED_KEY } from "@/app/storage-keys"
import { isDesktop } from "@/platform"

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 10 * 1000
const TOAST_ID = "app-update"

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string }
  | { status: "installing"; version: string; progress?: number }
  | { status: "error"; message: string }

let state: UpdateState = { status: "idle" }
let pending: Update | undefined
const listeners = new Set<() => void>()

function setState(next: UpdateState) {
  state = next
  for (const listener of listeners) listener()
}

/** Current update status. Always `idle` outside the desktop app. */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/**
 * Asks the release feed for a newer version. Background checks only toast once
 * per version; manual checks always report the result.
 */
export async function checkForUpdates({ manual = false } = {}): Promise<void> {
  if (!isDesktop || state.status === "checking" || state.status === "installing") return
  setState({ status: "checking" })
  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    const update = await check()
    await pending?.close()
    pending = update ?? undefined
    if (!update) {
      setState({ status: "current" })
      if (manual) toast.success("GitHub-client is up to date")
      return
    }
    setState({ status: "available", version: update.version })
    if (manual || localStorage.getItem(UPDATE_DISMISSED_KEY) !== update.version) {
      promptInstall(update.version)
    }
  } catch (error) {
    setState({ status: "error", message: String(error) })
    if (manual) showError("Could not check for updates", error)
  }
}

function promptInstall(version: string) {
  toast.info(`Version ${version} is available`, {
    id: TOAST_ID,
    description: "Install it now? The app restarts when the update is done.",
    duration: Number.POSITIVE_INFINITY,
    action: { label: "Install", onClick: () => void installUpdate() },
    onDismiss: () => localStorage.setItem(UPDATE_DISMISSED_KEY, version),
  })
}

/** Downloads and installs the found update, then restarts the app. */
export async function installUpdate(): Promise<void> {
  const update = pending
  if (!update || state.status === "installing") return
  toast.dismiss(TOAST_ID)
  let total = 0
  let received = 0
  setState({ status: "installing", version: update.version })
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0
      if (event.event === "Progress") {
        received += event.data.chunkLength
        if (total > 0) {
          setState({ status: "installing", version: update.version, progress: received / total })
        }
      }
    })
    // Windows quits for the installer before this point; other platforms restart here.
    const { relaunch } = await import("@tauri-apps/plugin-process")
    await relaunch()
  } catch (error) {
    setState({ status: "available", version: update.version })
    showError("Could not install the update", error)
  }
}

/** Checks shortly after launch and then every few hours. Returns a stop function. */
export function startUpdateChecks(): () => void {
  if (!isDesktop) return () => {}
  const first = setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS)
  const interval = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(interval)
  }
}

/** Version of the running app, or undefined outside the desktop app. */
export async function appVersion(): Promise<string | undefined> {
  if (!isDesktop) return undefined
  const { getVersion } = await import("@tauri-apps/api/app")
  return getVersion()
}
