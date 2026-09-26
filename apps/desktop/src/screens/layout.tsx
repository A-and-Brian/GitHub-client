import { jobKeys } from "@github-client/core"
import { buildGroupTree, type GroupTreeNode } from "@github-client/core/domain/group-tree"
import { Button } from "@github-client/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@github-client/ui/components/dropdown-menu"
import { Kbd } from "@github-client/ui/components/kbd"
import { cn } from "@github-client/ui/lib/utils"
import { useLiveQuery } from "@tanstack/react-db"
import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import {
  BuildingIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  InboxIcon,
  MenuIcon,
  SearchIcon,
  StarIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useClient, useJobStatus, useSession } from "@/app/client"
import { showError, useErrorToast } from "@/app/errors"
import { useShortcuts } from "@/app/shortcuts"
import { SIGNED_OUT_KEY, VIEWER_KEY } from "@/app/storage-keys"
import { appVersion, checkForUpdates, installUpdate, useUpdateState } from "@/app/updates"
import { UserAvatar } from "@/components/avatar"
import { WindowChrome } from "@/components/window-chrome"
import { isDesktop } from "@/platform"
import { CommandPalette } from "@/screens/command-palette"

const GROUP_ICONS = { me: UserIcon, org: BuildingIcon, team: UsersIcon, starred: StarIcon }

export function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const lastPathname = useRef(pathname)

  useEffect(() => {
    if (lastPathname.current !== pathname) {
      lastPathname.current = pathname
      setMobileMenuOpen(false)
    }
  }, [pathname])

  useShortcuts({ "mod+k": () => setPaletteOpen((open) => !open) })

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      {mobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <GlobalGroupRail
        pathname={pathname}
        mobileMenuOpen={mobileMenuOpen}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b px-3 py-2 md:hidden">
          <Button variant="ghost" size="sm" onClick={() => setMobileMenuOpen(true)}>
            <MenuIcon />
            Navigation
          </Button>
        </div>
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

function GlobalGroupRail({
  pathname,
  mobileMenuOpen,
  onOpenPalette,
}: {
  pathname: string
  mobileMenuOpen: boolean
  onOpenPalette: () => void
}) {
  const { client } = useSession()
  const groups = useLiveQuery((q) =>
    q.from({ g: client.collections.groups.collection }).orderBy(({ g }) => g.order, "asc"),
  ).data
  const pulls = useLiveQuery((q) => q.from({ p: client.collections.pulls.collection })).data
  const counts = new Map<string, number>()
  for (const pull of pulls) counts.set(pull.groupId, (counts.get(pull.groupId) ?? 0) + 1)
  const tree = useMemo(() => buildGroupTree(groups), [groups])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  return (
    <aside
      className={cn(
        "w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:relative md:flex",
        mobileMenuOpen ? "fixed inset-y-0 left-0 z-50 flex" : "hidden md:flex",
      )}
    >
      <WindowChrome />
      <div className="flex items-center gap-2 p-3">
        <Button
          variant="outline"
          className="flex-1 justify-start text-muted-foreground"
          onClick={onOpenPalette}
        >
          <SearchIcon />
          Go to…
          <Kbd className="ml-auto">Ctrl K</Kbd>
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <Link
          to="/inbox"
          className={cn(
            "mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
            pathname === "/inbox" && "bg-sidebar-accent font-medium",
          )}
        >
          <InboxIcon className="size-4 shrink-0 text-muted-foreground" />
          <span>Inbox</span>
        </Link>
        {groups.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">Loading groups…</p>
        )}
        {tree.map((node) => (
          <GroupNavNode
            key={node.group.id}
            node={node}
            depth={0}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            pathname={pathname}
            counts={counts}
          />
        ))}
      </nav>
      <AccountSyncFooter />
    </aside>
  )
}

export function AccountSyncFooter() {
  const { client, viewer } = useSession()
  const [version, setVersion] = useState<string>()

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch((error) => showError("Could not read app version", error))
  }, [])

  return (
    <footer className="flex min-h-12 items-center gap-2 border-t p-2">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-2" />}>
          <UserAvatar src={viewer.avatarUrl} login={viewer.login} />
          <span className="truncate">{viewer.login}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {isDesktop && (
            <>
              <DropdownMenuGroup>
                {version && <DropdownMenuLabel>GitHub-client {version}</DropdownMenuLabel>}
                <DropdownMenuItem onClick={() => void checkForUpdates({ manual: true })}>
                  Check for updates
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onClick={async () => {
              try {
                localStorage.setItem(SIGNED_OUT_KEY, "1")
                localStorage.removeItem(VIEWER_KEY)
                await client.signOut()
                window.location.reload()
              } catch (error) {
                showError("Could not sign out", error)
              }
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SyncIndicator />
      <UpdateButton />
    </footer>
  )
}

function GroupNavNode({
  node,
  depth,
  collapsed,
  setCollapsed,
  pathname,
  counts,
}: {
  node: GroupTreeNode
  depth: number
  collapsed: Set<string>
  setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>
  pathname: string
  counts: Map<string, number>
}) {
  const { group, contextOnly, children } = node
  const Icon = GROUP_ICONS[group.kind]
  const label =
    group.kind === "team" && group.org && group.name.startsWith(`${group.org}/`)
      ? group.name.slice(group.org.length + 1)
      : group.name
  const isCollapsed = collapsed.has(group.id)
  const hasChildren = children.length > 0
  const href = `/g/${encodeURIComponent(group.id)}`
  const active = pathname === href || decodeURIComponent(pathname) === `/g/${group.id}`
  const rowClass = cn(
    "flex min-w-0 items-center gap-2 rounded-md py-1.5 text-sm hover:bg-sidebar-accent",
    active && "bg-sidebar-accent font-medium",
    contextOnly && "text-muted-foreground",
  )

  return (
    <div>
      <div className={rowClass} style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: 8 }}>
        {hasChildren ? (
          <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded hover:bg-sidebar-accent"
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.name}`}
            aria-expanded={!isCollapsed}
            aria-controls={`group-children-${encodeURIComponent(group.id)}`}
            onClick={() =>
              setCollapsed((current) => {
                const next = new Set(current)
                if (next.has(group.id)) next.delete(group.id)
                else next.add(group.id)
                return next
              })
            }
          >
            {isCollapsed ? (
              <ChevronRightIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {contextOnly ? (
          <span
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate"
            title={`${group.name} (parent team)`}
          >
            {label}
            {node.contextKind === "team" && (
              <span className="shrink-0 text-[10px] font-normal">parent</span>
            )}
          </span>
        ) : (
          <Link
            to="/g/$groupId"
            params={{ groupId: group.id }}
            className="min-w-0 flex-1 truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        )}
        {!contextOnly && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {counts.get(group.id) ?? ""}
          </span>
        )}
      </div>
      {hasChildren && (
        <div id={`group-children-${encodeURIComponent(group.id)}`} hidden={isCollapsed}>
          {children.map((child) => (
            <GroupNavNode
              key={child.group.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              pathname={pathname}
              counts={counts}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Shows when a newer version is available; installs it and restarts. */
function UpdateButton() {
  const update = useUpdateState()
  if (update.status !== "available" && update.status !== "installing") return null
  const installing = update.status === "installing"
  const progress =
    installing && update.progress !== undefined ? ` ${Math.round(update.progress * 100)}%` : ""
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={installing}
      title={`Install version ${update.version} and restart`}
      onClick={() => void installUpdate()}
    >
      <DownloadIcon />
      {installing ? `Updating${progress}` : "Update"}
    </Button>
  )
}

/** Remaining GraphQL budget plus a dot that shows background sync errors. */
function SyncIndicator() {
  const client = useClient()
  const groups = useJobStatus(jobKeys.groups)
  useErrorToast(groups?.error, { id: "groups-sync-error", title: "Could not refresh groups" })
  const graphql = useSyncExternalStore(
    (listener) => client.rest.rateLimits.subscribe(listener),
    () => client.rest.rateLimits.get("graphql"),
  )
  const error = groups?.error
  return (
    <div
      className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground"
      title={error ? `Sync failed: ${String(error)}` : "GraphQL requests left this hour"}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          error ? "bg-destructive" : groups?.running ? "bg-warning" : "bg-success",
        )}
      />
      {graphql && <span className="tabular-nums">{graphql.remaining}</span>}
    </div>
  )
}
