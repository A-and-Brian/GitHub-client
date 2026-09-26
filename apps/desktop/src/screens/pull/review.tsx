import type { PullRequestDetail, ReviewEvent } from "@github-client/core"
import { prKey } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@github-client/ui/components/dialog"
import { Textarea } from "@github-client/ui/components/textarea"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { useState } from "react"
import { toast } from "sonner"
import { useClient, useSession } from "@/app/client"
import { useShortcuts } from "@/app/shortcuts"

const EVENTS: Array<{ value: ReviewEvent; label: string; hint: string }> = [
  { value: "COMMENT", label: "Comment", hint: "General feedback without approval." },
  { value: "APPROVE", label: "Approve", hint: "Approve merging these changes." },
  { value: "REQUEST_CHANGES", label: "Request changes", hint: "Feedback that must be addressed." },
]

/** Opens the review dialog; shows how many draft comments will be submitted. Shortcut: `v`. */
export function ReviewButton({ detail }: { detail: PullRequestDetail }) {
  const client = useClient()
  const { viewer } = useSession()
  const [open, setOpen] = useState(false)
  const [event, setEvent] = useState<ReviewEvent>("COMMENT")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const key = prKey(detail.repo, detail.number)
  const drafts = useLiveQuery(
    (q) => q.from({ d: client.collections.drafts }).where(({ d }) => eq(d.prKey, key)),
    [key],
  ).data
  const ownPull = detail.author?.login === viewer.login

  useShortcuts({ v: () => setOpen(true) }, !open)

  const submit = async () => {
    setBusy(true)
    try {
      await client.submitReview(detail.repo, detail.number, event, body)
      toast.success("Review submitted")
      setBody("")
      setOpen(false)
    } catch (e) {
      toast.error(`Review failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  const needsBody = event !== "APPROVE" && !body.trim() && drafts.length === 0

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Review{drafts.length > 0 ? ` (${drafts.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit review</DialogTitle>
            <DialogDescription>
              {drafts.length > 0
                ? `${drafts.length} draft comment${drafts.length === 1 ? "" : "s"} will be included.`
                : "No draft comments. Add them from the Files tab."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={5}
            placeholder="Summary (Markdown). Ctrl+Enter to submit."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !needsBody) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className="flex flex-col gap-1">
            {EVENTS.map((option) => {
              const disabled = ownPull && option.value !== "COMMENT"
              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm hover:bg-accent",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <input
                    type="radio"
                    name="review-event"
                    className="mt-1"
                    disabled={disabled}
                    checked={event === option.value}
                    onChange={() => setEvent(option.value)}
                  />
                  <span>
                    <span className="font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.hint}</span>
                  </span>
                </label>
              )
            })}
          </div>
          <DialogFooter>
            <Button disabled={busy || needsBody} onClick={submit}>
              Submit review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
