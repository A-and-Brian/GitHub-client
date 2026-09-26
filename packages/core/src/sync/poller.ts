import type { RateLimits } from "../github/rate-limit"

export interface PollJob {
  key: string
  /** Runs one sync pass. May resolve to the server's minimum poll interval in seconds. */
  run: () => Promise<unknown>
  /** Interval while at least one view watches the job. */
  activeMs: number
  /** Interval with no watchers. `Infinity` means the job only runs while watched. */
  idleMs: number
  /** Rate-limit resource the job spends, checked before each run. */
  resource?: "core" | "search" | "graphql"
}

export interface JobStatus {
  running: boolean
  lastSuccess?: number
  error?: unknown
}

interface Entry {
  job: PollJob
  registered: boolean
  watchers: number
  timer?: ReturnType<typeof setTimeout>
  inFlight?: Promise<void>
  serverMinMs: number
  failures: number
  status: JobStatus
}

const RATE_LIMIT_RESERVE = 5
const MAX_BACKOFF_MS = 5 * 60_000

/**
 * Schedules sync jobs. Watched jobs poll fast, background jobs poll slowly,
 * failures back off, and the server's `X-Poll-Interval` is a lower bound.
 */
export class Poller {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private stopped = false

  private readonly rateLimits: RateLimits

  constructor(rateLimits: RateLimits) {
    this.rateLimits = rateLimits
  }

  /** Keeps a job polling in the background for the lifetime of the poller. */
  register(job: PollJob): void {
    const entry = this.entry(job)
    if (entry.registered) return
    entry.registered = true
    if (entry.watchers === 0) this.schedule(entry, 0)
  }

  /** Stops background polling of a job. Watchers keep it alive until they release. */
  unregister(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.registered = false
    if (entry.watchers === 0) {
      clearTimeout(entry.timer)
      this.entries.delete(key)
    }
  }

  /** Polls a job at its active interval until the returned release is called. */
  watch(job: PollJob): () => void {
    const entry = this.entry(job)
    entry.watchers++
    const stale = Date.now() - (entry.status.lastSuccess ?? 0) >= job.activeMs
    this.schedule(entry, stale ? 0 : job.activeMs)
    let released = false
    return () => {
      if (released) return
      released = true
      entry.watchers--
      if (entry.watchers === 0 && !entry.registered) {
        clearTimeout(entry.timer)
        this.entries.delete(job.key)
      } else {
        this.schedule(entry, this.interval(entry))
      }
    }
  }

  /** Runs a job now (or joins the run in flight) and resolves when it finishes. */
  refresh(key: string): Promise<void> {
    const entry = this.entries.get(key)
    return entry ? this.run(entry) : Promise.resolve()
  }

  status(key: string): JobStatus | undefined {
    return this.entries.get(key)?.status
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stop(): void {
    this.stopped = true
    for (const entry of this.entries.values()) clearTimeout(entry.timer)
    this.entries.clear()
  }

  private entry(job: PollJob): Entry {
    let entry = this.entries.get(job.key)
    if (!entry) {
      entry = {
        job,
        registered: false,
        watchers: 0,
        serverMinMs: 0,
        failures: 0,
        status: { running: false },
      }
      this.entries.set(job.key, entry)
    } else {
      entry.job = job
    }
    return entry
  }

  private interval(entry: Entry): number {
    const base = entry.watchers > 0 ? entry.job.activeMs : entry.job.idleMs
    const backoff = entry.failures > 0 ? Math.min(MAX_BACKOFF_MS, base * 2 ** entry.failures) : base
    return Math.max(backoff, entry.serverMinMs)
  }

  private schedule(entry: Entry, delayMs: number): void {
    clearTimeout(entry.timer)
    const removed = this.entries.get(entry.job.key) !== entry
    if (this.stopped || removed || !Number.isFinite(delayMs)) return
    entry.timer = setTimeout(() => {
      void this.run(entry).then(() => this.schedule(entry, this.interval(entry)))
    }, delayMs)
  }

  private run(entry: Entry): Promise<void> {
    if (entry.inFlight) return entry.inFlight
    entry.inFlight = (async () => {
      const wait = entry.job.resource
        ? this.rateLimits.waitMs(entry.job.resource, RATE_LIMIT_RESERVE)
        : 0
      if (wait > 0) {
        entry.serverMinMs = wait
        return
      }
      this.setStatus(entry, { ...entry.status, running: true })
      try {
        const serverMinSec = await entry.job.run()
        entry.serverMinMs = typeof serverMinSec === "number" ? serverMinSec * 1000 : 0
        entry.failures = 0
        this.setStatus(entry, { running: false, lastSuccess: Date.now() })
      } catch (error) {
        entry.failures++
        this.setStatus(entry, { ...entry.status, running: false, error })
      }
    })().finally(() => {
      entry.inFlight = undefined
    })
    return entry.inFlight
  }

  private setStatus(entry: Entry, status: JobStatus): void {
    entry.status = status
    for (const listener of this.listeners) listener()
  }
}
