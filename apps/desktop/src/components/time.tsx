import { Tooltip, TooltipContent, TooltipTrigger } from "@github-client/ui/components/tooltip"

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return "now"
}

export function RelativeTime({ iso }: { iso: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<time dateTime={iso} className="whitespace-nowrap" />}>
        {relativeTime(iso)}
      </TooltipTrigger>
      <TooltipContent>{new Date(iso).toLocaleString()}</TooltipContent>
    </Tooltip>
  )
}

/** `1m 12s` style duration between two timestamps. */
export function duration(start: string | null, end: string | null, now = Date.now()): string {
  if (!start) return ""
  const seconds = Math.max(
    0,
    Math.round(((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 1000),
  )
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
