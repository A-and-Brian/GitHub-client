import { Link } from "@tanstack/react-router"

/** Shared entry points for repository pages and standalone PR details. */
export function RepositoryContext({
  owner,
  repo,
  location,
  showSettings,
}: {
  owner: string
  repo: string
  location?: string
  showSettings?: boolean
}) {
  return (
    <nav
      aria-label="Repository navigation"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-xs"
    >
      <Link to="/inbox" className="text-muted-foreground hover:text-foreground">
        Inbox
      </Link>
      <span aria-hidden="true" className="text-muted-foreground">
        /
      </span>
      <Link
        to="/repo/$owner/$repo"
        params={{ owner, repo }}
        search={{ tab: "code" }}
        className="min-w-0 break-all font-medium hover:underline"
      >
        {owner}/{repo}
      </Link>
      {location && <span className="text-muted-foreground">/ {location}</span>}
      <div className="ml-auto flex items-center gap-3">
        <Link
          to="/repo/$owner/$repo"
          search={{ tab: "actions" }}
          params={{ owner, repo }}
          activeProps={{ className: "text-foreground font-medium", "aria-current": "page" }}
          className="text-muted-foreground hover:text-foreground"
        >
          Actions
        </Link>
        {showSettings !== false && (
          <Link
            to="/repo/$owner/$repo"
            search={{ tab: "settings" }}
            params={{ owner, repo }}
            activeProps={{ className: "text-foreground font-medium", "aria-current": "page" }}
            className="text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
        )}
      </div>
    </nav>
  )
}
