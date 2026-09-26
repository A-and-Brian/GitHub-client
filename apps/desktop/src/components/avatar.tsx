import { cn } from "@github-client/ui/lib/utils"

export function UserAvatar({
  src,
  login,
  className,
}: {
  src?: string | null
  login?: string | null
  className?: string
}) {
  return src ? (
    <img
      src={`${src}${src.includes("?") ? "&" : "?"}s=48`}
      alt={login ?? ""}
      className={cn("size-5 shrink-0 rounded-full", className)}
    />
  ) : (
    <span className={cn("size-5 shrink-0 rounded-full bg-muted", className)} />
  )
}
