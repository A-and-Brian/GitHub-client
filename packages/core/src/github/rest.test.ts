import { describe, expect, test } from "vitest"
import { fakeGitHub } from "../test/fake-github"
import { GitHubError, RestClient } from "./rest"

const client = (fetch: typeof globalThis.fetch) =>
  new RestClient({ fetch, getToken: () => "t0ken" })

describe("RestClient", () => {
  test("poll sends the stored ETag and reports unchanged resources", async () => {
    const gh = fakeGitHub([{ path: "/user/orgs", body: [{ login: "acme" }], etag: '"v1"' }])
    const rest = client(gh.fetch)

    expect(await rest.poll("/user/orgs")).toEqual({ status: "ok", data: [{ login: "acme" }] })
    expect(await rest.poll("/user/orgs")).toEqual({ status: "not-modified" })
    expect(gh.requests[1]!.headers["if-none-match"]).toBe('"v1"')
    expect(gh.requests[0]!.headers.authorization).toBe("Bearer t0ken")
  })

  test("pollAll follows Link headers and returns every page", async () => {
    const gh = fakeGitHub([
      {
        path: "/user/starred?per_page=100",
        body: [1, 2],
        etag: '"p1"',
        headers: { Link: '<https://api.github.com/user/starred?per_page=100&page=2>; rel="next"' },
      },
      { path: "/user/starred?per_page=100&page=2", body: [3] },
    ])
    const rest = client(gh.fetch)

    expect(await rest.pollAll<number>("/user/starred")).toEqual({ status: "ok", data: [1, 2, 3] })
    expect(await rest.pollAll<number>("/user/starred")).toEqual({ status: "not-modified" })
  })

  test("exposes the server poll interval", async () => {
    const gh = fakeGitHub([
      { path: "/notifications", body: [], headers: { "X-Poll-Interval": "60" } },
    ])
    const result = await client(gh.fetch).poll("/notifications")
    expect(result.pollIntervalSec).toBe(60)
  })

  test("tracks rate limits per resource", async () => {
    const gh = fakeGitHub([
      {
        path: "/user",
        body: {},
        headers: {
          "X-RateLimit-Resource": "core",
          "X-RateLimit-Limit": "5000",
          "X-RateLimit-Remaining": "3",
          "X-RateLimit-Reset": "2000",
        },
      },
    ])
    const rest = client(gh.fetch)
    await rest.get("/user")
    expect(rest.rateLimits.get("core")).toEqual({ limit: 5000, remaining: 3, reset: 2000 })
    expect(rest.rateLimits.waitMs("core", 5, 1_000_000)).toBe(1_000_000)
    expect(rest.rateLimits.waitMs("search", 5)).toBe(0)
  })

  test("throws GitHubError with the API message", async () => {
    const gh = fakeGitHub([{ path: "/repos/a/b", status: 404, body: { message: "Not Found" } }])
    const error = await client(gh.fetch)
      .get("/repos/a/b")
      .catch((e) => e)
    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({ status: 404, message: "Not Found" })
  })
})
