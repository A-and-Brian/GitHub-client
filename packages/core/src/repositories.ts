import type { RestClient } from "./github/rest"

export interface RepositorySummary {
  id: number
  fullName: string
  name: string
  owner: string
  description: string | null
  private: boolean
  archived: boolean
  defaultBranch: string
  htmlUrl: string
  canAdmin: boolean
}

export type RepositoryScope =
  | { kind: "org"; org: string }
  | { kind: "team"; org: string; slug: string }

export interface Page<T> {
  items: T[]
  hasMore: boolean
}

export interface ContentEntry {
  name: string
  path: string
  type: "file" | "dir" | "symlink" | "submodule"
  size: number
  htmlUrl: string | null
}

export type RepositoryContents =
  | { kind: "directory"; entries: ContentEntry[]; limited: boolean }
  | { kind: "file"; entry: ContentEntry; text: string | null; reason?: string }

interface GitHubRepository {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  description: string | null
  private: boolean
  archived: boolean
  default_branch: string
  html_url: string
  permissions?: { admin?: boolean }
}

interface GitHubContent {
  name: string
  path: string
  type?: string
  size?: number
  html_url?: string
  download_url?: string | null
  content?: string
  encoding?: string
  submodule_git_url?: string
}

const PAGE_SIZE = 100
const MAX_TEXT_SIZE = 1024 * 1024

export async function listRepositories(
  rest: RestClient,
  scope: RepositoryScope,
  page = 1,
): Promise<Page<RepositorySummary>> {
  const path =
    scope.kind === "org"
      ? `/orgs/${segment(scope.org)}/repos`
      : `/orgs/${segment(scope.org)}/teams/${segment(scope.slug)}/repos`
  const repositories = await rest.get<GitHubRepository[]>(path, {
    page,
    per_page: PAGE_SIZE,
    ...(scope.kind === "org" ? { type: "all" } : {}),
  })
  return { items: repositories.map(mapRepository), hasMore: repositories.length === PAGE_SIZE }
}

export async function getRepository(
  rest: RestClient,
  owner: string,
  repo: string,
): Promise<RepositorySummary> {
  return mapRepository(await rest.get<GitHubRepository>(repositoryPath(owner, repo)))
}

export async function listBranches(
  rest: RestClient,
  owner: string,
  repo: string,
  page = 1,
): Promise<Page<{ name: string }>> {
  const branches = await rest.get<Array<{ name: string }>>(
    `${repositoryPath(owner, repo)}/branches`,
    { page, per_page: PAGE_SIZE },
  )
  return { items: branches.map(({ name }) => ({ name })), hasMore: branches.length === PAGE_SIZE }
}

export async function getContents(
  rest: RestClient,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<RepositoryContents> {
  const contentPath = `${repositoryPath(owner, repo)}/contents${path ? `/${path.split("/").map(segment).join("/")}` : ""}`
  const result = await rest.get<GitHubContent | GitHubContent[]>(contentPath, { ref })
  if (Array.isArray(result)) {
    const entries = result.map(mapContentEntry)
    return { kind: "directory", entries, limited: entries.length >= 1000 }
  }

  const entry = mapContentEntry(result)
  if (entry.type !== "file") {
    return {
      kind: "file",
      entry,
      text: null,
      reason: entry.type === "submodule" ? "submodule" : entry.type,
    }
  }
  if (entry.size > MAX_TEXT_SIZE) return { kind: "file", entry, text: null, reason: "too-large" }
  if (result.encoding !== "base64" || typeof result.content !== "string") {
    return { kind: "file", entry, text: null, reason: "unsupported" }
  }
  const encodedContent = result.content.replace(/\s/g, "")
  if (encodedContent.length > Math.ceil(MAX_TEXT_SIZE / 3) * 4 + 8) {
    return { kind: "file", entry, text: null, reason: "too-large" }
  }

  const text = decodeText(encodedContent)
  return text === null
    ? { kind: "file", entry, text: null, reason: "binary" }
    : { kind: "file", entry, text }
}

export async function getReadme(
  rest: RestClient,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ html: string; path: string } | null> {
  const path = `${repositoryPath(owner, repo)}/readme`
  let metadata: GitHubContent
  try {
    metadata = await rest.get<GitHubContent>(path, { ref })
  } catch (error) {
    // A missing README is a normal repository state; preserve all other GitHub errors.
    if (typeof error === "object" && error !== null && "status" in error && error.status === 404)
      return null
    throw error
  }
  if (typeof metadata.size === "number" && metadata.size > MAX_TEXT_SIZE) return null

  const html = await rest.getText(`${path}?ref=${encodeURIComponent(ref)}`, {
    Accept: "application/vnd.github.html+json",
  })
  return { html, path: metadata.path }
}

function repositoryPath(owner: string, repo: string): string {
  return `/repos/${segment(owner)}/${segment(repo)}`
}

function segment(value: string): string {
  return encodeURIComponent(value)
}

function mapRepository(repository: GitHubRepository): RepositorySummary {
  return {
    id: repository.id,
    fullName: repository.full_name,
    name: repository.name,
    owner: repository.owner.login,
    description: repository.description,
    private: repository.private,
    archived: repository.archived,
    defaultBranch: repository.default_branch,
    htmlUrl: repository.html_url,
    canAdmin: repository.permissions?.admin === true,
  }
}

function mapContentEntry(content: GitHubContent): ContentEntry {
  const type = content.submodule_git_url
    ? "submodule"
    : content.type === "dir"
      ? "dir"
      : content.type === "symlink"
        ? "symlink"
        : "file"
  return {
    name: content.name,
    path: content.path,
    type,
    size: content.size ?? 0,
    htmlUrl: content.html_url ?? null,
  }
}

function decodeText(base64: string): string | null {
  try {
    const binary = atob(base64.replace(/\s/g, ""))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    if (bytes.includes(0)) return null
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
