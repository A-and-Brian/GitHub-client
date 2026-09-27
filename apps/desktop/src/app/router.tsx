import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
} from "@tanstack/react-router"
import { useSession } from "@/app/client"
import { GroupDashboard, HomeDashboard } from "@/screens/dashboard"
import { Inbox } from "@/screens/inbox"
import { inboxSearch } from "@/screens/inbox-location"
import { Layout } from "@/screens/layout"
import type { PullTab } from "@/screens/pull/pull-page"
import { RepositoryBrowser } from "@/screens/repository"

const rootRoute = createRootRoute({ component: Layout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeDashboard,
})

const dashboardSearch = (
  search: Record<string, unknown>,
): ReturnType<typeof inboxSearch> & { tab: "overview" | "repositories" | "pulls" } => ({
  ...inboxSearch(search),
  tab: search.tab === "repositories" || search.tab === "pulls" ? search.tab : "overview",
})

export const orgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/org/$org",
  validateSearch: dashboardSearch,
  component: function OrganizationRoute() {
    const { org } = orgRoute.useParams()
    const { tab } = orgRoute.useSearch()
    const { viewer } = useSession()
    return <GroupDashboard key={`${viewer.login}:org:${org}`} org={org} tab={tab} />
  },
})

export const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team/$org/$slug",
  validateSearch: dashboardSearch,
  component: function TeamRoute() {
    const { org, slug } = teamRoute.useParams()
    const { tab } = teamRoute.useSearch()
    const { viewer } = useSession()
    return (
      <GroupDashboard key={`${viewer.login}:team:${org}/${slug}`} org={org} slug={slug} tab={tab} />
    )
  },
})

export const repositoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repo/$owner/$repo",
  validateSearch: (
    search: Record<string, unknown>,
  ): ReturnType<typeof inboxSearch> & {
    ref?: string
    path?: string
    tab: "code" | "pulls" | "actions" | "releases" | "settings"
  } => ({
    ...inboxSearch(search),
    ref: typeof search.ref === "string" ? search.ref : undefined,
    path: typeof search.path === "string" ? search.path : undefined,
    tab:
      search.tab === "pulls" ||
      search.tab === "actions" ||
      search.tab === "releases" ||
      search.tab === "settings"
        ? search.tab
        : "code",
  }),
  component: function RepositoryRoute() {
    const { owner, repo } = repositoryRoute.useParams()
    const { ref, path, tab } = repositoryRoute.useSearch()
    const { viewer } = useSession()
    return (
      <RepositoryBrowser
        key={`${viewer.login}:${owner}/${repo}`}
        owner={owner}
        repo={repo}
        refName={ref}
        path={path ?? ""}
        tab={tab}
      />
    )
  },
})

export const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/g/$groupId",
  validateSearch: inboxSearch,
  component: function LegacyGroupRoute() {
    const { groupId } = groupRoute.useParams()
    if (groupId.startsWith("org:"))
      return (
        <Navigate
          to="/org/$org"
          params={{ org: groupId.slice(4) }}
          search={{ tab: "pulls" }}
          replace
        />
      )
    if (groupId.startsWith("team:")) {
      const [org, slug] = groupId.slice(5).split("/")
      if (org && slug)
        return (
          <Navigate
            to="/team/$org/$slug"
            params={{ org, slug }}
            search={{ tab: "pulls" }}
            replace
          />
        )
    }
    return <Inbox key={groupId} entityScope={groupId === "me" ? undefined : { groupId }} />
  },
})

export const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  validateSearch: inboxSearch,
  component: function InboxRoute() {
    const { viewer } = useSession()
    return <Inbox key={viewer.login} />
  },
})
export const repoSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$owner/$repo",
  component: function SettingsRoute() {
    const { owner, repo } = repoSettingsRoute.useParams()
    return (
      <Navigate
        to="/repo/$owner/$repo"
        params={{ owner, repo }}
        search={{ tab: "settings" }}
        replace
      />
    )
  },
})

const PULL_TABS: PullTab[] = ["conversation", "files", "checks"]

export const pullRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pr/$owner/$repo/$number",
  validateSearch: (
    search: Record<string, unknown>,
  ): ReturnType<typeof inboxSearch> & { tab: PullTab } => ({
    ...inboxSearch(search),
    tab: PULL_TABS.includes(search.tab as PullTab) ? (search.tab as PullTab) : "conversation",
  }),
  component: function LegacyPullRoute() {
    const { owner, repo, number } = pullRoute.useParams()
    const { tab, run, job } = pullRoute.useSearch()
    return (
      <Navigate
        to="/repo/$owner/$repo"
        params={{ owner, repo }}
        search={{ tab: "pulls", pull: `${owner}/${repo}#${number}`, pullTab: tab, run, job }}
        replace
      />
    )
  },
})

export const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/actions/$owner/$repo",
  component: function LegacyRunsRoute() {
    const { owner, repo } = runsRoute.useParams()
    return (
      <Navigate
        to="/repo/$owner/$repo"
        params={{ owner, repo }}
        search={{ tab: "actions" }}
        replace
      />
    )
  },
})

export const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/actions/$owner/$repo/runs/$runId",
  validateSearch: (search: Record<string, unknown>): { job?: number } => ({
    job: search.job === undefined ? undefined : Number(search.job),
  }),
  component: function LegacyRunRoute() {
    const { owner, repo, runId } = runRoute.useParams()
    const { job } = runRoute.useSearch()
    return (
      <Navigate
        to="/repo/$owner/$repo"
        params={{ owner, repo }}
        search={{ tab: "actions", run: Number(runId), job }}
        replace
      />
    )
  },
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  orgRoute,
  teamRoute,
  repositoryRoute,
  inboxRoute,
  repoSettingsRoute,
  groupRoute,
  pullRoute,
  runsRoute,
  runRoute,
])

// Hash history works the same in the Tauri webview and in a plain browser.
export const createAppRouter = () => createRouter({ routeTree, history: createHashHistory() })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
