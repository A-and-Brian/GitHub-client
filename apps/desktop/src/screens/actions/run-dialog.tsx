import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@github-client/ui/components/dialog"
import { RunContent } from "./run"

export type RunDialogProps = {
  open: boolean
  owner: string
  name: string
  runId: number
  job?: number
  onJobChange: (id: number) => void
  onBack: () => void
}

/** Reuses the Actions run detail inside a modal while keeping its host page mounted. */
export function RunDialog({ open, owner, name, runId, job, onJobChange, onBack }: RunDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onBack()}>
      <DialogContent className="h-dvh max-w-full overflow-hidden rounded-none p-0 sm:h-[min(88vh,900px)] sm:max-w-[min(1100px,calc(100%-2rem))] sm:rounded-xl">
        <DialogTitle className="sr-only">Workflow run {runId}</DialogTitle>
        <DialogDescription className="sr-only">
          Workflow run details, jobs, and logs for {owner}/{name}.
        </DialogDescription>
        <RunContent
          owner={owner}
          name={name}
          runId={runId}
          job={job}
          onJobChange={onJobChange}
          onBack={onBack}
          embedded
        />
      </DialogContent>
    </Dialog>
  )
}
