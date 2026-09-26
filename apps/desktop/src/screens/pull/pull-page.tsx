import { jobKeys, prKey } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import { Tabs, TabsList, TabsTrigger } from "@github-client/ui/components/tabs"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { useClient, useJobStatus, useWatch } from "@/app/client"
import { useErrorToast } from "@/app/errors"
import { pullRoute } from "@/app/router"
import { useShortcuts } from "@/app/shortcuts"
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
}: {
  owner: string
  name: string
  number: number
  tab: PullTab
  onTabChange: (tab: PullTab) => void
  onBack: () => void
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
      <header className="flex flex-col gap-2 border-b px-4 pt-3">
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
          {detail && (
            <PullStateIcon state={detail.state} isDraft={detail.isDraft} className="mt-1.5" />
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold break-all">
                {repo} #{number}
              </span>
              <Link
                to="/settings/$owner/$repo"
                params={{ owner, repo: name }}
                className="text-xs text-muted-foreground underline"
              >
                Repository settings
              </Link>
            </div>
            <h1 className="text-base font-semibold leading-snug">
              {detail?.title ?? `${repo}#${number}`}{" "}
              <span className="font-normal text-muted-foreground">#{number}</span>
            </h1>
            {detail && (
              <p className="text-xs text-muted-foreground">
                {detail.author?.login} wants to merge <code>{detail.headRef}</code> into{" "}
                <code>{detail.baseRef}</code> · {repo} ·{" "}
                <span className="text-success">+{detail.additions}</span>{" "}
                <span className="text-destructive">−{detail.deletions}</span>
              </p>
            )}
          </div>
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
        <Tabs value={tab} onValueChange={(v) => setTab(v as PullTab)}>
          <TabsList variant="line">
            <TabsTrigger value="conversation">Conversation</TabsTrigger>
            <TabsTrigger value="files">
              Files {detail ? `(${detail.changedFiles})` : ""}
            </TabsTrigger>
            <TabsTrigger value="checks">
              Checks {detail ? `(${detail.checks.length})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
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
