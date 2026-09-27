import { jobKeys, prKey } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Tabs, TabsList, TabsTrigger } from "@github-client/ui/components/tabs"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useClient, useJobStatus, useWatch } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { pullRoute } from "@/app/router"
import { useShortcuts } from "@/app/shortcuts"
import { CheckSummary, CheckSummaryHelp } from "@/components/check-summary"
import { RepositoryContext } from "@/components/repository-context"
import { PullStateIcon } from "@/components/status"
import { openExternal } from "@/platform"
import { ChecksTab } from "./checks"
import { ConversationTab } from "./conversation"
import { FilesTab } from "./files"
import { ReviewButton } from "./review"

export type PullTab = "conversation" | "files" | "checks"

export function PullPage() {
  const { owner, repo: name, number: numberParam } = pullRoute.useParams()
  const { tab } = pullRoute.useSearch()
  const navigate = useNavigate()
  return (
    <PullContent
      owner={owner}
      name={name}
      number={Number(numberParam)}
      tab={tab}
      onBack={() => window.history.back()}
      onTabChange={(next) =>
        void navigate({
          to: "/pr/$owner/$repo/$number",
          params: { owner, repo: name, number: numberParam },
          search: { tab: next },
          replace: true,
        })
      }
    />
  )
}

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
}: {
  owner: string
  name: string
  number: number
  tab: PullTab
  onTabChange: (tab: PullTab) => void
  onBack: () => void
  actions?: ReactNode
  backLabel?: string
}) {
  const client = useClient()
  const repo = `${owner}/${name}`
  const key = prKey(repo, number)
  useWatch((c) => c.watchPull(repo, number), [repo, number])
  const status = useJobStatus(jobKeys.pull(repo, number))
  const error = status?.error
  useErrorToast(error, { id: `pull-error:${key}`, title: `Could not load ${repo} #${number}` })
  const detail = useLiveQuery(
    (q) =>
      q.from({ d: client.collections.pullDetails.collection }).where(({ d }) => eq(d.key, key)),
    [key],
  ).data[0]
  const setTab = onTabChange
  const [freshness, setFreshness] = useState(() => ({ online: navigator.onLine, now: Date.now() }))
  useEffect(() => {
    const update = () => setFreshness({ online: navigator.onLine, now: Date.now() })
    const timer = window.setInterval(update, 30_000)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      clearInterval(timer)
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])
  const stale = !status?.lastSuccess || freshness.now - status.lastSuccess > 3 * 60_000

  useShortcuts({
    Escape: onBack,
    "1": () => setTab("conversation"),
    "2": () => setTab("files"),
    "3": () => setTab("checks"),
    o: () => detail && void openExternal(detail.url),
    r: () => void client.refresh(jobKeys.pull(repo, number)),
  })

  return (
    <div className="flex h-full min-w-0 flex-col">
      <RepositoryContext owner={owner} repo={name} location={`#${number}`} />
      <header className="flex shrink-0 flex-col gap-3 border-b px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="ghost" size="icon-sm" aria-label={backLabel} onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
          {detail && (
            <PullStateIcon state={detail.state} isDraft={detail.isDraft} className="mt-1.5" />
          )}
          <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-0">
            <h1 className="break-words text-lg font-semibold leading-snug">
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
              onClick={() => void client.refresh(jobKeys.pull(repo, number))}
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
              <TabsTrigger className="flex-none" value="checks">
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
          {tab === "conversation" && <ConversationTab detail={detail} />}
          {tab === "files" && <FilesTab detail={detail} />}
          {tab === "checks" && <ChecksTab detail={detail} />}
        </div>
      )}
    </div>
  )
}
