import type { InboxMutationResult, InboxUndoToken, PullRequest } from "@github-client/core"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSession } from "@/app/client"
import { isEditableTarget } from "@/app/shortcuts"

const inboxUndoToastId = (token: InboxUndoToken) => `inbox-undo-${token.id}`
let activeMutationOwner: object | null = null

export function useInboxMutations() {
  const { client, viewer } = useSession()
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const latestUndo = useRef<InboxUndoToken | null>(null)
  const mounted = useRef(false)
  const pending = useRef(new Map<number, { token: InboxUndoToken; timer: number }>())
  const [owner] = useState<object>(() => ({}))
  // biome-ignore lint/correctness/useExhaustiveDependencies: discard pending notifications when the session changes
  useEffect(() => {
    mounted.current = true
    activeMutationOwner = owner
    return () => {
      mounted.current = false
      latestUndo.current = null
      for (const { token, timer } of pending.current.values()) {
        window.clearTimeout(timer)
        toast.dismiss(inboxUndoToastId(token))
      }
      pending.current.clear()
      if (activeMutationOwner === owner) {
        activeMutationOwner = null
      }
    }
  }, [owner, client, viewer.login])
  const runMutation = async (
    pull: PullRequest,
    label: string,
    mutation: () => Promise<InboxMutationResult>,
  ) => {
    if (!mounted.current || activeMutationOwner !== owner || busyIds.has(pull.id)) return
    setBusyIds((current) => new Set(current).add(pull.id))
    try {
      const result = await mutation()
      if (!mounted.current || activeMutationOwner !== owner) return
      if (!result.undo) return
      const token = result.undo
      latestUndo.current = token
      toast.success(label, {
        id: inboxUndoToastId(token),
        description: `${pull.repo} #${pull.number} · ${pull.title}`,
        duration: Math.max(0, token.expiresAt - Date.now()),
        action: {
          label: "Undo",
          onClick: () => {
            void undoMutation(token)
          },
        },
      })
      const timer = window.setTimeout(
        () => forgetUndo(token),
        Math.max(0, token.expiresAt - Date.now()),
      )
      pending.current.set(token.id, { token, timer })
    } catch (error) {
      if (!mounted.current || activeMutationOwner !== owner) return
      toast.error(String(error), {
        action: {
          label: "Retry",
          onClick: () => {
            if (mounted.current && activeMutationOwner === owner)
              void runMutation(pull, label, mutation)
          },
        },
      })
    } finally {
      if (mounted.current && activeMutationOwner === owner) {
        setBusyIds((current) => {
          const next = new Set(current)
          next.delete(pull.id)
          return next
        })
      }
    }
  }
  const runRowMutation = (
    pull: PullRequest,
    label: string,
    mutation: () => Promise<InboxMutationResult>,
    focusTarget: "row" | "snoozed" | "settled" = "row",
  ) => {
    const focusAtStart = document.activeElement
    void runMutation(pull, label, mutation).then(() => {
      requestAnimationFrame(() => {
        if (!mounted.current || activeMutationOwner !== owner) return
        if (
          document.activeElement !== focusAtStart &&
          document.activeElement !== document.body &&
          document.activeElement !== null
        )
          return
        const rowAction = document.querySelector<HTMLElement>(
          `[data-pull-id="${CSS.escape(pull.id)}"] [aria-label^="Actions for "]`,
        )
        const fallback =
          focusTarget === "row"
            ? null
            : document.querySelector<HTMLElement>(`[data-inbox-shelf="${focusTarget}"]`)
        ;(rowAction ?? fallback)?.focus({ preventScroll: true })
      })
    })
  }
  const forgetUndo = (token: InboxUndoToken) => {
    const entry = pending.current.get(token.id)
    if (!entry) return
    window.clearTimeout(entry.timer)
    pending.current.delete(token.id)
    toast.dismiss(inboxUndoToastId(token))
    if (latestUndo.current?.id === token.id) {
      latestUndo.current = [...pending.current.values()].at(-1)?.token ?? null
    }
  }
  const undoMutation = async (token: InboxUndoToken) => {
    if (!mounted.current || activeMutationOwner !== owner || !pending.current.has(token.id)) return
    try {
      const restored = await client.undoInboxMutation(token)
      if (!mounted.current || activeMutationOwner !== owner || !pending.current.has(token.id))
        return
      forgetUndo(token)
      if (!restored) toast.error("Undo is no longer available because the inbox changed.")
    } catch (error) {
      if (mounted.current && activeMutationOwner === owner && pending.current.has(token.id))
        toast.error(String(error))
    }
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z" ||
        isEditableTarget(event.target)
      )
        return
      const token = latestUndo.current
      if (!token) return
      event.preventDefault()
      event.stopPropagation()
      void undoMutation(token)
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  })
  return { busyIds, latestUndo, runMutation, runRowMutation, undoMutation }
}
