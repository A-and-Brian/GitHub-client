import { cn } from "@github-client/ui/lib/utils"
import type { MouseEvent } from "react"
import { openExternal } from "@/platform"

/**
 * Renders HTML that GitHub already rendered and sanitized (`bodyHTML`).
 * Links open in the system browser.
 */
export function GitHubHtml({ html, className }: { html: string; className?: string }) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest("a")
    if (!link?.href) return
    event.preventDefault()
    void openExternal(link.href)
  }
  if (!html.trim())
    return <p className="text-sm italic text-muted-foreground">No description provided.</p>
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: delegates clicks on links, which stay keyboard reachable
    // biome-ignore lint/a11y/noStaticElementInteractions: same delegation
    <div
      className={cn("gh-markdown", className)}
      onClick={onClick}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub sanitizes bodyHTML server-side
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
