import { useEffect } from "react"
import { toast } from "sonner"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Default presentation for user-facing async failures. Keep field validation and recovery context inline. */
export function showError(title: string, error?: unknown, options?: { id?: string | number }) {
  return toast.error(title, {
    ...options,
    description: error == null ? undefined : errorMessage(error),
  })
}

/** One owner per source, at screen level rather than in every status badge. */
export function useErrorToast(error: unknown, { id, title }: { id: string; title: string }) {
  const message = error == null ? undefined : errorMessage(error)
  useEffect(() => {
    if (message === undefined) return
    const toastId = showError(title, message, { id })
    return () => {
      toast.dismiss(toastId)
    }
  }, [id, title, message])
}
