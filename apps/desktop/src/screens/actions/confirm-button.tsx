import { Button } from "@github-client/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@github-client/ui/components/dialog"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"

/** A button that asks for confirmation, runs `action`, and reports the outcome in a toast. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  success,
  destructive,
  size = "sm",
  action,
}: {
  children: ReactNode
  title: string
  description: string
  confirmLabel: string
  success: string
  destructive?: boolean
  size?: "sm" | "xs"
  action: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      setOpen(false)
    } catch (e) {
      toast.error(`${title} failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant={destructive ? "destructive" : "outline"}
        size={size}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={confirm}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
