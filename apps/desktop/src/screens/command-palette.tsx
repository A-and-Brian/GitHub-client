import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@github-client/ui/components/command"
import { useLiveQuery } from "@tanstack/react-db"
import { useNavigate } from "@tanstack/react-router"
import { useClient } from "@/app/client"
import { checkForUpdates } from "@/app/updates"
import { useTheme } from "@/components/theme-provider"
import { isDesktop } from "@/platform"

const MAX_PULLS = 200

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useClient()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const groups = useLiveQuery((q) =>
    q.from({ g: client.collections.groups.collection }).orderBy(({ g }) => g.order, "asc"),
  ).data
  const pulls = useLiveQuery((q) =>
    q.from({ p: client.collections.pulls.collection }).orderBy(({ p }) => p.updatedAt, "desc"),
  ).data
  const repos = useLiveQuery((q) =>
    q.from({ r: client.collections.repos.collection }).orderBy(({ r }) => r.fullName, "asc"),
  ).data

  const uniquePulls = [...new Map(pulls.map((p) => [p.id, p])).values()].slice(0, MAX_PULLS)
  // Org repos are not listed up front, so repos seen in pull requests count too.
  const repoNames = [
    ...new Set([...repos.map((r) => r.fullName), ...pulls.map((p) => p.repo)]),
  ].sort()
  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Go to" className="sm:max-w-xl">
      <Command>
        <CommandInput placeholder="Pull requests, groups, repositories, commands…" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Inbox">
            <CommandItem
              value="inbox active snoozed settled pull requests"
              onSelect={() => run(() => navigate({ to: "/inbox" }))}
            >
              PR inbox
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Groups">
            {groups.map((g) => (
              <CommandItem
                key={g.id}
                value={`group ${g.name}`}
                onSelect={() =>
                  run(() => navigate({ to: "/g/$groupId", params: { groupId: g.id } }))
                }
              >
                {g.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Pull requests">
            {uniquePulls.map((p) => {
              const [owner, repo] = p.repo.split("/") as [string, string]
              return (
                <CommandItem
                  key={p.id}
                  value={`${p.repo}#${p.number} ${p.title}`}
                  onSelect={() =>
                    run(() =>
                      navigate({
                        to: "/pr/$owner/$repo/$number",
                        params: { owner, repo, number: String(p.number) },
                        search: { tab: "conversation" },
                      }),
                    )
                  }
                >
                  <span className="truncate">{p.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {p.repo}#{p.number}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandGroup heading="Actions">
            {repoNames.map((fullName) => {
              const [owner, repo] = fullName.split("/") as [string, string]
              return (
                <CommandItem
                  key={fullName}
                  value={`actions ${fullName}`}
                  onSelect={() =>
                    run(() => navigate({ to: "/actions/$owner/$repo", params: { owner, repo } }))
                  }
                >
                  <span className="truncate">{fullName}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Workflow runs</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandGroup heading="Repository settings">
            {repoNames.map((fullName) => {
              const [owner, repo] = fullName.split("/") as [string, string]
              return (
                <CommandItem
                  key={fullName}
                  value={`settings ${fullName}`}
                  onSelect={() =>
                    run(() => navigate({ to: "/settings/$owner/$repo", params: { owner, repo } }))
                  }
                >
                  {fullName} · Settings
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandGroup heading="Commands">
            <CommandItem
              value="toggle theme dark light"
              onSelect={() => run(() => setTheme(theme === "dark" ? "light" : "dark"))}
            >
              Toggle dark mode
            </CommandItem>
            <CommandItem
              value="refresh groups sync"
              onSelect={() => run(() => void client.refresh("groups"))}
            >
              Refresh groups
            </CommandItem>
            {isDesktop && (
              <CommandItem
                value="check for updates upgrade version install"
                onSelect={() => run(() => void checkForUpdates({ manual: true }))}
              >
                Check for updates
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
