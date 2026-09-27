import type { RestClient } from "@github-client/core/github/rest"
import { type ContentEntry, getContents } from "@github-client/core/repositories"
import { Button } from "@github-client/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@github-client/ui/components/dialog"
import { ChevronDownIcon, FileIcon, FolderIcon, RefreshCwIcon } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"

type DirectoryState = {
  entries?: ContentEntry[]
  loading?: boolean
  error?: unknown
}

export function RepositoryFileNavigator({
  rest,
  owner,
  repo,
  refName,
  path,
  onSelect,
  children,
}: {
  rest: RestClient
  owner: string
  repo: string
  refName: string
  path: string
  onSelect: (path: string) => void
  children: ReactNode
}) {
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const requests = useRef(new Map<string, number>())
  const inFlight = useRef(new Map<string, Promise<void>>())
  const requestId = useRef(0)
  const loadedDirectories = useRef(new Set<string>())

  const loadDirectory = useCallback(
    (directory: string, retry = false): Promise<void> => {
      if (!retry && loadedDirectories.current.has(directory)) return Promise.resolve()
      if (!retry && inFlight.current.has(directory)) return inFlight.current.get(directory)!
      const id = ++requestId.current
      requests.current.set(directory, id)
      setDirectories((current) => ({
        ...current,
        [directory]: { ...current[directory], loading: true, error: undefined },
      }))
      const request = (async () => {
        try {
          const result = await getContents(rest, owner, repo, directory, refName)
          if (requests.current.get(directory) !== id) return
          loadedDirectories.current.add(directory)
          setDirectories((current) => ({
            ...current,
            [directory]:
              result.kind === "directory" ? { entries: result.entries } : { entries: [] },
          }))
        } catch (error) {
          if (requests.current.get(directory) === id)
            setDirectories((current) => ({ ...current, [directory]: { error } }))
        } finally {
          if (requests.current.get(directory) === id) {
            requests.current.delete(directory)
            inFlight.current.delete(directory)
          }
        }
      })()
      inFlight.current.set(directory, request)
      return request
    },
    [rest, owner, repo, refName],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 800))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setDirectories({})
    setExpanded(new Set([""]))
    requests.current.clear()
    inFlight.current.clear()
    loadedDirectories.current.clear()
    void loadDirectory("")
    return () => {
      requests.current.clear()
      inFlight.current.clear()
    }
  }, [loadDirectory])

  // Reopen the URL's ancestors so deep links reveal the selected file in the tree.
  useEffect(() => {
    if (!path) return
    let cancelled = false
    const parts = path.split("/").filter(Boolean)
    const parents = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))
    setExpanded((current) => new Set([...current, ...parents]))
    void (async () => {
      for (const parent of ["", ...parents]) {
        if (cancelled) return
        await loadDirectory(parent)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, loadDirectory])

  const toggleDirectory = (entry: ContentEntry) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
    if (!expanded.has(entry.path)) void loadDirectory(entry.path)
  }

  const tree = (directory: string, ancestors: Set<string>): ReactNode => {
    const state = directories[directory]
    if (ancestors.has(directory)) return null
    const nextAncestors = new Set(ancestors).add(directory)
    if (!state?.entries && !state?.error)
      return (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          Loading…
        </p>
      )
    if (state?.error)
      return (
        <div role="alert" className="p-3 text-xs">
          <p>Could not load this directory.</p>
          <Button variant="ghost" size="sm" onClick={() => void loadDirectory(directory, true)}>
            <RefreshCwIcon /> Retry
          </Button>
        </div>
      )
    return state?.entries?.map((entry) => (
      <div key={entry.path}>
        <div className={`flex items-center gap-1 ${path === entry.path ? "bg-muted" : ""}`}>
          {entry.type === "dir" ? (
            <button
              type="button"
              aria-label={`${expanded.has(entry.path) ? "Collapse" : "Expand"} ${entry.name}`}
              aria-expanded={expanded.has(entry.path)}
              onClick={() => toggleDirectory(entry)}
              className="rounded p-1 hover:bg-muted"
            >
              <ChevronDownIcon
                className={`size-3 transition-transform ${expanded.has(entry.path) ? "" : "-rotate-90"}`}
              />
            </button>
          ) : (
            <span className="w-5" />
          )}
          <button
            type="button"
            title={entry.name}
            onClick={() => {
              if (entry.type === "dir") {
                if (!expanded.has(entry.path)) toggleDirectory(entry)
              }
              onSelect(entry.path)
              if (narrow) setDrawerOpen(false)
            }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1.5 text-left text-xs hover:bg-muted"
          >
            {entry.type === "dir" ? (
              <FolderIcon className="size-3.5 shrink-0" />
            ) : (
              <FileIcon className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{entry.name}</span>
          </button>
        </div>
        {entry.type === "dir" && expanded.has(entry.path) && (
          <div className="ml-3 border-l pl-1">{tree(entry.path, nextAncestors)}</div>
        )}
      </div>
    ))
  }

  const navigation = (
    <nav aria-label="Repository files" className="min-h-0 flex-1 overflow-auto">
      <button
        type="button"
        onClick={() => {
          onSelect("")
          if (narrow) setDrawerOpen(false)
        }}
        className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm font-medium hover:bg-muted ${path === "" ? "bg-muted" : ""}`}
      >
        <FolderIcon className="size-4" /> {repo}
      </button>
      <div className="mt-1">{tree("", new Set())}</div>
    </nav>
  )

  return (
    <div ref={containerRef} className="min-w-0 @container/repository-code">
      {narrow ? (
        <>
          <Button variant="outline" size="sm" className="mb-3" onClick={() => setDrawerOpen(true)}>
            <FolderIcon /> Files
          </Button>
          <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Repository files</DialogTitle>
              </DialogHeader>
              {navigation}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <div className="grid min-h-0 grid-cols-[minmax(12rem,28%)_minmax(0,1fr)] gap-5">
          <aside className="flex min-h-0 max-h-[70vh] max-w-80 flex-col overflow-hidden rounded-lg border p-2">
            {navigation}
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      )}
      {narrow && children}
    </div>
  )
}
