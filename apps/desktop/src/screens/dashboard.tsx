import { type Group, jobKeys, type PullRequest } from "@github-client/core"
import { GitHubError } from "@github-client/core/github/rest"
import type { RepositoryScope } from "@github-client/core/repositories"
import { Button } from "@github-client/ui/components/button"
import { cn } from "@github-client/ui/lib/utils"
import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { Link, useSearch } from "@tanstack/react-router"
import {
  ArrowUpRightIcon,
  Building2Icon,
  GitBranchIcon,
  LockKeyholeIcon,
  UsersIcon,
} from "lucide-react"
import { type ReactNode, useMemo } from "react"
import { useJobStatus, useSession, useWatch } from "@/app/client"
import { useRepositoryPages } from "@/app/repository-cache"
import { RepositoryCacheStatus } from "@/components/repository-cache-status"
import { ReviewBadge, rollupState, StateIcon } from "@/components/status"
import { RelativeTime } from "@/components/time"

import { Inbox } from "./inbox"

type GroupTab = "overview" | "repositories" | "pulls"

export function HomeDashboard() {
  const { client } = useSession()
  const groups = useLiveQuery((q) =>
    q.from({ g: client.collections.groups.collection }).orderBy(({ g }) => g.order, "asc"),
  ).data
  const sync = useJobStatus(jobKeys.groups)
  const orgs = groups.filter((group) => group.kind === "org")
  const teams = groups.filter((group) => group.kind === "team")

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b px-6 py-7 md:px-10">
        <p className="text-sm text-muted-foreground">Home</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Organizations and teams</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a workspace to browse its repositories and recent pull requests.
        </p>
      </header>
      <div className="mx-auto max-w-5xl space-y-9 p-6 md:p-10">
        {Boolean(sync?.error) && (
          <div
            role="status"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            Organizations and teams could not be refreshed. Your saved list may be out of date.
          </div>
        )}
        {orgs.length === 0 && teams.length === 0 ? (
          <section className="rounded-lg border p-8 text-center">
            <Building2Icon className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 font-medium">
              {sync?.error && !sync.lastSuccess
                ? "Organizations and teams could not be loaded"
                : sync?.lastSuccess
                  ? "No organizations or teams yet"
                  : "Loading organizations and teams…"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {sync?.error && !sync.lastSuccess
                ? "Check your connection and try again."
                : "Organizations and teams available to your GitHub account will appear here."}
            </p>
            {Boolean(sync?.error && !sync.lastSuccess) && (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void client.refresh(jobKeys.groups)}
              >
                Retry
              </Button>
            )}
          </section>
        ) : null}
        {orgs.length > 0 && (
          <section aria-labelledby="organizations-heading">
            <SectionHeading
              id="organizations-heading"
              icon={<Building2Icon />}
              title="Organizations"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {orgs.map((org) => (
                <Link
                  key={org.id}
                  to="/org/$org"
                  params={{ org: org.org ?? org.name }}
                  search={{ tab: "overview" }}
                  className="group rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{org.name}</span>
                    <ArrowUpRightIcon className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Organization workspace</p>
                </Link>
              ))}
            </div>
          </section>
        )}
        {teams.length > 0 && (
          <section aria-labelledby="teams-heading">
            <SectionHeading id="teams-heading" icon={<UsersIcon />} title="Your teams" />
            <div className="mt-3 divide-y rounded-lg border">
              {teams.map((team) => (
                <Link
                  key={team.id}
                  to="/team/$org/$slug"
                  params={{ org: team.org ?? "", slug: groupSlug(team) }}
                  search={{ tab: "overview" }}
                  className="group flex items-center justify-between gap-3 p-4 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{team.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {team.org ?? "Organization"}
                    </p>
                  </div>
                  <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export function GroupDashboard({
  org,
  slug,
  tab = "overview",
}: {
  org: string
  slug?: string
  tab?: GroupTab
}) {
  const routeSearch = useSearch({ strict: false })
  const groupId = slug ? `team:${org}/${slug}` : `org:${org}`
  const { client, viewer } = useSession()
  const group = useLiveQuery(
    (q) => q.from({ g: client.collections.groups.collection }).where(({ g }) => eq(g.id, groupId)),
    [groupId],
  ).data[0]
  const groups = useLiveQuery(
    (q) => q.from({ g: client.collections.groups.collection }),
    [groupId],
  ).data
  useWatch((c) => c.watchGroup(groupId), [groupId])
  const sync = useJobStatus(jobKeys.groupPulls(groupId))
  const pulls = useLiveQuery(
    (q) =>
      q
        .from({ p: client.collections.pulls.collection })
        .where(({ p }) => eq(p.groupId, groupId))
        .orderBy(({ p }) => p.updatedAt, "desc"),
    [groupId],
  ).data
  const children = groups.filter((candidate) => candidate.kind === "team" && candidate.org === org)
  const title = group?.kind === "team" ? group.name.replace(`${org}/`, "") : (group?.name ?? org)
  const scope = useMemo<RepositoryScope>(
    () => (slug ? { kind: "team", org, slug } : { kind: "org", org }),
    [org, slug],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-6 py-6 md:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground">
              Home
            </Link>
            <span>/</span>
            {slug ? (
              <>
                <Link
                  to="/org/$org"
                  params={{ org }}
                  search={{ tab: "overview" }}
                  className="hover:text-foreground"
                >
                  {org}
                </Link>
                <span>/</span>
              </>
            ) : null}
            <span>{slug ? "Team" : "Organization"}</span>
          </div>
          <div className="mt-3 flex items-start gap-3">
            <div className="rounded-lg border bg-muted p-2.5">
              {slug ? <UsersIcon className="size-5" /> : <Building2Icon className="size-5" />}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {slug ? `Team in ${org}` : "Organization workspace"}
              </p>
            </div>
          </div>
          <nav aria-label={`${title} navigation`} className="mt-6 flex gap-5 border-b-0 text-sm">
            <Link
              to={slug ? "/team/$org/$slug" : "/org/$org"}
              params={slug ? { org, slug } : { org }}
              search={{ ...routeSearch, tab: "overview" }}
              className={
                tab === "overview"
                  ? "border-b-2 border-primary pb-2 font-medium"
                  : "pb-2 text-muted-foreground hover:text-foreground"
              }
            >
              Overview
            </Link>
            <Link
              to={slug ? "/team/$org/$slug" : "/org/$org"}
              params={slug ? { org, slug } : { org }}
              search={{ ...routeSearch, tab: "repositories" }}
              className={
                tab === "repositories"
                  ? "border-b-2 border-primary pb-2 font-medium"
                  : "pb-2 text-muted-foreground hover:text-foreground"
              }
            >
              Repositories
            </Link>
            <Link
              to={slug ? "/team/$org/$slug" : "/org/$org"}
              params={slug ? { org, slug } : { org }}
              search={{ ...routeSearch, tab: "pulls" }}
              className={
                tab === "pulls"
                  ? "border-b-2 border-primary pb-2 font-medium"
                  : "pb-2 text-muted-foreground hover:text-foreground"
              }
            >
              Pull requests
            </Link>
          </nav>
        </div>
      </header>
      <div hidden={tab !== "pulls"} className={tab === "pulls" ? "min-h-0 flex-1" : "hidden"}>
        <Inbox entityScope={{ groupId }} active={tab === "pulls"} />
      </div>
      <div
        hidden={tab === "pulls"}
        className={tab === "pulls" ? "hidden" : "min-h-0 flex-1 overflow-y-auto"}
      >
        <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-10">
          {tab === "repositories" ? (
            <RepositoryCatalog key={`${viewer.login}:${groupId}`} scope={scope} />
          ) : (
            <>
              {!slug && (
                <section aria-labelledby="member-teams-heading">
                  <SectionHeading
                    id="member-teams-heading"
                    icon={<UsersIcon />}
                    title="Your teams"
                  />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {children.length ? (
                      children.map((team) => (
                        <Link
                          key={team.id}
                          to="/team/$org/$slug"
                          params={{ org, slug: groupSlug(team) }}
                          search={{ tab: "overview" }}
                          className="rounded-lg border bg-card p-4 hover:bg-accent/40"
                        >
                          <span className="font-medium">{team.name.replace(`${org}/`, "")}</span>
                          <p className="mt-1 text-sm text-muted-foreground">Team workspace</p>
                        </Link>
                      ))
                    ) : (
                      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                        No visible member teams.
                      </p>
                    )}
                  </div>
                </section>
              )}
              <section aria-labelledby="repositories-heading">
                <SectionHeading
                  id="repositories-heading"
                  icon={<GitBranchIcon />}
                  title="Repositories"
                />
                <RepositoryCatalog key={`${viewer.login}:${groupId}`} scope={scope} preview />
              </section>
              <RecentPulls
                pulls={pulls}
                running={Boolean(sync?.running)}
                error={Boolean(sync?.error)}
                synced={sync?.lastSuccess !== undefined || pulls.length > 0}
                lastSuccess={sync?.lastSuccess}
                groupId={groupId}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RepositoryCatalog({
  scope,
  preview = false,
}: {
  scope: RepositoryScope
  preview?: boolean
}) {
  const { client, viewer } = useSession()
  const catalog = useRepositoryPages({
    kind: "catalog",
    host: client.rest.url("/"),
    accountLogin: viewer.login,
    scope,
    page: 1,
    pageSize: 100,
    query: scope.kind === "org" ? "type=all" : "",
  })
  const { state } = catalog
  const items = state.data?.items ?? []
  const hasMore = state.data?.hasMore ?? false
  const loading = !state.loaded && !state.error
  const error = state.error
  const shown = preview ? items.slice(0, 5) : items
  const denied =
    error instanceof GitHubError && [401, 403, 404].includes(error.status) && !error.rateLimited
  const unavailable = denied
    ? "This repository catalog is inaccessible for the current account."
    : "Not saved for offline use. Repositories could not be loaded. Try again."
  return (
    <div className={preview ? "mt-3" : ""}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <RepositoryCacheStatus states={[state]} />
        {state.loaded && error && (
          <Button size="sm" variant="ghost" onClick={() => void catalog.retry()}>
            Retry
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={state.refreshing}
          onClick={() => void catalog.refresh()}
          aria-label="Refresh repositories"
        >
          Refresh
        </Button>
      </div>
      {Boolean(error) && !state.loaded && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 p-3 text-sm"
        >
          <span>{unavailable}</span>
          <Button size="sm" variant="outline" onClick={() => void catalog.retry()}>
            Retry
          </Button>
        </div>
      )}
      {shown.length > 0 ? (
        <div className="divide-y rounded-lg border">
          {shown.map((repo) => (
            <Link
              key={repo.id}
              to="/repo/$owner/$repo"
              params={{ owner: repo.owner, repo: repo.name }}
              search={{ tab: "code" }}
              className="flex items-center gap-3 p-3 hover:bg-accent/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{repo.name}</span>
                  {repo.private && (
                    <LockKeyholeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {repo.archived && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Archived
                    </span>
                  )}
                </div>
                {repo.description && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">{repo.description}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{repo.defaultBranch}</span>
            </Link>
          ))}
        </div>
      ) : loading ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">Loading repositories…</p>
      ) : state.loaded ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          No repositories found.
        </p>
      ) : null}
      {preview && (state.loaded || !error) ? (
        <Link
          to={scope.kind === "team" ? "/team/$org/$slug" : "/org/$org"}
          params={scope.kind === "team" ? { org: scope.org, slug: scope.slug } : { org: scope.org }}
          search={{ tab: "repositories" }}
          className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
        >
          View all repositories
        </Link>
      ) : null}
      {!preview && hasMore && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            disabled={state.refreshing}
            onClick={() => void catalog.loadMore()}
          >
            {state.refreshing ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  )
}

function RecentPulls({
  pulls,
  running,
  error,
  synced,
  lastSuccess,
  groupId,
}: {
  pulls: PullRequest[]
  running: boolean
  error: boolean
  synced: boolean
  lastSuccess?: number
  groupId: string
}) {
  const recent = useMemo(
    () => [...pulls].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    [pulls],
  )
  return (
    <section aria-labelledby="recent-pulls-heading">
      <div className="flex items-center justify-between gap-3">
        <SectionHeading
          id="recent-pulls-heading"
          icon={<GitBranchIcon />}
          title="Recent synced open pull requests"
        />
        <Link
          to="/g/$groupId"
          params={{ groupId }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          View all
        </Link>
      </div>
      {lastSuccess !== undefined && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          Last synced <RelativeTime iso={new Date(lastSuccess).toISOString()} />
          {running && " · Refreshing"}
        </p>
      )}
      {error && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          The synced snapshot may be out of date. Refresh from Pull requests.
        </p>
      )}
      <div className="mt-3 divide-y rounded-lg border">
        {recent.map((pull) => (
          <PullPreview key={pull.key} pull={pull} groupId={groupId} />
        ))}
        {recent.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {running && !synced
              ? "Loading synced pull requests…"
              : synced
                ? "No open pull requests in the synced snapshot."
                : "No synced activity yet. This does not indicate whether GitHub has open pull requests."}
          </p>
        )}
      </div>
    </section>
  )
}

function PullPreview({ pull, groupId }: { pull: PullRequest; groupId: string }) {
  const team = groupId.startsWith("team:")
  const [org, slug] = groupId.replace(/^(org|team):/, "").split("/")
  return (
    <Link
      to={team ? "/team/$org/$slug" : "/org/$org"}
      params={team ? { org: org!, slug: slug! } : { org: org! }}
      search={{ tab: "pulls", pull: `${pull.repo}#${pull.number}` }}
      className="flex items-center gap-3 p-3 hover:bg-accent/40"
    >
      {rollupState(pull.checkState) && <StateIcon state={rollupState(pull.checkState)!} />}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", pull.isDraft && "text-muted-foreground")}>
          {pull.isDraft ? "Draft: " : ""}
          {pull.title}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {pull.repo}#{pull.number} · {pull.author ?? "Unknown author"}
        </p>
      </div>
      <ReviewBadge decision={pull.reviewDecision} />
      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
        <RelativeTime iso={pull.updatedAt} />
      </span>
    </Link>
  )
}

function SectionHeading({ id, icon, title }: { id: string; icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
    </div>
  )
}

function groupSlug(group: Group): string {
  return group.id.slice(`team:${group.org ?? ""}/`.length)
}
