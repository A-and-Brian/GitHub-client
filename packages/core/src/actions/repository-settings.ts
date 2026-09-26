import type { RestClient } from "../github/rest"

export interface RepositorySettings {
  description: string | null | undefined
  homepage: string | null | undefined
  hasIssues: boolean | undefined
  hasWiki: boolean | undefined
  allowSquashMerge: boolean | undefined
  allowRebaseMerge: boolean | undefined
  allowMergeCommit: boolean | undefined
  deleteBranchOnMerge: boolean | undefined
  canAdmin: boolean
}

export type RepositorySettingsDraft = Omit<RepositorySettings, "canAdmin">
export type RepositorySettingsPatch = Partial<RepositorySettingsDraft>
export type RepositorySettingsField = keyof RepositorySettingsDraft

interface GitHubRepositorySettings {
  description?: string | null
  homepage?: string | null
  has_issues?: boolean
  has_wiki?: boolean
  allow_squash_merge?: boolean
  allow_rebase_merge?: boolean
  allow_merge_commit?: boolean
  delete_branch_on_merge?: boolean
  permissions?: { admin?: boolean }
}

const fields = {
  description: "description",
  homepage: "homepage",
  hasIssues: "has_issues",
  hasWiki: "has_wiki",
  allowSquashMerge: "allow_squash_merge",
  allowRebaseMerge: "allow_rebase_merge",
  allowMergeCommit: "allow_merge_commit",
  deleteBranchOnMerge: "delete_branch_on_merge",
} as const satisfies Record<RepositorySettingsField, string>

const mergeFields = ["allowSquashMerge", "allowRebaseMerge", "allowMergeCommit"] as const
const fieldLabels: Record<RepositorySettingsField, string> = {
  description: "Description",
  homepage: "Homepage URL",
  hasIssues: "Issues",
  hasWiki: "Wiki",
  allowSquashMerge: "Squash merging",
  allowRebaseMerge: "Rebase merging",
  allowMergeCommit: "Merge commits",
  deleteBranchOnMerge: "Automatically delete head branches",
}

export class RepositorySettingsPermissionError extends Error {
  readonly latest: RepositorySettings

  constructor(latest: RepositorySettings) {
    super("Admin permission is required to edit repository settings")
    this.name = "RepositorySettingsPermissionError"
    this.latest = latest
  }
}

export class RepositorySettingsConflictError extends Error {
  readonly fields: RepositorySettingsField[]
  readonly latest: RepositorySettings

  constructor(fields: RepositorySettingsField[], latest: RepositorySettings) {
    super(
      `These settings changed on GitHub while you were editing: ${fields.map((field) => fieldLabels[field]).join(", ")}`,
    )
    this.name = "RepositorySettingsConflictError"
    this.fields = fields
    this.latest = latest
  }
}

export class RepositorySettingsReadbackError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super(
      `GitHub accepted the changes, but the updated settings could not be confirmed: ${errorMessage(cause)}`,
    )
    this.name = "RepositorySettingsReadbackError"
    this.cause = cause
  }
}

export async function getRepositorySettings(
  rest: RestClient,
  owner: string,
  repo: string,
): Promise<RepositorySettings> {
  const result = await rest.get<GitHubRepositorySettings>(repositoryPath(owner, repo))
  return {
    description: result.description,
    homepage: result.homepage,
    hasIssues: result.has_issues,
    hasWiki: result.has_wiki,
    allowSquashMerge: result.allow_squash_merge,
    allowRebaseMerge: result.allow_rebase_merge,
    allowMergeCommit: result.allow_merge_commit,
    deleteBranchOnMerge: result.delete_branch_on_merge,
    canAdmin: result.permissions?.admin === true,
  }
}

export function changedRepositorySettings(
  current: RepositorySettings,
  draft: RepositorySettingsDraft,
): RepositorySettingsPatch {
  const patch: RepositorySettingsPatch = {}
  for (const key of Object.keys(fields) as RepositorySettingsField[]) {
    // Missing fields are not supported by this response and must never be sent.
    if (current[key] !== undefined && draft[key] !== undefined && current[key] !== draft[key]) {
      patch[key] = draft[key] as never
    }
  }
  return patch
}

/** Applies only the user's intentional edits over a newer server snapshot. */
export function rebaseRepositorySettingsDraft(
  latest: RepositorySettings,
  draft: RepositorySettingsDraft,
  preserveFields: RepositorySettingsField[],
): RepositorySettingsDraft {
  const { canAdmin: _canAdmin, ...rebased } = latest
  for (const key of preserveFields) rebased[key] = draft[key] as never
  return rebased
}

/** Checks for concurrent edits, sends only changed supported fields, then reads GitHub back. */
export async function updateRepositorySettings(
  rest: RestClient,
  owner: string,
  repo: string,
  baseline: RepositorySettings,
  draft: RepositorySettingsDraft,
): Promise<RepositorySettings> {
  const changed = changedRepositorySettings(baseline, draft)
  const changedFields = Object.keys(changed) as RepositorySettingsField[]
  if (changedFields.length === 0) return baseline

  const path = repositoryPath(owner, repo)
  const latest = await getRepositorySettings(rest, owner, repo)
  if (!latest.canAdmin) throw new RepositorySettingsPermissionError(latest)

  const conflicts = changedFields.filter((key) => latest[key] !== baseline[key])
  if (conflicts.length > 0) throw new RepositorySettingsConflictError(conflicts, latest)

  const nextMergeMethods = mergeFields.map((key) =>
    changedFields.includes(key) ? draft[key] : latest[key],
  )
  if (
    mergeFields.some((key) => changedFields.includes(key)) &&
    !nextMergeMethods.some((enabled) => enabled === true)
  ) {
    throw new Error("At least one merge method must remain enabled")
  }

  const body: Record<string, string | boolean | null> = {}
  for (const key of changedFields) body[fields[key]] = changed[key] as string | boolean | null
  await rest.request("PATCH", path, body)
  try {
    return await getRepositorySettings(rest, owner, repo)
  } catch (cause) {
    throw new RepositorySettingsReadbackError(cause)
  }
}

const repositoryPath = (owner: string, repo: string) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
