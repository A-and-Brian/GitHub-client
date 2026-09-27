import { GitHubError } from "@github-client/core"
import type { ContentEntry, getContents } from "@github-client/core/repositories"
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
import { useMemo } from "react"
import { useSession } from "@/app/client"
import { useRepositoryPages, useRepositoryResource } from "@/app/repository-cache"
import { RepositoryCacheStatus } from "@/components/repository-cache-status"
import { RepositoryContext } from "@/components/repository-context"
import { RepositoryReadme } from "@/components/repository-readme"
import { openExternal } from "@/platform"

type Tab = "code" | "pulls"

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
  const { client, viewer } = useSession()
  const navigate = useNavigate()
  const repoName = `${owner}/${repo}`
  const identity = { host: client.rest.url("/"), accountLogin: viewer.login, owner, repo }
  const summaryResource = useRepositoryResource({ ...identity, kind: "summary" })
  const summary = summaryResource.state.data
  const summaryError = summaryResource.state.loaded ? undefined : summaryResource.state.error
  const summaryLoading = !summaryResource.state.loaded && !summaryResource.state.error
  const branchesResource = useRepositoryPages(
    { ...identity, kind: "branches", page: 1, pageSize: 100 },
    tab === "code" && !summaryError,
  )
  const branches = branchesResource.state.data?.items.map((branch) => branch.name) ?? []
  const moreBranches = branchesResource.state.data?.hasMore ?? false
  const branchLoading = branchesResource.state.refreshing
  const branchError = branchesResource.state.error
  const currentRef = refName ?? summary?.defaultBranch ?? branches[0] ?? ""
  const contentsResource = useRepositoryResource(
    { ...identity, kind: "contents", ref: currentRef, path },
    tab === "code" && Boolean(currentRef) && !summaryError,
  )
  const contents = contentsResource.state.data
  const contentsError = contentsResource.state.loaded ? undefined : contentsResource.state.error
  const contentsLoading = !contentsResource.state.loaded && !contentsError
  const readmeResource = useRepositoryResource(
    { ...identity, kind: "readme", ref: currentRef },
    tab === "code" && !path && Boolean(currentRef) && !summaryError,
  )
  const readme = readmeResource.state.data
  const readmeError = readmeResource.state.loaded ? undefined : readmeResource.state.error
  const readmeLoading = !readmeResource.state.loaded && !readmeError
  const pullsResource = useRepositoryPages(
    { ...identity, kind: "pulls", page: 1, pageSize: 30, query: "state=open" },
    tab === "pulls" && !summaryError,
  )
  const pulls = pullsResource.state.data?.items ?? []
  const morePulls = pullsResource.state.data?.hasMore ?? false
  const pullLoading = !pullsResource.state.loaded && !pullsResource.state.error
  const pullError = pullsResource.state.error
  const retry = (resource: "summary" | "contents" | "readme" | "branches" | "pulls") => {
    if (resource === "branches") void branchesResource.retry()
    else if (resource === "pulls") void pullsResource.retry()
    else {
      const resources = {
        summary: summaryResource,
        contents: contentsResource,
        readme: readmeResource,
      }
      void resources[resource].refresh()
    }
  }
  const activeResources = [
    summaryResource,
    ...(tab === "pulls"
      ? [pullsResource]
      : [
          branchesResource,
          ...(currentRef ? [contentsResource, ...(!path ? [readmeResource] : [])] : []),
        ]),
  ]
  const refresh = () => {
    for (const resource of activeResources) void resource.refresh()
  }
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
      <div className="flex items-center justify-between gap-3 border-b px-6 py-2">
        <RepositoryCacheStatus states={activeResources.map((resource) => resource.state)} />
        {activeResources.some((resource) => resource.state.loaded && resource.state.error) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              for (const resource of activeResources)
                if (resource.state.error) void resource.retry()
            }}
          >
            Retry
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Refresh repository"
          disabled={activeResources.some((resource) => resource.state.refreshing)}
          onClick={refresh}
        >
          <RefreshCwIcon
            className={
              activeResources.some((resource) => resource.state.refreshing)
                ? "animate-spin"
                : undefined
            }
          />{" "}
          Refresh
        </Button>
      </div>
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
            {Boolean(pullError) && !pullsResource.state.loaded && (
              <StateMessage
                error={pullError}
                saved={pullsResource.state.loaded}
                title="Could not load pull requests"
                retry={() => retry("pulls")}
              />
            )}
            {pullsResource.state.loaded && pulls.length === 0 && (
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
            {morePulls && !pullLoading && (
              <Button
                variant="outline"
                className="mt-4"
                disabled={pullsResource.state.refreshing}
                onClick={() => void pullsResource.loadMore()}
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
                    onClick={() => void branchesResource.loadMore()}
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
            ) : contentsLoading ? (
              <p role="status" className="rounded-lg border p-6 text-sm text-muted-foreground">
                Loading repository contents…
              </p>
            ) : contentsError instanceof GitHubError && contentsError.status === 409 ? (
              <EmptyRepository error={contentsError} />
            ) : contentsError ? (
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
                ) : readmeError ? (
                  <StateMessage
                    error={readmeError}
                    title="Could not load README"
                    retry={() => retry("readme")}
                  />
                ) : readmeLoading ? (
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
  saved = false,
  error,
  title,
  retry,
}: {
  loading?: boolean
  saved?: boolean
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
        {!saved && !(error instanceof GitHubError)
          ? "Not saved for offline use. Could not load this page. Check your connection and try again."
          : error instanceof Error
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
