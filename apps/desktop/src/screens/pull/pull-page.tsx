import { jobKeys, type PendingWorkflowApproval, prKey } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Tabs, TabsList, TabsTrigger } from "@github-client/ui/components/tabs"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowLeftIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useClient, useJobStatus, useWatch } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { useShortcuts } from "@/app/shortcuts"
import { CheckSummary, CheckSummaryHelp } from "@/components/check-summary"
import { RepositoryContext } from "@/components/repository-context"
import { PullStateIcon } from "@/components/status"
import { openExternal } from "@/platform"
import { RunDialog } from "../actions/run-dialog"
import { ChecksContent, ChecksTab, type WorkflowApprovalProps } from "./checks"
import { ConversationTab } from "./conversation"
import { FilesTab } from "./files"
import { ReviewButton } from "./review"

type ApprovalDiscovery = {
  scope: string
  candidates: PendingWorkflowApproval[]
  error?: unknown
}

export type PullTab = "conversation" | "files" | "checks"

/** Shared detail pane for the full PR page and the inbox. */
export function PullContent({
  owner,
  name,
  number,
  tab,
  onTabChange,
  onBack,
  actions,
  backLabel = "Back",
  hideRepositoryContext = false,
  active = true,
}: {
  owner: string
  name: string
  number: number
  tab: PullTab
  onTabChange: (tab: PullTab) => void
  onBack: () => void
  actions?: ReactNode
  backLabel?: string
  hideRepositoryContext?: boolean
  active?: boolean
}) {
  const navigate = useNavigate()
  const client = useClient()
  const repo = `${owner}/${name}`
  const key = prKey(repo, number)
  useWatch((c) => (active ? c.watchPull(repo, number) : () => {}), [repo, number, active])
  const status = useJobStatus(jobKeys.pull(repo, number))
  const error = status?.error
  useErrorToast(error, { id: `pull-error:${key}`, title: `Could not load ${repo} #${number}` })
  const detail = useLiveQuery(
    (q) =>
      q.from({ d: client.collections.pullDetails.collection }).where(({ d }) => eq(d.key, key)),
    [key],
  ).data[0]
  const [approvalDiscovery, setApprovalDiscovery] = useState<ApprovalDiscovery>()
  const [approvalRefresh, setApprovalRefresh] = useState(0)
  const approvalRequest = useRef(0)
  const approvingScopes = useRef(new Set<string>())
  const approvalScope = detail?.headOid ? `${repo}#${number}@${detail.headOid}` : undefined
  const currentApprovalScope = useRef(approvalScope)
  currentApprovalScope.current = approvalScope

  const discoverApprovals = useCallback(
    (headSha: string) => {
      const scope = `${repo}#${number}@${headSha}`
      const request = ++approvalRequest.current
      setApprovalDiscovery((previous) => ({
        scope,
        candidates: previous?.scope === scope ? previous.candidates : [],
      }))
      return client.fetchPendingPullRequestApprovals(repo, number, headSha).then(
        (candidates) => {
          if (request !== approvalRequest.current) return
          setApprovalDiscovery({ scope, candidates })
        },
        (error: unknown) => {
          if (request !== approvalRequest.current) return
          setApprovalDiscovery((previous) => ({
            scope,
            candidates: previous?.scope === scope ? previous.candidates : [],
            error,
          }))
        },
      )
    },
    [client, number, repo],
  )

  useEffect(() => {
    void approvalRefresh
    void status?.lastSuccess
    if (!active || !detail?.headOid) {
      approvalRequest.current++
      setApprovalDiscovery(undefined)
      return
    }
    void discoverApprovals(detail.headOid)
    return () => {
      approvalRequest.current++
    }
    // Manual and background PR refreshes retry approval discovery.
  }, [active, approvalRefresh, detail?.headOid, discoverApprovals, status?.lastSuccess])

  const visibleApprovals =
    approvalDiscovery?.scope === approvalScope ? approvalDiscovery : undefined
  const setTab = onTabChange
  const search = useSearch({ strict: false }) as { run?: number; job?: number }
  const selectedRun =
    Number.isSafeInteger(search.run) && (search.run ?? 0) > 0 ? search.run : undefined
  const paneRef = useRef<HTMLDivElement>(null)
  const checksRailRef = useRef<HTMLElement>(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 1152))
    observer.observe(pane)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (active && wide && tab === "checks") {
      setTab("conversation")
      requestAnimationFrame(() => checksRailRef.current?.focus())
    }
  }, [active, wide, tab, setTab])
  const [freshness, setFreshness] = useState(() => ({ online: navigator.onLine, now: Date.now() }))
  useEffect(() => {
    if (!active) return
    const update = () => setFreshness({ online: navigator.onLine, now: Date.now() })
    const timer = window.setInterval(update, 30_000)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      clearInterval(timer)
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [active])
  const stale = !status?.lastSuccess || freshness.now - status.lastSuccess > 3 * 60_000

  const selectRun = (run: number, job?: number) =>
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, run, job }),
    })
  const closeRun = () =>
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, run: undefined, job: undefined }),
      replace: true,
    })
  const selectRunJob = (job: number) =>
    void navigate({ to: ".", search: (previous) => ({ ...previous, job }), replace: true })

  const approveWorkflows = async (headSha: string, candidates: PendingWorkflowApproval[]) => {
    const scope = `${repo}#${number}@${headSha}`
    if (currentApprovalScope.current !== scope) {
      throw new Error("The pull request changed. Refresh checks and try again.")
    }
    const approving = approvingScopes.current
    if (approving.has(scope))
      throw new Error("Approval is already in progress for this pull request.")
    approving.add(scope)
    try {
      const results = await Promise.allSettled(
        candidates.map((candidate) => client.approveRun(repo, candidate.id)),
      )
      const succeeded = new Set(
        results.flatMap((result, index) =>
          result.status === "fulfilled" ? [candidates[index]!.id] : [],
        ),
      )
      setApprovalDiscovery((previous) =>
        previous?.scope === scope
          ? { ...previous, candidates: previous.candidates.filter(({ id }) => !succeeded.has(id)) }
          : previous,
      )

      await client.refresh(jobKeys.pull(repo, number))
      if (currentApprovalScope.current === scope) await discoverApprovals(headSha)

      const failedNames = results.flatMap((result, index) => {
        if (result.status !== "rejected") return []
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        return [`${candidates[index]!.name}: ${message}`]
      })
      if (failedNames.length) {
        throw new Error(`Approval failed for: ${failedNames.join(", ")}`)
      }
    } finally {
      approving.delete(scope)
    }
  }

  const workflowApproval: WorkflowApprovalProps = {
    approvalScopeKey: approvalScope,
    approvalCandidates: visibleApprovals?.candidates,
    approvalError: visibleApprovals?.error,
    onApprove: (candidates) => approveWorkflows(detail?.headOid ?? "", candidates),
  }

  useShortcuts(
    {
      Escape: onBack,
      "1": () => setTab("conversation"),
      "2": () => setTab("files"),
      "3": () => {
        if (wide) {
          setTab("conversation")
          requestAnimationFrame(() => checksRailRef.current?.focus())
        } else setTab("checks")
      },
      o: () => detail && void openExternal(detail.url),
      r: () => {
        setApprovalRefresh((value) => value + 1)
        void client.refresh(jobKeys.pull(repo, number))
      },
    },
    active && !selectedRun,
  )

  return (
    <div ref={paneRef} className="pull-pane-container flex h-full min-w-0 flex-col">
      {!hideRepositoryContext && (
        <RepositoryContext owner={owner} repo={name} location={`#${number}`} />
      )}
      <header className="pull-pane-header flex shrink-0 flex-col gap-3 border-b px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="ghost" size="icon-sm" aria-label={backLabel} onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
          {detail && (
            <PullStateIcon state={detail.state} isDraft={detail.isDraft} className="mt-1.5" />
          )}
          <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-0">
            <h1 className="break-words text-lg font-semibold leading-snug">
              <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 text-sm font-semibold tabular-nums text-foreground">
                #{number}
              </span>{" "}
              {detail?.title ?? "Loading pull request…"}
            </h1>
            {detail && (
              <p className="text-xs text-muted-foreground">
                {detail.author?.login} wants to merge <code>{detail.headRef}</code> into{" "}
                <code>{detail.baseRef}</code> ·{" "}
                <span className="text-success">+{detail.additions}</span>{" "}
                <span className="text-destructive">−{detail.deletions}</span>
              </p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              onClick={() => {
                setApprovalRefresh((value) => value + 1)
                void client.refresh(jobKeys.pull(repo, number))
              }}
            >
              <RefreshCwIcon className={cn(status?.running && "animate-spin")} />
            </Button>
            {detail && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open on GitHub"
                onClick={() => openExternal(detail.url)}
              >
                <ExternalLinkIcon />
              </Button>
            )}
            {detail && detail.state === "OPEN" && <ReviewButton detail={detail} />}
          </div>
        </div>
        {actions}
        {!freshness.online || stale || status?.error ? (
          <p className="text-xs text-muted-foreground">
            {!freshness.online
              ? "Offline · "
              : status?.error
                ? "Sync failed · "
                : "Awaiting refresh · "}
            {detail ? "Showing cached pull request and checks." : "Checks are not loaded yet."}
          </p>
        ) : null}
        <div className="flex min-w-0 items-center gap-1">
          <Tabs className="min-w-0 flex-1" value={tab} onValueChange={(v) => setTab(v as PullTab)}>
            <TabsList
              variant="line"
              className="max-w-full flex-wrap justify-start gap-y-3 group-data-horizontal/tabs:h-auto"
            >
              <TabsTrigger className="flex-none" value="conversation">
                Conversation
              </TabsTrigger>
              <TabsTrigger className="flex-none" value="files">
                Files {detail ? `(${detail.changedFiles})` : ""}
              </TabsTrigger>
              <TabsTrigger className={cn("flex-none", wide && "hidden")} value="checks">
                <CheckSummary checks={detail?.checks} />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <CheckSummaryHelp checks={detail?.checks} />
        </div>
      </header>
      {!detail ? (
        <p className="p-6 text-sm text-muted-foreground">
          {error != null ? "Pull request unavailable. Use Refresh to try again." : "Loading…"}
        </p>
      ) : (
        <div className="pull-content-body min-h-0 flex-1">
          {tab === "conversation" && (
            <ConversationTab
              detail={detail}
              onRunSelect={selectRun}
              checksRailRef={checksRailRef}
              workflowApproval={workflowApproval}
            />
          )}
          {tab === "files" && (
            <div className="pull-files-layout flex h-full min-w-0">
              <div className="min-h-0 min-w-0 flex-1">
                <FilesTab detail={detail} />
              </div>
              <aside
                ref={checksRailRef}
                className="pull-files-checks"
                aria-label="Pull request checks"
                tabIndex={-1}
              >
                <h2 className="mb-3 text-sm font-semibold">Checks ({detail.checks.length})</h2>
                <ChecksContent detail={detail} onRunSelect={selectRun} {...workflowApproval} />
              </aside>
            </div>
          )}
          {tab === "checks" && (
            <ChecksTab detail={detail} onRunSelect={selectRun} {...workflowApproval} />
          )}
        </div>
      )}
      {active && selectedRun !== undefined && (
        <RunDialog
          open
          owner={owner}
          name={name}
          runId={selectedRun}
          job={search.job}
          onJobChange={selectRunJob}
          onBack={closeRun}
        />
      )}
    </div>
  )
}
