import type { Fetch } from "../github/rest"

export interface Route {
  method?: string
  /** Matched against the path plus query string, for example `/user/orgs?per_page=100`. */
  path: string | RegExp
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** Answers `304` when the request carries this ETag. */
  etag?: string
}

export interface RecordedRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
}

/** In-memory GitHub API for tests. Routes are matched in order; later `set` calls win. */
export function fakeGitHub(initial: Route[] = []) {
  let routes = [...initial]
  const requests: RecordedRequest[] = []

  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname + url.search
    const method = init?.method ?? "GET"
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method, path, headers, body })
    const route = [...routes]
      .reverse()
      .find(
        (r) =>
          (r.method ?? "GET") === method &&
          (typeof r.path === "string" ? r.path === path : r.path.test(path)),
      )
    if (!route)
      return new Response(JSON.stringify({ message: `No route: ${method} ${path}` }), {
        status: 404,
      })
    const responseHeaders = new Headers(route.headers)
    if (route.etag) {
      responseHeaders.set("ETag", route.etag)
      if (headers["if-none-match"] === route.etag) {
        return new Response(null, { status: 304, headers: responseHeaders })
      }
    }
    const status = route.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(route.body ?? {}), {
      status,
      headers: responseHeaders,
    })
  }

  return {
    fetch,
    requests,
    set(route: Route) {
      routes.push(route)
    },
    reset(next: Route[]) {
      routes = [...next]
    },
    graphqlCalls: () => requests.filter((r) => r.path === "/graphql"),
  }
}
