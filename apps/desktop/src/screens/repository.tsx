import { GitHubError } from "@github-client/core"
import {
  type ContentEntry,
  getContents,
  getReadme,
  getRepository,
  listBranches,
  type RepositorySummary,
} from "@github-client/core/repositories"
import { Button } from "@github-client/ui/components/button"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileIcon,
  FolderIcon,
  GitBranchIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "@/app/client"
import { RepositoryContext } from "@/components/repository-context"
import { RepositoryReadme } from "@/components/repository-readme"
import { openExternal } from "@/platform"

type Tab = "code" | "pulls"
type Pull = {
  number: number
  title: string
  state: "open" | "closed"
  draft: boolean
  user?: { login?: string }
  html_url: string
  updated_at: string
}

export function RepositoryBrowser({
  owner,
  repo,
  refName,
  path,
  tab,
}: {
  owner: string
  repo: string
  refName?: string
  path: string
  tab: Tab
}) {
  const { client } = useSession()
  const navigate = useNavigate()
  const repoName = `${owner}/${repo}`
  const [summary, setSummary] = useState<RepositorySummary | null>(null)
  const [summaryError, setSummaryError] = useState<unknown>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [branches, setBranches] = useState<string[]>([])
  const [branchPage, setBranchPage] = useState(1)
  const [moreBranches, setMoreBranches] = useState(false)
  const [branchLoading, setBranchLoading] = useState(false)
  const [branchError, setBranchError] = useState<unknown>(null)
  const [contents, setContents] = useState<Awaited<ReturnType<typeof getContents>> | null>(null)
  const [contentsError, setContentsError] = useState<unknown>(null)
  const [contentsLoading, setContentsLoading] = useState(true)
  const [readme, setReadme] = useState<Awaited<ReturnType<typeof getReadme>>>(null)
  const [readmeError, setReadmeError] = useState<unknown>(null)
  const [readmeLoading, setReadmeLoading] = useState(true)
  const [pulls, setPulls] = useState<Pull[]>([])
  const [pullPage, setPullPage] = useState(1)
  const [morePulls, setMorePulls] = useState(false)
  const [pullError, setPullError] = useState<unknown>(null)
  const [contentsErrorKey, setContentsErrorKey] = useState("")
  const [pullLoading, setPullLoading] = useState(false)
  const [retryCount, setRetryCount] = useState({
    summary: 0,
    contents: 0,
    readme: 0,
    branches: 0,
    pulls: 0,
  })
  const [loadedContentsKey, setLoadedContentsKey] = useState("")
  const [loadedReadmeKey, setLoadedReadmeKey] = useState("")
  const [readmeErrorKey, setReadmeErrorKey] = useState("")
  const currentRef = refName ?? summary?.defaultBranch ?? branches[0] ?? ""
  const contentsKey = `${owner}/${repo}@${currentRef}:${path}`
  const readmeKey = `${owner}/${repo}@${currentRef}:README`
  const versions = useRef({ summary: 0, contents: 0, readme: 0, branches: 0, pulls: 0 })

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry counter changes intentionally refetch this resource.
  useEffect(() => {
    const version = ++versions.current.summary
    setSummary(null)
    setSummaryError(null)
    setSummaryLoading(true)
    setBranches([])
    setBranchPage(1)
    setMoreBranches(false)
    void getRepository(client.rest, owner, repo)
      .then((value) => {
        if (versions.current.summary === version) setSummary(value)
      })
      .catch((error: unknown) => {
        if (versions.current.summary === version) setSummaryError(error)
      })
      .finally(() => {
        if (versions.current.summary === version) setSummaryLoading(false)
      })
    return () => {
      versions.current.summary++
    }
  }, [client, owner, repo, retryCount.summary])

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry counter changes intentionally refetch this resource.
  useEffect(() => {
    if (tab !== "code") {
      setContentsLoading(false)
      return
    }
    if (!currentRef) {
      setContentsLoading(false)
      return
    }
    const version = ++versions.current.contents
    setContents(null)
    setContentsError(null)
    setContentsErrorKey("")
    setLoadedContentsKey("")
    setContentsLoading(true)
    void getContents(client.rest, owner, repo, path, currentRef)
      .then((value) => {
        if (versions.current.contents === version) {
          setContents(value)
          setLoadedContentsKey(contentsKey)
        }
      })
      .catch((error: unknown) => {
        if (versions.current.contents === version) {
          setContentsError(error)
          setContentsErrorKey(contentsKey)
        }
      })
      .finally(() => {
        if (versions.current.contents === version) setContentsLoading(false)
      })
    return () => {
      versions.current.contents++
    }
  }, [client, owner, repo, path, currentRef, tab, retryCount.contents, contentsKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry counter changes intentionally refetch this resource.
  useEffect(() => {
    if (tab !== "code") {
      setReadmeLoading(false)
      return
    }
    if (!currentRef) {
      setReadmeLoading(false)
      return
    }
    const version = ++versions.current.readme
    setReadme(null)
    setReadmeError(null)
    setLoadedReadmeKey("")
    setReadmeErrorKey("")
    setReadmeLoading(true)
    void getReadme(client.rest, owner, repo, currentRef)
      .then((value) => {
        if (versions.current.readme === version) {
          setReadme(value)
          setLoadedReadmeKey(readmeKey)
        }
      })
      .catch((error: unknown) => {
        if (versions.current.readme === version) {
          setReadmeError(error)
          setReadmeErrorKey(readmeKey)
        }
      })
      .finally(() => {
        if (versions.current.readme === version) setReadmeLoading(false)
      })
    return () => {
      versions.current.readme++
    }
  }, [client, owner, repo, currentRef, tab, retryCount.readme, readmeKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry counter changes intentionally refetch this resource.
  useEffect(() => {
    const version = ++versions.current.branches
    setBranchError(null)
    setBranchLoading(true)
    void listBranches(client.rest, owner, repo, branchPage)
      .then(({ items, hasMore }) => {
        if (versions.current.branches !== version) return
        setBranches((current) =>
          branchPage === 1
            ? items.map((branch) => branch.name)
            : [...new Set([...current, ...items.map((branch) => branch.name)])],
        )
        setMoreBranches(hasMore)
      })
      .catch((error: unknown) => {
        if (versions.current.branches === version) {
          setBranchError(error)
          setMoreBranches(false)
        }
      })
      .finally(() => {
        if (versions.current.branches === version) setBranchLoading(false)
      })
    return () => {
      versions.current.branches++
    }
  }, [client, owner, repo, branchPage, retryCount.branches])

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry counter changes intentionally refetch this resource.
  useEffect(() => {
    if (tab !== "pulls") return
    const version = ++versions.current.pulls
    setPullLoading(true)
    setPullError(null)
    void client.rest
      .get<Pull[]>(`/repos/${owner}/${repo}/pulls`, { state: "open", per_page: 30, page: pullPage })
      .then((items) => {
        if (versions.current.pulls !== version) return
        setPulls((current) =>
          pullPage === 1
            ? items
            : [...new Map([...current, ...items].map((pull) => [pull.number, pull])).values()],
        )
        setMorePulls(items.length === 30)
      })
      .catch((error: unknown) => {
        if (versions.current.pulls === version) {
          if (
            pullPage === 1 ||
            (error instanceof GitHubError && [401, 403, 404].includes(error.status))
          ) {
            setPulls([])
            setMorePulls(false)
          }
          setPullError(error)
        }
      })
      .finally(() => {
        if (versions.current.pulls === version) setPullLoading(false)
      })
    return () => {
      versions.current.pulls++
    }
  }, [client, owner, repo, tab, pullPage, retryCount.pulls])

  const retry = (key: keyof typeof retryCount) =>
    setRetryCount((current) => ({ ...current, [key]: current[key] + 1 }))

  const updateLocation = (next: { ref?: string; path?: string; tab?: Tab }) => {
    void navigate({
      to: "/repo/$owner/$repo",
      params: { owner, repo },
      search: {
        ref: next.ref ?? (refName === summary?.defaultBranch ? undefined : refName),
        path: (next.path ?? path) || undefined,
        tab: next.tab ?? tab,
      },
    })
  }
  const crumbs = useMemo(() => path.split("/").filter(Boolean), [path])
  const openEntry = (entry: ContentEntry) => {
    if (entry.type === "dir") updateLocation({ path: entry.path })
    else if (entry.type === "file") updateLocation({ path: entry.path })
    else if (entry.htmlUrl) void openExternal(entry.htmlUrl)
  }
  const hasDefaultRef = Boolean(summary?.defaultBranch)
  const file = contents?.kind === "file" ? contents : null
  const directory = contents?.kind === "directory" ? contents : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RepositoryContext
        owner={owner}
        repo={repo}
        location={path || undefined}
        showSettings={summary?.canAdmin === true}
      />
      <header className="shrink-0 border-b px-6 py-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Link to="/" className="hover:text-foreground">
                Organizations
              </Link>
              <span>/</span>
              <span className="truncate">{repoName}</span>
            </div>
            <h1 className="mt-2 truncate text-2xl font-semibold">{repoName}</h1>
            {summary?.description && (
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{summary.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{summary?.private ? "Private" : "Public"}</span>
              {summary?.archived && <span>· Archived</span>}
              <a
                href={summary?.htmlUrl}
                onClick={(event) => {
                  event.preventDefault()
                  if (summary?.htmlUrl) void openExternal(summary.htmlUrl)
                }}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                Open on GitHub <ExternalLinkIcon className="size-3" />
              </a>
              <a
                href={`https://github.com/${owner}/${repo}/issues`}
                onClick={(event) => {
                  event.preventDefault()
                  void openExternal(`https://github.com/${owner}/${repo}/issues`)
                }}
                className="hover:text-foreground"
              >
                Issues
              </a>
            </div>
          </div>
          <div className="flex shrink-0 gap-1 rounded-lg border p-1 text-sm">
            <button
              type="button"
              onClick={() => updateLocation({ tab: "code", path: "" })}
              className={`rounded-md px-3 py-1.5 ${tab === "code" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              Code
            </button>
            <button
              type="button"
              onClick={() => updateLocation({ tab: "pulls", path: "" })}
              className={`rounded-md px-3 py-1.5 ${tab === "pulls" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              Pull requests
            </button>
          </div>
        </div>
      </header>
      {summaryLoading || summaryError ? (
        <StateMessage
          loading={summaryLoading}
          error={summaryError}
          title={`Could not load ${repoName}`}
          retry={() => retry("summary")}
        />
      ) : tab === "pulls" ? (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-lg font-semibold">Open pull requests</h2>
            {Boolean(pullError) && (
              <StateMessage
                error={pullError}
                title="Could not load pull requests"
                retry={() => retry("pulls")}
              />
            )}
            {!pullError && pulls.length === 0 && !pullLoading && (
              <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                No open pull requests.
              </p>
            )}
            <div className="divide-y rounded-lg border">
              {pulls.map((pull) => (
                <Link
                  key={pull.number}
                  to="/pr/$owner/$repo/$number"
                  params={{ owner, repo, number: String(pull.number) }}
                  search={{ tab: "conversation" }}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    #{pull.number} {pull.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {pull.user?.login ?? "Unknown"}
                    {pull.draft ? " · Draft" : ""}
                  </span>
                </Link>
              ))}
            </div>
            {pullLoading && (
              <p role="status" className="p-4 text-center text-sm text-muted-foreground">
                Loading pull requests…
              </p>
            )}
            {morePulls && !pullLoading && !pullError && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setPullPage((page) => page + 1)}
              >
                Load more
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <div className="mx-auto max-w-6xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
                <select
                  aria-label="Branch"
                  value={currentRef}
                  onChange={(event) => updateLocation({ ref: event.target.value, path: "" })}
                  className="max-w-72 rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {currentRef && !branches.includes(currentRef) && (
                    <option value={currentRef}>{currentRef}</option>
                  )}
                  {branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
                {moreBranches && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={branchLoading}
                    onClick={() => setBranchPage((page) => page + 1)}
                  >
                    {branchLoading ? "Loading…" : "More branches"}
                  </Button>
                )}
                {Boolean(branchError) && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => retry("branches")}
                  >
                    Retry branches
                  </button>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
                <button
                  type="button"
                  onClick={() => updateLocation({ path: "" })}
                  className="shrink-0 hover:text-primary"
                >
                  {repo}
                </button>
                {crumbs.map((crumb, index) => (
                  <span
                    key={crumbs.slice(0, index + 1).join("/")}
                    className="flex min-w-0 items-center gap-1"
                  >
                    <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      className="max-w-48 truncate hover:text-primary"
                      onClick={() => updateLocation({ path: crumbs.slice(0, index + 1).join("/") })}
                    >
                      {crumb}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            {!hasDefaultRef && (
              <p className="text-xs text-muted-foreground">
                This repository has no default branch. Choose a branch to browse files.
              </p>
            )}
            {!currentRef ? (
              <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                No branch is available to browse yet.
              </p>
            ) : (loadedContentsKey !== contentsKey && contentsErrorKey !== contentsKey) ||
              contentsLoading ? (
              <p role="status" className="rounded-lg border p-6 text-sm text-muted-foreground">
                Loading repository contents…
              </p>
            ) : contentsErrorKey === contentsKey &&
              contentsError instanceof GitHubError &&
              contentsError.status === 409 ? (
              <EmptyRepository error={contentsError} />
            ) : contentsErrorKey === contentsKey && contentsError ? (
              <StateMessage
                error={contentsError}
                title="Could not load repository contents"
                retry={() => retry("contents")}
              />
            ) : directory ? (
              <section aria-label="Files" className="overflow-hidden rounded-lg border">
                <div className="divide-y">
                  {path && (
                    <button
                      type="button"
                      onClick={() =>
                        updateLocation({ path: path.split("/").slice(0, -1).join("/") })
                      }
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40"
                    >
                      <FolderIcon className="size-4 text-muted-foreground" />
                      ..
                    </button>
                  )}
                  {directory.entries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      disabled={entry.type !== "dir" && entry.type !== "file" && !entry.htmlUrl}
                      title={
                        entry.type !== "dir" && entry.type !== "file" && !entry.htmlUrl
                          ? "GitHub cannot preview this entry"
                          : undefined
                      }
                      onClick={() => openEntry(entry)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="text-muted-foreground">
                        {entry.type === "dir" ? (
                          <FolderIcon className="size-4" />
                        ) : (
                          <FileIcon className="size-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {entry.type !== "dir" && (
                        <span className="text-xs text-muted-foreground">
                          {entry.type === "file" ? formatSize(entry.size) : entry.type}
                        </span>
                      )}
                      <ChevronDownIcon className="size-3 -rotate-90 text-muted-foreground" />
                    </button>
                  ))}
                </div>
                {directory.limited && (
                  <a
                    href={repoTreeUrl(owner, repo, currentRef, path)}
                    onClick={(event) => {
                      event.preventDefault()
                      void openExternal(repoTreeUrl(owner, repo, currentRef, path))
                    }}
                    className="block border-t px-4 py-3 text-xs text-muted-foreground hover:text-foreground"
                  >
                    GitHub limited this directory listing. Open GitHub to see the rest.
                  </a>
                )}
              </section>
            ) : file ? (
              <FileContents
                file={file}
                onGitHub={() => file.entry.htmlUrl && void openExternal(file.entry.htmlUrl)}
              />
            ) : (
              <EmptyRepository error={contentsError} />
            )}
            {!path && (
              <section className="rounded-lg border p-5">
                <div className="mb-4 flex items-center gap-2 border-b pb-3">
                  <FileIcon className="size-4 text-muted-foreground" />
                  <h2 className="font-semibold">README</h2>
                </div>
                {!currentRef ? (
                  <p className="text-sm text-muted-foreground">
                    No README is available until this repository has a branch.
                  </p>
                ) : readmeErrorKey === readmeKey ? (
                  <StateMessage
                    error={readmeError}
                    title="Could not load README"
                    retry={() => retry("readme")}
                  />
                ) : loadedReadmeKey !== readmeKey || readmeLoading ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading README…
                  </p>
                ) : readme ? (
                  <RepositoryReadme
                    html={readme.html}
                    baseUrl={readmeBaseUrl(owner, repo, currentRef, readme.path, "blob")}
                    imageBaseUrl={readmeBaseUrl(owner, repo, currentRef, readme.path, "raw")}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No README found for this branch.</p>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StateMessage({
  loading,
  error,
  title,
  retry,
}: {
  loading?: boolean
  error?: unknown
  title?: string
  retry?: () => void
}) {
  if (loading)
    return (
      <p role="status" className="p-8 text-center text-sm text-muted-foreground">
        Loading…
      </p>
    )
  return (
    <div role="alert" className="m-6 rounded-lg border p-5 text-sm">
      <p className="font-medium">{title ?? "Could not load data"}</p>
      <p className="mt-1 text-muted-foreground">
        {error instanceof Error
          ? error.message
          : "Check your connection and permissions, then try again."}
      </p>
      {retry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={retry}>
          <RefreshCwIcon /> Retry
        </Button>
      )}
    </div>
  )
}

function EmptyRepository({ error }: { error: unknown }) {
  if (error instanceof GitHubError && error.status === 409)
    return (
      <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        This repository is empty and has no files yet.
      </p>
    )
  return (
    <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
      No file data is available at this path.
    </p>
  )
}

function FileContents({
  file,
  onGitHub,
}: {
  file: Extract<Awaited<ReturnType<typeof getContents>>, { kind: "file" }>
  onGitHub: () => void
}) {
  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="flex items-center justify-between border-b px-4 py-3 text-sm">
        <span className="truncate font-medium">{file.entry.name}</span>
        {file.entry.htmlUrl && (
          <button
            type="button"
            onClick={onGitHub}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Open on GitHub <ExternalLinkIcon className="size-3" />
          </button>
        )}
      </header>
      {file.text === null ? (
        <p className="p-6 text-sm text-muted-foreground">
          {file.reason === "too-large"
            ? "This file is too large to preview."
            : file.reason === "binary"
              ? "This is a binary file and cannot be previewed."
              : "This file format cannot be previewed."}{" "}
          Open it on GitHub to inspect it.
        </p>
      ) : (
        <pre className="max-h-[70vh] overflow-auto p-4 text-xs leading-5">
          <code>{file.text}</code>
        </pre>
      )}
    </section>
  )
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function encodeSegments(value: string) {
  return value.split("/").filter(Boolean).map(encodeURIComponent).join("/")
}

function readmeBaseUrl(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  mode: "blob" | "raw",
) {
  const host = mode === "raw" ? "https://raw.githubusercontent.com" : "https://github.com"
  const branch = encodeURIComponent(ref)
  const filePath = encodeSegments(path)
  return mode === "raw"
    ? `${host}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${branch}/${filePath}`
    : `${host}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${branch}/${filePath}`
}

function repoTreeUrl(owner: string, repo: string, ref: string, path: string) {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${encodeURIComponent(ref)}/${encodeSegments(path)}`
}
