import { expect, test } from "vitest"
import { createCollections } from "../collections"
import { RestClient } from "../github/rest"
import { fakeGitHub } from "../test/fake-github"
import { groupSearchQueries, syncGroups } from "./groups"

const repo = (fullName: string) => {
  const [owner, name] = fullName.split("/")
  return {
    full_name: fullName,
    name,
    owner: { login: owner },
    private: false,
    archived: false,
    default_branch: "main",
    pushed_at: null,
  }
}

test("builds me, org, team, and starred groups", async () => {
  const gh = fakeGitHub([
    { path: "/user/orgs?per_page=100", body: [{ login: "zeta" }, { login: "acme" }] },
    {
      path: "/user/teams?per_page=100",
      body: [
        {
          name: "Core",
          slug: "core",
          organization: { login: "acme" },
          parent: { name: "Engineering", slug: "engineering" },
        },
      ],
    },
    { path: "/user/starred?per_page=100", body: [repo("oss/lib")] },
    {
      path: "/orgs/acme/teams/core/repos?per_page=100",
      body: [repo("acme/api"), repo("acme/web")],
    },
  ])
  const collections = createCollections()
  await syncGroups(
    new RestClient({ fetch: gh.fetch, getToken: () => "t" }),
    collections.groups,
    collections.repos,
  )

  const groups = [...collections.groups.collection.values()].sort((a, b) => a.order - b.order)
  expect(groups.map((g) => g.id)).toEqual([
    "me",
    "org:acme",
    "org:zeta",
    "team:acme/core",
    "starred",
  ])
  expect(collections.groups.collection.get("team:acme/core")?.repos).toEqual([
    "acme/api",
    "acme/web",
  ])
  expect(collections.groups.collection.get("team:acme/core")).toMatchObject({
    parentSlug: "engineering",
    parentName: "Engineering",
  })
  expect(collections.repos.collection.has("oss/lib")).toBe(true)
})

test("discovers organizations and teams across REST pages without conflating same-named teams", async () => {
  const orgPage2 = "https://api.github.com/user/orgs?per_page=100&page=2"
  const teamPage2 = "https://api.github.com/user/teams?per_page=100&page=2"
  const gh = fakeGitHub([
    {
      path: "/user/orgs?per_page=100",
      body: [{ login: "acme" }],
      headers: { Link: `<${orgPage2}>; rel="next"` },
    },
    { path: "/user/orgs?per_page=100&page=2", body: [{ login: "other" }] },
    {
      path: "/user/teams?per_page=100",
      body: [{ name: "Core", slug: "core", organization: { login: "acme" } }],
      headers: { Link: `<${teamPage2}>; rel="next"` },
    },
    {
      path: "/user/teams?per_page=100&page=2",
      body: [{ name: "Core", slug: "core", organization: { login: "other" } }],
    },
    { path: "/user/starred?per_page=100", body: [] },
    { path: "/orgs/acme/teams/core/repos?per_page=100", body: [] },
    { path: "/orgs/other/teams/core/repos?per_page=100", body: [] },
  ])
  const collections = createCollections()
  await syncGroups(
    new RestClient({ fetch: gh.fetch, getToken: () => "t" }),
    collections.groups,
    collections.repos,
  )
  expect(collections.groups.collection.has("org:other")).toBe(true)
  expect(collections.groups.collection.has("team:acme/core")).toBe(true)
  expect(collections.groups.collection.has("team:other/core")).toBe(true)
  expect(gh.requests.map((request) => request.path)).toContain("/user/teams?per_page=100&page=2")
})

test("search queries stay under GitHub's length limit", () => {
  const repos = Array.from({ length: 40 }, (_, i) => `some-org/repository-number-${i}`)
  const queries = groupSearchQueries({ id: "starred", kind: "starred", name: "", order: 0, repos })
  expect(queries.length).toBeGreaterThan(1)
  for (const q of queries) expect(q.length).toBeLessThanOrEqual(240)
  const covered = queries.flatMap((q) => q.match(/repo:\S+/g) ?? [])
  expect(covered).toHaveLength(40)
})

test("empty repo lists produce no queries", () => {
  expect(
    groupSearchQueries({ id: "starred", kind: "starred", name: "", order: 0, repos: [] }),
  ).toEqual([])
})
