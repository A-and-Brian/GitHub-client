import { jobKeys } from "@github-client/core"
import { buildGroupTree, type GroupTreeNode } from "@github-client/core/domain/group-tree"
import { deriveInboxPulls } from "@github-client/core/inbox"
import { Button } from "@github-client/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@github-client/ui/components/dropdown-menu"
import { Kbd } from "@github-client/ui/components/kbd"
import { cn } from "@github-client/ui/lib/utils"
import { useLiveQuery } from "@tanstack/react-db"
import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
  BuildingIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  HomeIcon,
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
import { useTheme } from "@/components/theme-provider"
import { isMacDesktop, WindowChrome } from "@/components/window-chrome"
import { isDesktop } from "@/platform"
import { CommandPalette } from "@/screens/command-palette"

const GROUP_ICONS = { me: UserIcon, org: BuildingIcon, team: UsersIcon, starred: StarIcon }
const SIDEBAR_WIDTH_KEY = "github-client.main-sidebar-width.v1"
const DEFAULT_SIDEBAR_WIDTH = 240
const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 400

function savedSidebarWidth() {
  try {
    const width = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(width) && width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH
      ? width
      : DEFAULT_SIDEBAR_WIDTH
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

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
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden" onMouseDown={startWindowDrag}>
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

function startWindowDrag(event: React.MouseEvent<HTMLElement>) {
  if (!isMacDesktop || event.button !== 0 || event.defaultPrevented || event.clientY > 40) {
    return
  }

  const target = event.target
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
  if (
    target.closest(
      "button, a, input, textarea, select, summary, label, [role='button'], [role='tab'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='switch'], [role='combobox'], [role='option'], [contenteditable]:not([contenteditable='false'])",
    )
  ) {
    return
  }

  event.preventDefault()
  void getCurrentWindow()
    .startDragging()
    .catch((error) => showError("Could not drag window", error))
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
  const { client, viewer } = useSession()
  const [sidebarWidth, setSidebarWidth] = useState(savedSidebarWidth)
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null)
  const groups = useLiveQuery((q) =>
    q.from({ g: client.collections.groups.collection }).orderBy(({ g }) => g.order, "asc"),
  ).data
  const pulls = useLiveQuery((q) => q.from({ p: client.collections.pulls.collection })).data
  const counts = useMemo(() => {
    const next = new Map<string, number>()
    for (const pull of pulls) next.set(pull.groupId, (next.get(pull.groupId) ?? 0) + 1)
    return next
  }, [pulls])
  const inboxCount = useMemo(
    () => deriveInboxPulls(pulls, groups, viewer.login, [], Date.now(), "involving").length,
    [pulls, groups, viewer.login],
  )
  const setWidth = (requested: number) => {
    const width = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, requested))
    setSidebarWidth(width)
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
    } catch {
      // Resizing remains available when browser storage is disabled.
    }
  }
  const tree = useMemo(() => buildGroupTree(groups), [groups])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "relative w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:relative md:inset-auto md:left-auto md:z-auto md:w-[var(--main-sidebar-width)] md:flex",
        mobileMenuOpen ? "fixed inset-y-0 left-0 z-50 flex" : "hidden md:flex",
      )}
      style={{ "--main-sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
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
          to="/"
          className={cn(
            "mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
            pathname === "/" && "bg-sidebar-accent font-medium",
          )}
        >
          <HomeIcon className="size-4 shrink-0 text-muted-foreground" />
          <span>Home</span>
        </Link>
        <Link
          to="/inbox"
          className={cn(
            "mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
            pathname === "/inbox" && "bg-sidebar-accent font-medium",
          )}
        >
          <InboxIcon className="size-4 shrink-0 text-muted-foreground" />
          <span>Inbox</span>
          <span
            className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
            aria-hidden="true"
          >
            {inboxCount}
          </span>
        </Link>
        <hr className="my-2" />
        {groups.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">Loading groups…</p>
        )}
        {tree
          .filter((node) => node.group.kind !== "me")
          .map((node) => (
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
      <hr
        tabIndex={0}
        aria-label="Resize main sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        className="absolute inset-y-0 right-0 z-10 hidden h-full w-2 cursor-col-resize touch-none border-0 bg-transparent hover:bg-primary/20 focus-visible:bg-primary/40 focus-visible:outline-none md:block"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return
          sidebarDrag.current = { x: event.clientX, width: sidebarWidth }
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
        }}
        onPointerMove={(event) => {
          if (!sidebarDrag.current) return
          if (!(event.buttons & 1)) {
            sidebarDrag.current = null
            return
          }
          setWidth(sidebarDrag.current.width + event.clientX - sidebarDrag.current.x)
        }}
        onPointerUp={() => {
          sidebarDrag.current = null
        }}
        onPointerCancel={() => {
          sidebarDrag.current = null
        }}
        onLostPointerCapture={() => {
          sidebarDrag.current = null
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
          event.preventDefault()
          if (event.key === "Home") setWidth(MIN_SIDEBAR_WIDTH)
          else if (event.key === "End") setWidth(MAX_SIDEBAR_WIDTH)
          else setWidth(sidebarWidth + (event.key === "ArrowLeft" ? -16 : 16))
        }}
      />
    </aside>
  )
}

export function AccountSyncFooter() {
  const { client, viewer } = useSession()
  const { theme, setTheme } = useTheme()
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
          <DropdownMenuGroup>
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as typeof theme)}
            >
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              try {
                localStorage.setItem(SIGNED_OUT_KEY, "1")
                localStorage.removeItem(VIEWER_KEY)
                await client.signOut()
                window.history.replaceState(
                  null,
                  "",
                  `${window.location.pathname}${window.location.search}#/inbox`,
                )
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
  const destination =
    group.kind === "org"
      ? {
          to: "/org/$org" as const,
          params: { org: group.org ?? group.name },
          search: { tab: "overview" as const },
        }
      : group.kind === "team" && group.org
        ? {
            to: "/team/$org/$slug" as const,
            params: { org: group.org, slug: group.id.slice(group.id.indexOf("/") + 1) },
            search: { tab: "overview" as const },
          }
        : { to: "/g/$groupId" as const, params: { groupId: group.id } }
  const decodedPath = decodeURIComponent(pathname)
  const active =
    decodedPath === `/g/${group.id}` ||
    (group.kind === "org" && decodedPath === `/org/${group.org ?? group.name}`) ||
    (group.kind === "team" && decodedPath === `/team/${group.id.slice(5)}`)
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
            {...destination}
            className="min-w-0 flex-1 truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        )}
        {!contextOnly && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
            {counts.get(group.id) ?? 0}
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
