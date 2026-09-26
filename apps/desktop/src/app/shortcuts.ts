import { useEffect, useRef } from "react"

type Handler = (event: KeyboardEvent) => void

/** Key names follow `KeyboardEvent.key`; prefix with `mod+` for Ctrl or Cmd, `shift+` for Shift. */
export type Shortcuts = Record<string, Handler>

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  )
}

function keyName(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push("mod")
  if (event.shiftKey && event.key.length > 1) parts.push("shift")
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key)
  return parts.join("+")
}

/**
 * Registers keyboard shortcuts while the component is mounted. Plain keys are
 * ignored while typing; `mod+` shortcuts always fire. The first handler for a key
 * wins; `priority` handlers run before all others (for example, Escape closing an
 * open editor instead of leaving the page), whatever the mount order.
 */
export function useShortcuts(
  shortcuts: Shortcuts,
  enabled = true,
  { priority = false } = {},
): void {
  const ref = useRef(shortcuts)
  ref.current = shortcuts
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return
      const name = keyName(event)
      const handler = ref.current[name] ?? (event.key === "?" ? ref.current["?"] : undefined)
      if (!handler) return
      if (!name.startsWith("mod+") && isEditableTarget(event.target)) return
      event.preventDefault()
      handler(event)
    }
    window.addEventListener("keydown", onKeyDown, { capture: priority })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: priority })
  }, [enabled, priority])
}
