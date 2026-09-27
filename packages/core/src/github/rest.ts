import { RateLimits } from "./rate-limit"

export const DEFAULT_API_URL = "https://api.github.com"

export type Fetch = typeof globalThis.fetch

export class GitHubError extends Error {
  readonly status: number
  readonly body: unknown
  readonly rateLimited: boolean
  readonly retryAfterMs: number

  constructor(
    status: number,
    message: string,
    body?: unknown,
    rateLimited = false,
    retryAfterMs = 0,
  ) {
    super(message)
    this.name = "GitHubError"
    this.status = status
    this.body = body
    this.rateLimited = rateLimited
    this.retryAfterMs = retryAfterMs
  }
}

export type GetResult<T> =
  | { status: "ok"; data: T; pollIntervalSec?: number }
  | { status: "not-modified"; pollIntervalSec?: number }

export interface RestClientOptions {
  fetch: Fetch
  getToken: () => string | null
  apiUrl?: string
}

type Query = Record<string, string | number | boolean | undefined>

/**
 * Thin GitHub REST client.
 *
 * `poll` sends conditional requests: it remembers the ETag of each URL for the
 * lifetime of the client, and a `304` does not count against the rate limit.
 * ETags are kept in memory on purpose. After a restart the first poll is a full
 * request, so persisted collections can never be stuck behind a stale ETag.
 */
export class RestClient {
  readonly rateLimits = new RateLimits()
  private readonly etags = new Map<string, string>()
  private readonly options: RestClientOptions
  private readonly apiUrl: string

  constructor(options: RestClientOptions) {
    this.options = options
    this.apiUrl = options.apiUrl ?? DEFAULT_API_URL
  }

  url(path: string, query?: Query): string {
    const url = new URL(path.startsWith("http") ? path : `${this.apiUrl}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  /** Conditional GET. Returns `not-modified` when the resource is unchanged. */
  async poll<T>(path: string, query?: Query): Promise<GetResult<T>> {
    const url = this.url(path, query)
    const etag = this.etags.get(url)
    const response = await this.send("GET", url, undefined, etag ? { "If-None-Match": etag } : {})
    const pollIntervalSec = numberHeader(response, "X-Poll-Interval")
    if (response.status === 304) return { status: "not-modified", pollIntervalSec }
    const data = (await response.json()) as T
    const nextEtag = response.headers.get("ETag")
    if (nextEtag) this.etags.set(url, nextEtag)
    return { status: "ok", data, pollIntervalSec }
  }

  /**
   * GET over all pages (`Link: rel="next"`). Only the first page can be
   * conditional, so an unchanged first page proves an unchanged list only when
   * the list fits on one page, or when it is sorted newest first (`recencySorted`).
   */
  async pollAll<T>(
    path: string,
    query?: Query,
    options: { maxPages?: number; pick?: (page: unknown) => T[]; recencySorted?: boolean } = {},
  ): Promise<GetResult<T[]>> {
    const pick = options.pick ?? ((page) => page as T[])
    const first = this.url(path, { per_page: 100, ...query })
    const etag = this.etags.get(first)
    let response = await this.send("GET", first, undefined, etag ? { "If-None-Match": etag } : {})
    const pollIntervalSec = numberHeader(response, "X-Poll-Interval")
    if (response.status === 304) return { status: "not-modified", pollIntervalSec }
    const firstEtag = response.headers.get("ETag")
    const firstResponse = response
    const items: T[] = pick(await response.json())
    let next = nextLink(response)
    for (let page = 1; next && page < (options.maxPages ?? 30); page++) {
      response = await this.send("GET", next)
      items.push(...pick(await response.json()))
      next = nextLink(response)
    }
    const singlePage = !nextLink(firstResponse)
    if (firstEtag && (singlePage || options.recencySorted)) this.etags.set(first, firstEtag)
    else this.etags.delete(first)
    return { status: "ok", data: items, pollIntervalSec }
  }

  async get<T>(
    path: string,
    query?: Query,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.send("GET", this.url(path, query), undefined, headers, signal)
    return (await response.json()) as T
  }

  async getText(path: string, headers: Record<string, string> = {}): Promise<string> {
    const response = await this.send("GET", this.url(path), undefined, headers)
    return response.text()
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, this.url(path), body)
    if (response.status === 204 || response.headers.get("Content-Length") === "0") {
      return undefined as T
    }
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  async send(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const token = this.options.getToken()
    const response = await this.options.fetch(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
    this.rateLimits.update(response.headers)
    if (response.status === 304 || response.ok) return response
    throw await toError(response)
  }
}

async function toError(response: Response): Promise<GitHubError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const message =
    (body as { message?: string } | undefined)?.message ??
    `GitHub request failed: ${response.status}`
  const retryAfterMs = retryAfter(response.headers.get("Retry-After"))
  const rateLimited =
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("X-RateLimit-Remaining") === "0" ||
        response.headers.has("Retry-After") ||
        /secondary rate limit|abuse detection/i.test(message)))
  return new GitHubError(response.status, message, body, rateLimited, retryAfterMs)
}

function retryAfter(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

function numberHeader(response: Response, name: string): number | undefined {
  const value = response.headers.get(name)
  return value ? Number(value) : undefined
}

function nextLink(response: Response): string | undefined {
  const link = response.headers.get("Link")
  return link?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
}
