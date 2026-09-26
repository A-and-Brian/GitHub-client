import type { SyncedCollection } from "../collections/synced"
import type { Group, Repo } from "../domain/types"
import type { RestClient } from "../github/rest"

interface RestRepo {
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  archived: boolean
  default_branch: string
  pushed_at: string | null
}

interface RestTeam {
  name: string
  slug: string
  organization: { login: string }
}

export const toRepo = (r: RestRepo): Repo => ({
  fullName: r.full_name,
  owner: r.owner.login,
  name: r.name,
  private: r.private,
  archived: r.archived,
  defaultBranch: r.default_branch,
  pushedAt: r.pushed_at,
})

/**
 * Builds the automatic groups: everything involving the viewer, each org,
 * each team the viewer belongs to, and starred repos.
 */
export async function syncGroups(
  rest: RestClient,
  groups: SyncedCollection<Group, string>,
  repos: SyncedCollection<Repo, string>,
): Promise<void> {
  const [orgs, teams, starred] = await Promise.all([
    rest.get<Array<{ login: string }>>("/user/orgs", { per_page: 100 }),
    rest.get<RestTeam[]>("/user/teams", { per_page: 100 }),
    rest.pollAll<RestRepo>("/user/starred", {}, { maxPages: 10 }),
  ])

  const teamRepos = await Promise.all(
    teams.map((team) =>
      rest.pollAll<RestRepo>(`/orgs/${team.organization.login}/teams/${team.slug}/repos`, {}),
    ),
  )

  const next: Group[] = [{ id: "me", kind: "me", name: "Involving me", order: 0 }]
  orgs
    .map((org) => org.login)
    .sort((a, b) => a.localeCompare(b))
    .forEach((org, i) => {
      next.push({ id: `org:${org}`, kind: "org", name: org, org, order: 100 + i })
    })

  const knownRepos: Repo[] = []
  teams.forEach((team, i) => {
    const id = `team:${team.organization.login}/${team.slug}`
    const result = teamRepos[i]!
    const list = result.status === "ok" ? result.data.map(toRepo) : undefined
    if (list) knownRepos.push(...list)
    next.push({
      id,
      kind: "team",
      name: `${team.organization.login}/${team.name}`,
      org: team.organization.login,
      order: 1000 + i,
      // An unchanged list keeps the repos already stored for the group.
      repos: list?.map((r) => r.fullName) ?? groups.collection.get(id)?.repos ?? [],
    })
  })

  const starredRepos = starred.status === "ok" ? starred.data.map(toRepo) : undefined
  if (starredRepos) knownRepos.push(...starredRepos)
  next.push({
    id: "starred",
    kind: "starred",
    name: "Starred",
    order: 10_000,
    repos: starredRepos?.map((r) => r.fullName) ?? groups.collection.get("starred")?.repos ?? [],
  })

  await repos.upsert(dedupe(knownRepos))
  await groups.replace(next, () => true)
}

function dedupe(list: Repo[]): Repo[] {
  return [...new Map(list.map((r) => [r.fullName, r])).values()]
}

const MAX_QUERY_LENGTH = 240

/**
 * GitHub search queries that together cover a group. Search queries are
 * limited to 256 characters, so repo lists are split into several queries.
 */
export function groupSearchQueries(group: Group): string[] {
  const base = "is:pr is:open archived:false"
  if (group.kind === "me") return [`${base} involves:@me`]
  if (group.kind === "org") return [`${base} org:${group.org}`]
  const queries: string[] = []
  let current = base
  for (const repo of group.repos ?? []) {
    const term = ` repo:${repo}`
    if (current.length + term.length > MAX_QUERY_LENGTH && current !== base) {
      queries.push(current)
      current = base
    }
    current += term
  }
  if (current !== base) queries.push(current)
  return queries
}
