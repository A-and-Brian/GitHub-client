import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router"
import { RunPage } from "@/screens/actions/run"
import { RunsPage } from "@/screens/actions/runs"
import { GroupPulls } from "@/screens/group-pulls"
import { Inbox } from "@/screens/inbox"
import { Layout } from "@/screens/layout"
import { PullPage, type PullTab } from "@/screens/pull/pull-page"
import { RepositorySettings } from "@/screens/repository-settings"

const rootRoute = createRootRoute({ component: Layout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/inbox" })
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
