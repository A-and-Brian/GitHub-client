import { Link } from "@tanstack/react-router"

/** The repository has Actions and Settings routes, but no overview route. */
export function RepositoryContext({
  owner,
  repo,
  location,
}: {
  owner: string
  repo: string
  location?: string
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
      <span className="min-w-0 break-all font-medium">
        {owner}/{repo}
      </span>
      {location && <span className="text-muted-foreground">/ {location}</span>}
      <div className="ml-auto flex items-center gap-3">
        <Link
          to="/actions/$owner/$repo"
          params={{ owner, repo }}
          activeProps={{ className: "text-foreground font-medium", "aria-current": "page" }}
          className="text-muted-foreground hover:text-foreground"
        >
          Actions
        </Link>
        <Link
          to="/settings/$owner/$repo"
          params={{ owner, repo }}
          activeProps={{ className: "text-foreground font-medium", "aria-current": "page" }}
          className="text-muted-foreground hover:text-foreground"
        >
          Settings
        </Link>
      </div>
    </nav>
  )
}
