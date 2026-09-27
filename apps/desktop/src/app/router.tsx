import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { useSession } from "@/app/client"
import { RunPage } from "@/screens/actions/run"
import { RunsPage } from "@/screens/actions/runs"
import { GroupDashboard, HomeDashboard } from "@/screens/dashboard"
import { GroupPulls } from "@/screens/group-pulls"
import { Inbox } from "@/screens/inbox"
import { Layout } from "@/screens/layout"
import { PullPage, type PullTab } from "@/screens/pull/pull-page"
import { RepositoryBrowser } from "@/screens/repository"
import { RepositorySettings } from "@/screens/repository-settings"

const rootRoute = createRootRoute({ component: Layout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeDashboard,
})

const dashboardSearch = (
  search: Record<string, unknown>,
): { tab: "overview" | "repositories" } => ({
  tab: search.tab === "repositories" ? "repositories" : "overview",
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
  ): { ref?: string; path?: string; tab: "code" | "pulls" } => ({
    ref: typeof search.ref === "string" ? search.ref : undefined,
    path: typeof search.path === "string" ? search.path : undefined,
    tab: search.tab === "pulls" ? "pulls" : "code",
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
  component: GroupPulls,
})

export const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  component: Inbox,
})
export const repoSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$owner/$repo",
  component: function SettingsRoute() {
    const { owner, repo } = repoSettingsRoute.useParams()
    return <RepositorySettings key={`${owner}/${repo}`} owner={owner} repo={repo} />
  },
})

const PULL_TABS: PullTab[] = ["conversation", "files", "checks"]

export const pullRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pr/$owner/$repo/$number",
  validateSearch: (search: Record<string, unknown>): { tab: PullTab } => ({
    tab: PULL_TABS.includes(search.tab as PullTab) ? (search.tab as PullTab) : "conversation",
  }),
  component: PullPage,
})

export const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/actions/$owner/$repo",
  component: RunsPage,
})

export const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/actions/$owner/$repo/runs/$runId",
  validateSearch: (search: Record<string, unknown>): { job?: number } => ({
    job: search.job === undefined ? undefined : Number(search.job),
  }),
  component: RunPage,
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
