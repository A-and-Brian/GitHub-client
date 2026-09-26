import { jobKeys } from "@github-client/core"
import { Button } from "@github-client/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@github-client/ui/components/dropdown-menu"
import { Kbd } from "@github-client/ui/components/kbd"
import { cn } from "@github-client/ui/lib/utils"
import { useLiveQuery } from "@tanstack/react-db"
import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { BuildingIcon, SearchIcon, StarIcon, UserIcon, UsersIcon } from "lucide-react"
import { useState, useSyncExternalStore } from "react"
import { useClient, useJobStatus, useSession } from "@/app/client"
import { useShortcuts } from "@/app/shortcuts"
import { UserAvatar } from "@/components/avatar"
import { CommandPalette } from "@/screens/command-palette"

const GROUP_ICONS = { me: UserIcon, org: BuildingIcon, team: UsersIcon, starred: StarIcon }

export function Layout() {
  const { client, viewer } = useSession()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const groups = useLiveQuery((q) =>
    q.from({ g: client.collections.groups.collection }).orderBy(({ g }) => g.order, "asc"),
  ).data
  const pulls = useLiveQuery((q) => q.from({ p: client.collections.pulls.collection })).data
  const counts = new Map<string, number>()
  for (const p of pulls) counts.set(p.groupId, (counts.get(p.groupId) ?? 0) + 1)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useShortcuts({ "mod+k": () => setPaletteOpen((open) => !open) })

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 p-3">
          <Button
            variant="outline"
            className="flex-1 justify-start text-muted-foreground"
            onClick={() => setPaletteOpen(true)}
          >
            <SearchIcon />
            Go to…
            <Kbd className="ml-auto">Ctrl K</Kbd>
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {groups.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">Loading groups…</p>
          )}
          {groups.map((group) => {
            const Icon = GROUP_ICONS[group.kind]
            const href = `/g/${encodeURIComponent(group.id)}`
            const active = pathname === href || decodeURIComponent(pathname) === `/g/${group.id}`
            return (
              <Link
                key={group.id}
                to="/g/$groupId"
                params={{ groupId: group.id }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
                  active && "bg-sidebar-accent font-medium",
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{group.name}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {counts.get(group.id) ?? ""}
                </span>
              </Link>
            )
          })}
        </nav>
        <footer className="flex items-center gap-2 border-t p-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-2" />}>
              <UserAvatar src={viewer.avatarUrl} login={viewer.login} />
              <span className="truncate">{viewer.login}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={async () => {
                  await client.signOut()
                  window.location.reload()
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SyncIndicator />
        </footer>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

/** Remaining GraphQL budget plus a dot that shows background sync errors. */
function SyncIndicator() {
  const client = useClient()
  const groups = useJobStatus(jobKeys.groups)
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
