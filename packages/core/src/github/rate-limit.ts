export interface RateLimit {
  limit: number
  remaining: number
  /** Unix time in seconds when the window resets. */
  reset: number
}

type Listener = () => void

/** Latest rate-limit state per GitHub resource (`core`, `search`, `graphql`, ...). */
export class RateLimits {
  private readonly byResource = new Map<string, RateLimit>()
  private readonly listeners = new Set<Listener>()

  update(headers: Headers): void {
    const resource = headers.get("X-RateLimit-Resource")
    const remaining = headers.get("X-RateLimit-Remaining")
    if (!resource || remaining === null) return
    this.byResource.set(resource, {
      limit: Number(headers.get("X-RateLimit-Limit")),
      remaining: Number(remaining),
      reset: Number(headers.get("X-RateLimit-Reset")),
    })
    for (const listener of this.listeners) listener()
  }

  get(resource: string): RateLimit | undefined {
    return this.byResource.get(resource)
  }

  /** Milliseconds to wait before using `resource` again, keeping `reserve` calls in hand. */
  waitMs(resource: string, reserve: number, now = Date.now()): number {
    const limit = this.byResource.get(resource)
    if (!limit || limit.remaining > reserve) return 0
    return Math.max(0, limit.reset * 1000 - now)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
