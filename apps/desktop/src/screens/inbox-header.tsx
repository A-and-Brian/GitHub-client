import { Button } from "@github-client/ui/components/button"
import { Input } from "@github-client/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@github-client/ui/components/popover"
import { cn } from "@github-client/ui/lib/utils"
import { InboxIcon, InfoIcon, RefreshCwIcon } from "lucide-react"
import type { RefObject } from "react"

export function InboxHeader({
  search,
  text,
  onTextChange,
  scope,
  onScopeChange,
  failures,
  onToggleFailures,
  onRefresh,
  refreshing,
  online,
}: {
  search: RefObject<HTMLInputElement | null>
  text: string
  onTextChange: (value: string) => void
  scope: "involving" | "all"
  onScopeChange: (value: "involving" | "all") => void
  failures: boolean
  onToggleFailures: () => void
  onRefresh: () => void
  refreshing: boolean
  online: boolean
}) {
  return (
    <header className="shrink-0 space-y-2 border-b p-3">
      <h1 className="flex items-center gap-2 px-1 text-sm font-semibold">
        <InboxIcon className="size-4" />
        PR inbox
      </h1>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          ref={search}
          aria-label="Filter inbox"
          placeholder="Filter PRs /"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
        />
        <select
          aria-label="Inbox scope"
          className="w-28 shrink-0 rounded-md border bg-background px-2 py-1.5 text-xs"
          value={scope}
          onChange={(event) => onScopeChange(event.target.value as "involving" | "all")}
        >
          <option value="involving">Involving me</option>
          <option value="all">All synced PRs</option>
        </select>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant={failures ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={failures}
          onClick={onToggleFailures}
        >
          Failures
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh inbox" onClick={onRefresh}>
          <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
        </Button>
        <Popover>
          <PopoverTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="About this inbox" />}
          >
            <InfoIcon />
          </PopoverTrigger>
          <PopoverContent align="end" className="max-w-64 text-sm text-muted-foreground">
            {!online && <p>Offline · showing cached PRs. </p>}Local inbox for PRs from synced
            groups. GitHub access and result limits apply. Snooze and settle are private to this
            app.
          </PopoverContent>
        </Popover>
        {!online && (
          <span role="status" className="ml-auto text-[10px] text-muted-foreground">
            Offline · cached
          </span>
        )}
      </div>
    </header>
  )
}
