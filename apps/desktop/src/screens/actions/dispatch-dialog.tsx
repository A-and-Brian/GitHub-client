import {
  type DispatchInput,
  type DispatchValues,
  dispatchPayload,
  initialDispatchValues,
  type Workflow,
} from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Checkbox } from "@github-client/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@github-client/ui/components/dialog"
import { Input } from "@github-client/ui/components/input"
import { Label } from "@github-client/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@github-client/ui/components/select"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useClient } from "@/app/client"

type Inputs =
  | { status: "loading" }
  | { status: "ready"; inputs: DispatchInput[] }
  | { status: "no-trigger" }
  | { status: "error"; message: string }

export function DispatchDialog({
  repo,
  workflows,
  initialWorkflow,
  open,
  onOpenChange,
}: {
  repo: string
  workflows: Workflow[]
  initialWorkflow?: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useClient()
  const defaultBranch = useLiveQuery(
    (q) =>
      q.from({ r: client.collections.repos.collection }).where(({ r }) => eq(r.fullName, repo)),
    [repo],
  ).data[0]?.defaultBranch
  // Workflows under `dynamic/` (Dependabot, Pages, Copilot) have no YAML file to dispatch.
  const candidates = workflows.filter((w) => w.state === "active" && !w.path.startsWith("dynamic/"))
  const [workflowId, setWorkflowId] = useState<number>()
  const [ref, setRef] = useState("")
  const [inputs, setInputs] = useState<Inputs>({ status: "loading" })
  const [values, setValues] = useState<DispatchValues>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form each time the dialog opens
  useEffect(() => {
    if (!open) return
    setWorkflowId(initialWorkflow ?? candidates[0]?.id)
    setRef(defaultBranch ?? "main")
    setErrors({})
  }, [open])

  const workflow = candidates.find((w) => w.id === workflowId)
  const path = workflow?.path
  const branch = ref.trim()

  useEffect(() => {
    if (!open || !path || !branch) return
    let cancelled = false
    setInputs({ status: "loading" })
    // Waits for typing in the ref field to settle before reading the workflow file.
    const timer = setTimeout(() => {
      client.fetchDispatchInputs(repo, path, branch).then(
        (result) => {
          if (cancelled) return
          if (result === null) return setInputs({ status: "no-trigger" })
          setInputs({ status: "ready", inputs: result })
          setValues(initialDispatchValues(result))
          setErrors({})
        },
        (e) => {
          if (cancelled) return
          const message = e instanceof Error ? e.message : String(e)
          setInputs({
            status: "error",
            message: `Could not read ${path} at ${branch}: ${message}`,
          })
        },
      )
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, repo, open, path, branch])

  const submit = async () => {
    if (!workflow || inputs.status !== "ready") return
    const payload = dispatchPayload(inputs.inputs, values)
    if (!payload.ok) return setErrors(payload.errors)
    setBusy(true)
    try {
      await client.dispatchWorkflow(repo, workflow.id, branch, payload.inputs)
      toast.success(`Started "${workflow.name}" on ${branch}. The run appears in a few seconds.`)
      onOpenChange(false)
    } catch (e) {
      toast.error(`Dispatch failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run workflow</DialogTitle>
          <DialogDescription>
            Starts a workflow that has a <code>workflow_dispatch</code> trigger.
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">This repository has no active workflows.</p>
        ) : (
          <form
            className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <Field label="Workflow">
              <Select
                value={workflowId ?? null}
                onValueChange={(v) => setWorkflowId(v ?? undefined)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{workflow?.name ?? "Pick a workflow"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Branch or tag" htmlFor="dispatch-ref">
              <Input id="dispatch-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
            </Field>
            {!branch ? null : inputs.status === "loading" ? (
              <p className="text-sm text-muted-foreground">Reading workflow inputs…</p>
            ) : inputs.status === "no-trigger" ? (
              <p className="rounded-md bg-muted p-3 text-sm">
                <strong>{workflow?.name}</strong> has no <code>workflow_dispatch</code> trigger at{" "}
                <code>{branch}</code>, so it cannot be run manually.
              </p>
            ) : inputs.status === "error" ? (
              <p className="text-sm text-destructive">{inputs.message}</p>
            ) : (
              inputs.inputs.map((input) => (
                <InputField
                  key={input.name}
                  input={input}
                  value={values[input.name]}
                  error={errors[input.name]}
                  onChange={(value) => setValues((v) => ({ ...v, [input.name]: value }))}
                />
              ))
            )}
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={busy || inputs.status !== "ready" || !branch} onClick={submit}>
            Run workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string | null
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function InputField({
  input,
  value,
  error,
  onChange,
}: {
  input: DispatchInput
  value: string | boolean | undefined
  error?: string
  onChange: (value: string | boolean) => void
}) {
  const id = `dispatch-input-${input.name}`
  const label = `${input.name}${input.required ? " *" : ""}`
  if (input.type === "boolean") {
    return (
      <div className="flex flex-col gap-1">
        <Label className="flex items-center gap-2">
          <Checkbox checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
          {input.name}
        </Label>
        {input.description && (
          <p className="pl-6 text-xs text-muted-foreground">{input.description}</p>
        )}
      </div>
    )
  }
  if (input.type === "choice") {
    return (
      <Field label={label} hint={input.description} error={error}>
        <Select value={String(value ?? "")} onValueChange={(v) => onChange(v ?? "")}>
          <SelectTrigger className="w-full" aria-invalid={Boolean(error)}>
            <SelectValue>{String(value ?? "") || "Pick an option"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {input.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    )
  }
  return (
    <Field label={label} htmlFor={id} hint={input.description} error={error}>
      <Input
        id={id}
        type={input.type === "number" ? "number" : "text"}
        placeholder={input.type === "environment" ? "Environment name" : undefined}
        aria-invalid={Boolean(error)}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}
