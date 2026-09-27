import type { ReactNode } from "react"
import { isDesktop } from "@/platform"

const isMacOS =
  typeof navigator !== "undefined" &&
  (navigator.platform.startsWith("Mac") || navigator.userAgent.includes("Mac OS X"))

export const isMacDesktop = isDesktop && isMacOS

/** Reserves the native traffic-light area and provides a blank native drag area. */
export function WindowChrome({ trailing }: { trailing?: ReactNode }) {
  if (!isMacDesktop) return null

  return (
    <div className="flex h-10 shrink-0 items-center">
      <div aria-hidden="true" className="h-full w-20 shrink-0" />
      <div aria-hidden="true" className="h-full min-w-0 flex-1" data-tauri-drag-region />
      {trailing}
    </div>
  )
}
