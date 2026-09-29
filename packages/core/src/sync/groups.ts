import type { SyncedCollection } from "../collections/synced"
import type { Group, Repo } from "../domain/types"
import type { RestClient } from "../github/rest"

interface RestRepo {
  id?: number
  node_id?: string
  full_name: string
  name: string
  owner: { id?: number; node_id?: string; login: string; type?: "User" | "Organization" }
  private: boolean
  archived: boolean
  default_branch: string
  pushed_at: string | null
}

interface RestTeam {
  id?: number
  node_id?: string
  name: string
  slug: string
  organization: { id?: number; node_id?: string; login: string }
  parent?: { id?: number; node_id?: string; name: string; slug: string } | null
}

export const toRepo = (r: RestRepo): Repo => ({
  nodeId: r.node_id,
  databaseId: r.id,
  ownerNodeId: r.owner.node_id,
  ownerKind: r.owner.type === "Organization" ? "organization" : "user",
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
 * and each team the viewer belongs to.
 */
export async function syncGroups(
  rest: RestClient,
  groups: SyncedCollection<Group, string>,
  repos: SyncedCollection<Repo, string>,
): Promise<void> {
  const [orgResult, teamResult] = await Promise.all([
    rest.pollAll<{ id?: number; node_id?: string; login: string }>(
      "/user/orgs",
      {},
      { maxPages: 100 },
    ),
    rest.pollAll<RestTeam>("/user/teams", {}, { maxPages: 100 }),
  ])
  const orgs: Array<{ id?: number; node_id?: string; login: string }> =
    orgResult.status === "ok"
      ? orgResult.data
      : [...groups.collection.values()]
          .filter((group) => group.kind === "org")
          .map((group) => ({ login: group.org ?? group.name, node_id: group.orgNodeId }))
  const teams: RestTeam[] =
    teamResult.status === "ok"
      ? teamResult.data
      : [...groups.collection.values()]
          .filter((group) => group.kind === "team")
          .map((group) => ({
            name: group.name.slice((group.org?.length ?? 0) + 1),
            slug: group.id.slice(group.id.lastIndexOf("/") + 1),
            organization: { login: group.org ?? "" },
            node_id: group.teamNodeId,
            parent:
              group.parentSlug && group.parentName
                ? { slug: group.parentSlug, name: group.parentName }
                : null,
          }))

  // One inaccessible team (for example behind SAML SSO) must not stop the other groups.
  const teamRepos = await Promise.allSettled(
    teams.map((team) =>
      rest.pollAll<RestRepo>(`/orgs/${team.organization.login}/teams/${team.slug}/repos`, {}),
    ),
  )

  const next: Group[] = [{ id: "me", kind: "me", name: "Involving me", order: 0 }]
  ;[...orgs]
    .sort((a, b) => a.login.localeCompare(b.login))
    .forEach((org, i) => {
      next.push({
        id: `org:${org.login}`,
        kind: "org",
        name: org.login,
        org: org.login,
        orgNodeId: org.node_id,
        order: 100 + i,
      })
    })

  const knownRepos: Repo[] = []
  teams.forEach((team, i) => {
    const id = `team:${team.organization.login}/${team.slug}`
    const settled = teamRepos[i]!
    const result = settled.status === "fulfilled" ? settled.value : undefined
    const list = result?.status === "ok" ? result.data.map(toRepo) : undefined
    if (list) knownRepos.push(...list)
    next.push({
      id,
      kind: "team",
      name: `${team.organization.login}/${team.name}`,
      org: team.organization.login,
      orgNodeId: team.organization.node_id,
      teamNodeId: team.node_id,
      parentTeamNodeId: team.parent?.node_id ?? null,
      parentSlug: team.parent?.slug ?? null,
      parentName: team.parent?.name ?? null,
      order: 1000 + i,
      // An unchanged or unreadable list keeps the repos already stored for the group.
      repos: list?.map((r) => r.fullName) ?? groups.collection.get(id)?.repos ?? [],
    })
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
  if (group.kind === "starred") return []
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
