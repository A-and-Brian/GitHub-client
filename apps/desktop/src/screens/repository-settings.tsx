import {
  changedRepositorySettings,
  getRepositorySettings,
  RepositorySettingsConflictError,
  type RepositorySettings as RepositorySettingsData,
  type RepositorySettingsDraft,
  type RepositorySettingsField,
  RepositorySettingsPermissionError,
  RepositorySettingsReadbackError,
  rebaseRepositorySettingsDraft,
  updateRepositorySettings,
} from "@github-client/core/actions/repository-settings"
import { Button } from "@github-client/ui/components/button"
import { Checkbox } from "@github-client/ui/components/checkbox"
import { Input } from "@github-client/ui/components/input"
import { Label } from "@github-client/ui/components/label"
import { useEffect, useRef, useState } from "react"
import { useSession } from "@/app/client"
import { RepositoryContext } from "@/components/repository-context"

export function RepositorySettings({ owner, repo }: { owner: string; repo: string }) {
  const { client } = useSession()
  const [settings, setSettings] = useState<RepositorySettingsData | null>(null)
  const [draft, setDraft] = useState<RepositorySettingsDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uncertainFields, setUncertainFields] = useState<RepositorySettingsField[] | null>(null)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const repoName = `${owner}/${repo}`

  useEffect(() => {
    const version = ++requestVersion.current
    setLoading(true)
    setSaving(false)
    setSettings(null)
    setDraft(null)
    setError(null)
    setNotice(null)
    setUncertainFields(null)
    setMergeError(null)
    void getRepositorySettings(client.rest, owner, repo)
      .then((loaded) => {
        if (requestVersion.current !== version) return
        setSettings(loaded)
        setDraft(toDraft(loaded))
      })
      .catch((cause: unknown) => {
        if (requestVersion.current === version) setError(message(cause))
      })
      .finally(() => {
        if (requestVersion.current === version) setLoading(false)
      })
    return () => {
      requestVersion.current++
    }
  }, [client, owner, repo])

  const setField = <K extends keyof RepositorySettingsDraft>(
    key: K,
    value: RepositorySettingsDraft[K],
  ) => {
    setError(null)
    setNotice(null)
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  const setMergeMethod = (
    key: "allowSquashMerge" | "allowRebaseMerge" | "allowMergeCommit",
    value: boolean,
  ) => {
    if (!draft) return
    setError(null)
    setNotice(null)
    const next = { ...draft, [key]: value }
    if (!next.allowSquashMerge && !next.allowRebaseMerge && !next.allowMergeCommit) {
      setMergeError("At least one merge method must remain enabled.")
    } else {
      setMergeError(null)
    }
    setDraft(next)
  }

  const cancel = () => {
    if (settings) setDraft(toDraft(settings))
    setMergeError(null)
    setError(null)
    setNotice(null)
  }

  const save = async () => {
    if (!settings || !draft || saving || mergeError || uncertainFields) return
    const version = requestVersion.current
    const changedFields = Object.keys(
      changedRepositorySettings(settings, draft),
    ) as RepositorySettingsField[]
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await updateRepositorySettings(client.rest, owner, repo, settings, draft)
      if (requestVersion.current !== version) return
      setSettings(saved)
      setDraft(toDraft(saved))
      setNotice("GitHub confirmed the updated settings.")
    } catch (cause) {
      if (requestVersion.current !== version) return
      if (cause instanceof RepositorySettingsConflictError) {
        setSettings(cause.latest)
        setDraft(rebaseRepositorySettingsDraft(cause.latest, draft, changedFields))
        const latestValues = cause.fields
          .map((field) => `${SETTING_LABELS[field]}: ${String(cause.latest[field] ?? "empty")}`)
          .join("; ")
        setError(
          `${cause.message}. Current GitHub values: ${latestValues}. Your draft is retained.`,
        )
      } else if (cause instanceof RepositorySettingsPermissionError) {
        setSettings(cause.latest)
        setDraft(rebaseRepositorySettingsDraft(cause.latest, draft, changedFields))
        setError(`${cause.message}. Your draft is still here.`)
      } else if (cause instanceof RepositorySettingsReadbackError) {
        setUncertainFields(changedFields)
        setNotice("GitHub accepted the save, but confirmation is pending.")
        setError("Your draft is retained while GitHub's updated values are unconfirmed.")
      } else {
        setError(`Save failed. Your draft is still here. ${message(cause)}`)
      }
    } finally {
      if (requestVersion.current === version) setSaving(false)
    }
  }

  const retryConfirmation = async () => {
    if (!draft || !uncertainFields || saving) return
    const version = requestVersion.current
    setSaving(true)
    try {
      const latest = await getRepositorySettings(client.rest, owner, repo)
      if (requestVersion.current !== version) return
      const confirmed = uncertainFields.every((key) => latest[key] === draft[key])
      setSettings(latest)
      setUncertainFields(null)
      if (confirmed) {
        setDraft(toDraft(latest))
        setError(null)
        setNotice("GitHub confirmed the updated settings.")
      } else {
        setDraft(rebaseRepositorySettingsDraft(latest, draft, uncertainFields))
        setError(
          "GitHub's current values differ from the accepted save. Your draft is retained for review.",
        )
        setNotice(null)
      }
    } catch (cause) {
      if (requestVersion.current === version)
        setError(`Confirmation is still pending. Your draft is retained. ${message(cause)}`)
    } finally {
      if (requestVersion.current === version) setSaving(false)
    }
  }

  const changed =
    settings && draft && Object.keys(changedRepositorySettings(settings, draft)).length > 0

  return (
    <div className="h-full overflow-y-auto">
      <RepositoryContext owner={owner} repo={repo} location="Settings" />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <header>
          <p className="text-xs text-muted-foreground">Repository settings</p>
          <h1 className="text-xl font-semibold">{repoName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit the GitHub settings supported here. Other repository settings stay on GitHub.
          </p>
        </header>

        {settings && !settings.canAdmin && (
          <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
            You don’t have repository admin access. Settings are read-only.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className={`text-sm ${uncertainFields ? "text-warning" : "text-success"}`}
          >
            {notice}
          </p>
        )}
        {loading && <p className="text-sm text-muted-foreground">Loading settings from GitHub…</p>}
        {!loading && error && !settings && (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              setError(null)
              setLoading(true)
              const version = ++requestVersion.current
              void getRepositorySettings(client.rest, owner, repo)
                .then((loaded) => {
                  if (requestVersion.current !== version) return
                  setSettings(loaded)
                  setDraft(toDraft(loaded))
                })
                .catch((cause: unknown) => {
                  if (requestVersion.current === version) setError(message(cause))
                })
                .finally(() => {
                  if (requestVersion.current === version) setLoading(false)
                })
            }}
          >
            Retry
          </Button>
        )}

        {draft && (
          <fieldset
            disabled={!settings?.canAdmin || saving || Boolean(uncertainFields)}
            className="flex flex-col gap-6 disabled:opacity-70"
          >
            <section className="flex flex-col gap-4 rounded-lg border p-4">
              <div>
                <h2 className="font-medium">Repository details</h2>
                <p className="text-sm text-muted-foreground">
                  Description and homepage shown on GitHub.
                </p>
              </div>
              <Field
                label="Description"
                htmlFor="repo-description"
                hint={draft.description === undefined ? "Unavailable from GitHub." : undefined}
              >
                <Input
                  id="repo-description"
                  maxLength={350}
                  value={draft.description ?? ""}
                  disabled={draft.description === undefined}
                  onChange={(e) => setField("description", e.target.value || null)}
                />
              </Field>
              <Field
                label="Homepage URL"
                htmlFor="repo-homepage"
                hint={draft.homepage === undefined ? "Unavailable from GitHub." : undefined}
              >
                <Input
                  id="repo-homepage"
                  type="url"
                  value={draft.homepage ?? ""}
                  disabled={draft.homepage === undefined}
                  onChange={(e) => setField("homepage", e.target.value || null)}
                />
              </Field>
            </section>

            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <div>
                <h2 className="font-medium">Features</h2>
                <p className="text-sm text-muted-foreground">Turn repository features on or off.</p>
              </div>
              <SettingCheck
                id="repo-issues"
                label="Issues"
                checked={draft.hasIssues ?? false}
                disabled={draft.hasIssues === undefined}
                unavailable={draft.hasIssues === undefined}
                onChange={(value) => setField("hasIssues", value)}
              />
              <SettingCheck
                id="repo-wiki"
                label="Wiki"
                checked={draft.hasWiki ?? false}
                disabled={draft.hasWiki === undefined}
                unavailable={draft.hasWiki === undefined}
                onChange={(value) => setField("hasWiki", value)}
              />
            </section>

            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <div>
                <h2 className="font-medium">Pull requests</h2>
                <p className="text-sm text-muted-foreground">
                  Choose which merge methods this repository accepts.
                </p>
              </div>
              <SettingCheck
                id="repo-squash"
                label="Squash merging"
                checked={draft.allowSquashMerge ?? false}
                disabled={draft.allowSquashMerge === undefined}
                unavailable={draft.allowSquashMerge === undefined}
                onChange={(value) => setMergeMethod("allowSquashMerge", value)}
              />
              <SettingCheck
                id="repo-rebase"
                label="Rebase merging"
                checked={draft.allowRebaseMerge ?? false}
                disabled={draft.allowRebaseMerge === undefined}
                unavailable={draft.allowRebaseMerge === undefined}
                onChange={(value) => setMergeMethod("allowRebaseMerge", value)}
              />
              <SettingCheck
                id="repo-merge-commit"
                label="Merge commits"
                checked={draft.allowMergeCommit ?? false}
                disabled={draft.allowMergeCommit === undefined}
                unavailable={draft.allowMergeCommit === undefined}
                onChange={(value) => setMergeMethod("allowMergeCommit", value)}
              />
              {mergeError && (
                <p role="alert" className="text-sm text-destructive">
                  {mergeError}
                </p>
              )}
              <div className="border-t pt-3">
                <SettingCheck
                  id="repo-delete-branch"
                  label="Automatically delete head branches"
                  checked={draft.deleteBranchOnMerge ?? false}
                  disabled={draft.deleteBranchOnMerge === undefined}
                  unavailable={draft.deleteBranchOnMerge === undefined}
                  onChange={(value) => setField("deleteBranchOnMerge", value)}
                />
              </div>
            </section>
          </fieldset>
        )}

        {draft && (settings?.canAdmin || uncertainFields) && (
          <div className="flex items-center justify-end gap-2 border-t pt-4">
            {uncertainFields ? (
              <Button variant="outline" disabled={saving} onClick={() => void retryConfirmation()}>
                {saving ? "Refreshing…" : "Retry confirmation"}
              </Button>
            ) : (
              <Button variant="outline" disabled={saving || !changed} onClick={cancel}>
                Cancel
              </Button>
            )}
            <Button
              disabled={saving || !changed || Boolean(mergeError) || Boolean(uncertainFields)}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : uncertainFields ? "Accepted · refresh needed" : "Save changes"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const SETTING_LABELS: Record<RepositorySettingsField, string> = {
  description: "Description",
  homepage: "Homepage URL",
  hasIssues: "Issues",
  hasWiki: "Wiki",
  allowSquashMerge: "Squash merging",
  allowRebaseMerge: "Rebase merging",
  allowMergeCommit: "Merge commits",
  deleteBranchOnMerge: "Automatically delete head branches",
}

function toDraft(settings: RepositorySettingsData): RepositorySettingsDraft {
  const { canAdmin: _canAdmin, ...draft } = settings
  return draft
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SettingCheck({
  id,
  label,
  checked,
  disabled,
  unavailable,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  unavailable?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <Label htmlFor={id} className="flex items-center gap-2 text-sm font-normal">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
      {unavailable && <span className="text-xs text-muted-foreground">Unavailable</span>}
    </Label>
  )
}
