import type {
  CanonicalActor,
  CanonicalCheck,
  CanonicalCommit,
  CanonicalGroup,
  CanonicalLabel,
  CanonicalPullFile,
  CanonicalPullRequest,
  CanonicalRepository,
  CanonicalReviewComment,
  CanonicalReviewThread,
  CanonicalTeam,
  CanonicalTimelineItem,
  Check,
  CheckState,
  Group,
  GroupPull,
  GroupRepository,
  Label,
  PullCheck,
  PullDetailObservation,
  PullFileObservation,
  PullLabel,
  PullRequest,
  PullRequestDetail,
  PullRequestFiles,
  PullReviewRequest,
  Repo,
  ReviewDecision,
  ReviewThread,
  TimelineItem,
} from "../domain/types"
import { prKey } from "../domain/types"
import type { RunRow, WorkflowRow } from "./actions"
import {
  ensureActor,
  ensureRepository,
  findRepository,
  readActor,
  readRepository,
} from "./identities"
import type { NormalizedDatabase } from "./normalized"
import type { SyncedCollection } from "./synced"

export interface CanonicalPullInput {
  source?: "list" | "detail" | "resource"
  observedAt?: string
  nodeId?: string
  repositoryId: string
  number: number
  title?: string
  url?: string
  author?: { id?: string; login: string; avatarUrl?: string } | null
  isDraft?: boolean
  createdAt?: string
  updatedAt?: string
  state?: "OPEN" | "CLOSED" | "MERGED"
  stateObservedAt?: string
  checkSnapshotComplete?: boolean
  headOid?: string
  headRef?: string
  baseRef?: string
  reviewDecision?: ReviewDecision
  checkState?: CheckState
  comments?: number
  additions?: number
  deletions?: number
  labels?: Label[]
  labelsComplete?: boolean
  reviewRequestsComplete?: boolean
  reviewRequests?: string[]
  reviewRequestTargets?: PullRequest["reviewRequestTargets"]
}

export interface PullCollections {
  groups: SyncedCollection<Group, string>
  repos: SyncedCollection<Repo, string>
  pulls: SyncedCollection<PullRequest, string>
  pullDetails: SyncedCollection<PullRequestDetail, string>
  pullFiles: SyncedCollection<PullRequestFiles, string>
  ingestPullRequest: (input: CanonicalPullInput) => Promise<string>
  readPullSummary: (pullId: string) => ReturnType<typeof readPullSummary>
  canonical: {
    groups: SyncedCollection<CanonicalGroup, string>
    groupRepositories: SyncedCollection<GroupRepository, string>
    repositories: SyncedCollection<CanonicalRepository, string>
    actors: SyncedCollection<CanonicalActor, string>
    teams: SyncedCollection<CanonicalTeam, string>
    pullRequests: SyncedCollection<CanonicalPullRequest, string>
    groupPulls: SyncedCollection<GroupPull, string>
    labels: SyncedCollection<CanonicalLabel, string>
    pullLabels: SyncedCollection<PullLabel, string>
    pullReviewRequests: SyncedCollection<PullReviewRequest, string>
    detailObservations: SyncedCollection<PullDetailObservation, string>
    timelineItems: SyncedCollection<CanonicalTimelineItem, string>
    reviewThreads: SyncedCollection<CanonicalReviewThread, string>
    reviewComments: SyncedCollection<CanonicalReviewComment, string>
    checks: SyncedCollection<CanonicalCheck, string>
    pullChecks: SyncedCollection<PullCheck, string>
    commits: SyncedCollection<CanonicalCommit, string>
    fileObservations: SyncedCollection<PullFileObservation, string>
    files: SyncedCollection<CanonicalPullFile, string>
  }
}

/** Registers canonical tables first, then exposes the existing view DTOs as transient projections. */
export function createPullCollections(db: NormalizedDatabase): PullCollections {
  const canonical = {
    groups: db.table<CanonicalGroup>("groups"),
    groupRepositories: db.table<GroupRepository>("groupRepositories"),
    repositories: db.table<CanonicalRepository>("repositories"),
    actors: db.table<CanonicalActor>("actors"),
    teams: db.table<CanonicalTeam>("teams"),
    pullRequests: db.table<CanonicalPullRequest>("pullRequests"),
    groupPulls: db.table<GroupPull>("groupPulls"),
    labels: db.table<CanonicalLabel>("labels"),
    pullLabels: db.table<PullLabel>("pullLabels"),
    pullReviewRequests: db.table<PullReviewRequest>("pullReviewRequests"),
    detailObservations: db.table<PullDetailObservation>("pullDetailObservations"),
    timelineItems: db.table<CanonicalTimelineItem>("timelineItems"),
    reviewThreads: db.table<CanonicalReviewThread>("reviewThreads"),
    reviewComments: db.table<CanonicalReviewComment>("reviewComments"),
    checks: db.table<CanonicalCheck>("checks"),
    pullChecks: db.table<PullCheck>("pullChecks"),
    commits: db.table<CanonicalCommit>("commits"),
    fileObservations: db.table<PullFileObservation>("pullFileObservations"),
    files: db.table<CanonicalPullFile>("pullFiles"),
  }
  db.table<WorkflowRow>("workflows")
  db.table<RunRow>("workflowRuns")

  const groups = db.projection<Group, string>(
    "groups",
    (row) => row.id,
    () => readGroups(db),
    async (rows) => writeGroups(db, rows),
    async (ids) => removeGroups(db, ids),
  )
  const repos = db.projection<Repo, string>(
    "repos",
    (row) => row.fullName,
    () => db.rows(canonical.repositories).map((row) => toRepo(db, row)),
    async (rows) => {
      for (const row of rows) {
        const ownerId = await ensureActor(db, {
          id: row.ownerNodeId,
          databaseId: row.ownerDatabaseId,
          login: row.owner,
          kind: row.ownerKind,
        })
        await ensureRepository(db, {
          ...row,
          id: row.nodeId,
          databaseId: row.databaseId,
          ownerLogin: row.owner,
          ownerId,
          ownerKind: row.ownerKind,
        })
      }
    },
    async (routes) => {
      for (const route of routes) {
        const repository = findRepository(db, route)
        if (repository) await canonical.repositories.remove([repository.key])
      }
    },
  )
  const pulls = db.projection<PullRequest, string>(
    "pulls",
    (row) => row.key,
    () => readPulls(db),
    async (rows) => {
      for (const row of rows) await writePullProjection(db, row)
    },
    async (keys) => removeGroupPulls(db, keys),
  )
  const pullDetails = db.projection<PullRequestDetail, string>(
    "pullDetails",
    (row) => row.key,
    () => readDetails(db),
    async (rows) => {
      for (const row of rows) await writeDetail(db, row)
    },
    async (keys) => removeDetails(db, keys),
  )
  const pullFiles = db.projection<PullRequestFiles, string>(
    "pullFiles",
    (row) => row.key,
    () => readFiles(db),
    async (rows) => {
      for (const row of rows) await writeFiles(db, row)
    },
    async (keys) => removeFileObservations(db, keys),
  )
  return {
    groups,
    repos,
    pulls,
    pullDetails,
    pullFiles,
    ingestPullRequest: (input) => ingestPullRequest(db, input),
    readPullSummary: (pullId) => readPullSummary(db, pullId),
    canonical,
  }
}

export interface PullIdentityInput {
  nodeId?: string
  repo?: string
  number?: number
}

export function findPull(
  db: NormalizedDatabase,
  idOrNodeId: string,
): CanonicalPullRequest | undefined {
  const table = db.table<CanonicalPullRequest>("pullRequests")
  const direct = table.collection.get(idOrNodeId)
  if (direct?.scope === db.scope) return direct
  return db.rows(table).find((row) => row.nodeId === idOrNodeId)
}

export function findPullByRoute(
  db: NormalizedDatabase,
  repo: string,
  number: number,
): CanonicalPullRequest | undefined {
  const repository = findRepository(db, repo)
  return repository
    ? db
        .rows(db.table<CanonicalPullRequest>("pullRequests"))
        .find((row) => row.repositoryId === repository.key && row.number === number)
    : undefined
}

/** Resolves a local preference or draft reference, creating a sparse parent when needed. */
export async function ensurePullIdentity(
  db: NormalizedDatabase,
  input: PullIdentityInput,
): Promise<string> {
  const table = db.table<CanonicalPullRequest>("pullRequests")
  const rows = db.rows(table)
  const repository = input.repo ? findRepository(db, input.repo) : undefined
  const existing =
    (input.nodeId && rows.find((row) => row.nodeId === input.nodeId)) ??
    (repository && input.number !== undefined
      ? rows.find(
          (row) =>
            row.repositoryId === repository.key &&
            row.number === input.number &&
            (!input.nodeId || !row.nodeId || row.nodeId === input.nodeId),
        )
      : undefined)
  if (existing) return existing.key
  const key = db.key(
    "pull",
    input.nodeId ?? (repository && input.number !== undefined ? repository.key : "unknown"),
    input.number ?? "unknown",
  )
  await table.upsert([
    {
      key,
      scope: db.scope,
      id: key,
      nodeId: input.nodeId,
      repositoryId: repository?.key,
      number: input.number ?? 0,
    },
  ])
  return key
}

export async function ingestPullRequest(
  db: NormalizedDatabase,
  input: CanonicalPullInput,
): Promise<string> {
  const id = await ensurePullIdentity(db, {
    nodeId: input.nodeId,
    number: input.number,
    repo: readRepository(db, input.repositoryId)?.fullName,
  })
  const table = db.table<CanonicalPullRequest>("pullRequests")
  const previous = findPull(db, id)!
  const {
    source: _source,
    observedAt: _observedAt,
    author: _author,
    labels: _labels,
    labelsComplete: _labelsComplete,
    reviewRequests: _reviewRequests,
    reviewRequestTargets: _reviewRequestTargets,
    reviewRequestsComplete: _reviewRequestsComplete,
    ...scalarInput
  } = input
  const stale =
    input.observedAt !== undefined &&
    previous.scalarObservedAt !== undefined &&
    input.observedAt < previous.scalarObservedAt
  const authorId = stale
    ? previous.authorId
    : input.author === null
      ? null
      : input.author
        ? await ensureActor(db, {
            id: input.author.id,
            login: input.author.login,
            avatarUrl: input.author.avatarUrl,
          })
        : previous.authorId
  const merged: CanonicalPullRequest = {
    ...previous,
    ...defined(
      stale ? { repositoryId: scalarInput.repositoryId, number: scalarInput.number } : scalarInput,
    ),
    key: id,
    scope: db.scope,
    id,
    nodeId: input.nodeId ?? previous.nodeId,
    repositoryId: input.repositoryId || previous.repositoryId,
    number: input.number,
    authorId,
    labelsComplete: stale
      ? previous.labelsComplete
      : (input.labelsComplete ?? previous.labelsComplete),
    reviewRequestsComplete: stale
      ? previous.reviewRequestsComplete
      : (input.reviewRequestsComplete ?? previous.reviewRequestsComplete),
  }
  if (input.state !== undefined) {
    const observedAt = input.stateObservedAt ?? input.observedAt ?? new Date().toISOString()
    const older = previous.stateObservedAt !== undefined && observedAt < previous.stateObservedAt
    if (older || (previous.state === "MERGED" && input.state !== "MERGED")) {
      merged.state = previous.state
      merged.stateObservedAt = previous.stateObservedAt
    } else {
      merged.state = input.state
      merged.stateObservedAt = observedAt
    }
  }
  if (!stale && input.observedAt !== undefined) {
    if (input.source === "detail") merged.detailObservedAt = input.observedAt
    else merged.listObservedAt = input.observedAt
    merged.scalarObservedAt = input.observedAt
  }
  await table.upsert([merged])
  if (!stale && input.labels !== undefined && input.labelsComplete !== false) {
    await writeLabels(db, id, input.repositoryId, input.labels)
  }
  if (
    !stale &&
    input.reviewRequestsComplete !== false &&
    (input.reviewRequestTargets !== undefined || input.reviewRequests !== undefined)
  ) {
    const targets = input.reviewRequestTargets ?? (input.reviewRequests ?? []).map(parseTarget)
    await writeReviewRequests(db, id, targets)
  }
  return id
}

export function readPullSummary(
  db: NormalizedDatabase,
  pullId: string,
):
  | {
      node_id?: string
      number: number
      title: string
      draft: boolean
      user?: { login: string }
      html_url?: string
      created_at?: string
      updated_at?: string
      head?: { ref?: string; sha?: string }
      base?: { ref?: string }
      requested_reviewers?: { login: string }[]
      requested_teams?: { slug: string }[]
      labels?: Array<{ id?: string; name: string; color: string }>
      reviewRequestTargets?: PullRequest["reviewRequestTargets"]
    }
  | undefined {
  const pull = findPull(db, pullId)
  if (!pull?.title) return undefined
  const author = pull.authorId ? readActor(db, pull.authorId) : undefined
  const labels = db
    .rows(db.table<PullLabel>("pullLabels"))
    .filter((row) => row.pullId === pull.key)
    .sort((a, b) => a.order - b.order)
    .flatMap((relation) => {
      const label = db.table<CanonicalLabel>("labels").collection.get(relation.labelId)
      return label ? [{ id: label.nodeId, name: label.name, color: label.color }] : []
    })
  const reviewers: Array<{ kind: "user" | "team"; login: string }> = db
    .rows(db.table<PullReviewRequest>("pullReviewRequests"))
    .filter((row) => row.pullId === pull.key)
    .sort((a, b) => a.order - b.order)
    .flatMap<{ kind: "user" | "team"; login: string }>((row) => {
      if (row.targetKind === "user") {
        const actor = readActor(db, row.targetId)
        return actor ? [{ kind: "user", login: actor.login }] : []
      }
      const team = db
        .rows(db.table<CanonicalTeam>("teams"))
        .find((item) => item.key === row.targetId)
      const org = team ? readActor(db, team.organizationId) : undefined
      return team && org ? [{ kind: "team", login: `${org.login}/${team.slug}` }] : []
    })
  return {
    ...(pull.nodeId ? { node_id: pull.nodeId } : {}),
    number: pull.number,
    title: pull.title,
    draft: pull.isDraft ?? false,
    ...(author ? { user: { login: author.login } } : {}),
    ...(pull.url ? { html_url: pull.url } : {}),
    ...(pull.createdAt ? { created_at: pull.createdAt } : {}),
    ...(pull.updatedAt ? { updated_at: pull.updatedAt } : {}),
    head: {
      ...(pull.headRef ? { ref: pull.headRef } : {}),
      ...(pull.headOid ? { sha: pull.headOid } : {}),
    },
    base: pull.baseRef ? { ref: pull.baseRef } : {},
    requested_reviewers: reviewers
      .filter((target) => target.kind === "user")
      .map((target) => ({ login: target.login })),
    requested_teams: reviewers
      .filter((target) => target.kind === "team")
      .map((target) => ({ slug: target.login })),
    reviewRequestTargets: readReviewRequestTargets(db, pull.key),
    labels,
  }
}

function readReviewRequestTargets(
  db: NormalizedDatabase,
  pullId: string,
): NonNullable<PullRequest["reviewRequestTargets"]> {
  return db
    .rows(db.table<PullReviewRequest>("pullReviewRequests"))
    .filter((row) => row.pullId === pullId)
    .sort((a, b) => a.order - b.order)
    .flatMap<NonNullable<PullRequest["reviewRequestTargets"]>[number]>((row) => {
      if (row.targetKind === "user") {
        const actor = readActor(db, row.targetId)
        return actor ? [{ kind: "user" as const, login: actor.login, nodeId: actor.nodeId }] : []
      }
      const team = db.table<CanonicalTeam>("teams").collection.get(row.targetId)
      const organization = team ? readActor(db, team.organizationId) : undefined
      return team && organization
        ? [
            {
              kind: "team" as const,
              login: `${organization.login}/${team.slug}`,
              nodeId: team.nodeId,
            },
          ]
        : []
    })
}

function parseTarget(login: string): NonNullable<PullRequest["reviewRequestTargets"]>[number] {
  return login.includes("/") ? { kind: "team", login } : { kind: "user", login }
}

async function writeReviewRequests(
  db: NormalizedDatabase,
  pullId: string,
  targets: NonNullable<PullRequest["reviewRequestTargets"]>,
): Promise<void> {
  const relationTable = db.table<PullReviewRequest>("pullReviewRequests")
  const teamTable = db.table<CanonicalTeam>("teams")
  const next: PullReviewRequest[] = []
  for (const [order, target] of targets.entries()) {
    let targetId: string
    if (target.kind === "user") {
      targetId = await ensureActor(db, { id: target.nodeId, login: target.login })
    } else {
      const [orgLogin, slug] = target.login.split("/")
      const organizationId = await ensureActor(db, { login: orgLogin!, kind: "organization" })
      const existing = db
        .rows(teamTable)
        .find(
          (team) =>
            team.organizationId === organizationId &&
            team.slug.toLowerCase() === slug?.toLowerCase(),
        )
      targetId = existing?.key ?? db.key("team", organizationId, slug?.toLowerCase() ?? "")
      if (!existing) {
        await teamTable.upsert([
          {
            key: targetId,
            scope: db.scope,
            id: targetId,
            organizationId,
            name: slug ?? "",
            slug: slug ?? "",
            parentTeamId: null,
          },
        ])
      }
    }
    const key = db.key("pull-review-request", pullId, target.kind, targetId)
    next.push({ key, scope: db.scope, pullId, targetKind: target.kind, targetId, order })
  }
  await relationTable.replace(next, (row) => row.pullId === pullId)
}

async function writeLabels(
  db: NormalizedDatabase,
  pullId: string,
  repositoryId: string,
  labels: Label[],
) {
  const labelsTable = db.table<CanonicalLabel>("labels")
  const relationTable = db.table<PullLabel>("pullLabels")
  const next: PullLabel[] = []
  for (const [order, label] of labels.entries()) {
    const nodeId = label.id
    const existing = db
      .rows(labelsTable)
      .find(
        (row) =>
          (nodeId && row.nodeId === nodeId) ||
          (row.repositoryId === repositoryId &&
            row.name === label.name &&
            (!nodeId || !row.nodeId)),
      )
    const key = existing?.key ?? db.key("label", repositoryId, nodeId ?? label.name)
    await labelsTable.upsert([
      {
        ...existing,
        key,
        scope: db.scope,
        id: key,
        nodeId: nodeId ?? existing?.nodeId,
        repositoryId,
        name: label.name,
        color: label.color,
      },
    ])
    const relationKey = db.key("pull-label", pullId, key)
    next.push({ key: relationKey, scope: db.scope, pullId, labelId: key, order })
  }
  await relationTable.replace(next, (row) => row.pullId === pullId)
}

function readGroups(db: NormalizedDatabase): Group[] {
  const groups = db.rows(db.table<CanonicalGroup>("groups"))
  const repos = db.rows(db.table<GroupRepository>("groupRepositories"))
  const teams = db.rows(db.table<CanonicalTeam>("teams"))
  return groups.map((row) => {
    const organization = row.orgId ? readActor(db, row.orgId) : undefined
    const team = row.teamId ? teams.find((item) => item.key === row.teamId) : undefined
    const parent = team?.parentTeamId
      ? teams.find((item) => item.key === team.parentTeamId)
      : undefined
    return {
      id: row.id,
      kind: row.kind,
      name:
        row.kind === "team" && organization && team
          ? `${organization.login}/${team.name}`
          : row.kind === "org" && organization
            ? organization.login
            : row.name,
      order: row.order,
      ...(organization ? { org: organization.login } : {}),
      ...(parent
        ? { parentSlug: parent.slug, parentName: parent.name }
        : team
          ? { parentSlug: null, parentName: null }
          : {}),
      ...(row.kind === "team" || row.kind === "starred"
        ? {
            repos: repos
              .filter((relation) => relation.groupId === row.id)
              .sort((a, b) => a.order - b.order)
              .flatMap((relation) => {
                const repository = readRepository(db, relation.repositoryId)
                return repository ? [repository.fullName] : []
              }),
          }
        : {}),
    }
  })
}

async function writeGroups(db: NormalizedDatabase, input: Group[]): Promise<void> {
  const groupTable = db.table<CanonicalGroup>("groups")
  const repoLinks = db.table<GroupRepository>("groupRepositories")
  const teamTable = db.table<CanonicalTeam>("teams")
  const groupRows: CanonicalGroup[] = []
  const memberships: GroupRepository[] = []
  for (const group of input) {
    const orgLogin = group.org ?? (group.kind === "org" ? group.name : undefined)
    const orgId = orgLogin
      ? await ensureActor(db, { id: group.orgNodeId, login: orgLogin, kind: "organization" })
      : null
    let teamId: string | null = null
    if (group.kind === "team" && orgId) {
      const slug = group.id.slice(group.id.lastIndexOf("/") + 1)
      const name = group.name.slice(group.name.indexOf("/") + 1)
      const existing = db
        .rows(teamTable)
        .find(
          (team) =>
            team.organizationId === orgId &&
            (group.teamNodeId
              ? team.nodeId === group.teamNodeId
              : team.slug.toLowerCase() === slug.toLowerCase()),
        )
      teamId = existing?.key ?? db.key("team", group.teamNodeId ?? orgId, slug.toLowerCase())
      const parentSlug = group.parentSlug ?? null
      let parentTeamId: string | null = null
      if (parentSlug) {
        const parent = db
          .rows(teamTable)
          .find(
            (team) =>
              team.organizationId === orgId &&
              (group.parentTeamNodeId
                ? team.nodeId === group.parentTeamNodeId
                : team.slug.toLowerCase() === parentSlug.toLowerCase()),
          )
        parentTeamId =
          parent?.key ?? db.key("team", group.parentTeamNodeId ?? orgId, parentSlug.toLowerCase())
        if (!parent)
          await teamTable.upsert([
            {
              key: parentTeamId,
              scope: db.scope,
              id: parentTeamId,
              nodeId: group.parentTeamNodeId ?? undefined,
              organizationId: orgId,
              name: group.parentName ?? parentSlug,
              slug: parentSlug,
              parentTeamId: null,
            },
          ])
      }
      await teamTable.upsert([
        {
          ...existing,
          key: teamId,
          scope: db.scope,
          id: teamId,
          nodeId: group.teamNodeId ?? existing?.nodeId,
          organizationId: orgId,
          name,
          slug,
          parentTeamId,
        },
      ])
    }
    groupRows.push({
      key: db.key("group", group.id),
      scope: db.scope,
      id: group.id,
      kind: group.kind,
      name: group.kind === "me" || group.kind === "starred" ? group.name : "",
      order: group.order,
      orgId,
      teamId,
    })
    for (const [order, route] of (group.repos ?? []).entries()) {
      const repository = findRepository(db, route)
      if (!repository) continue
      const key = db.key("group-repository", group.id, repository.key)
      memberships.push({
        key,
        scope: db.scope,
        groupId: group.id,
        repositoryId: repository.key,
        order,
      })
    }
  }
  await groupTable.upsert(groupRows)
  await repoLinks.replace(memberships, (row) => input.some((group) => group.id === row.groupId))
}

async function removeGroups(db: NormalizedDatabase, ids: string[]): Promise<void> {
  const groupTable = db.table<CanonicalGroup>("groups")
  const repoTable = db.table<GroupRepository>("groupRepositories")
  const pullTable = db.table<GroupPull>("groupPulls")
  const selected = new Set(ids)
  await repoTable.remove(
    db
      .rows(repoTable)
      .filter((row) => selected.has(row.groupId))
      .map((row) => row.key),
  )
  await pullTable.remove(
    db
      .rows(pullTable)
      .filter((row) => selected.has(row.groupId))
      .map((row) => row.key),
  )
  await groupTable.remove(
    db
      .rows(groupTable)
      .filter((row) => selected.has(row.id))
      .map((row) => row.key),
  )
}

function readPulls(db: NormalizedDatabase): PullRequest[] {
  const groupPulls = db.rows(db.table<GroupPull>("groupPulls"))
  return groupPulls.flatMap((membership) => {
    const pull = findPull(db, membership.pullId)
    const repo = pull?.repositoryId ? readRepository(db, pull.repositoryId) : undefined
    if (!pull || !repo || !pull.title || !pull.url || !pull.headRef || !pull.baseRef) return []
    const author = pull.authorId ? readActor(db, pull.authorId) : undefined
    const labels = db
      .rows(db.table<PullLabel>("pullLabels"))
      .filter((row) => row.pullId === pull.key)
      .sort((a, b) => a.order - b.order)
      .flatMap((row) => {
        const label = db.table<CanonicalLabel>("labels").collection.get(row.labelId)
        return label ? [{ id: label.nodeId, name: label.name, color: label.color }] : []
      })
    const requests = readPullSummary(db, pull.key)
    return [
      {
        key: `${membership.groupId}:${pull.nodeId ?? pull.key}`,
        groupId: membership.groupId,
        id: pull.nodeId ?? pull.key,
        repoNodeId: repo.nodeId,
        authorNodeId: author?.nodeId,
        repo: repo.fullName,
        number: pull.number,
        title: pull.title,
        url: pull.url,
        author: author?.login ?? null,
        authorAvatarUrl: author?.avatarUrl ?? null,
        isDraft: pull.isDraft ?? false,
        createdAt: pull.createdAt ?? "",
        updatedAt: pull.updatedAt ?? "",
        syncedAt: membership.syncedAt,
        stateObservedAt: pull.stateObservedAt,
        state: pull.state ?? "OPEN",
        checkSnapshotComplete: pull.checkSnapshotComplete,
        headOid: pull.headOid,
        headRef: pull.headRef,
        baseRef: pull.baseRef,
        reviewDecision: pull.reviewDecision ?? null,
        checkState: pull.checkState ?? null,
        labels,
        labelsComplete: pull.labelsComplete,
        reviewRequestsComplete: pull.reviewRequestsComplete,
        reviewRequests: [...(requests?.reviewRequestTargets?.map((target) => target.login) ?? [])],
        reviewRequestTargets: requests ? (requests.reviewRequestTargets ?? []) : [],
        comments: pull.comments ?? 0,
        additions: pull.additions ?? 0,
        deletions: pull.deletions ?? 0,
      },
    ]
  })
}

async function writePullProjection(db: NormalizedDatabase, row: PullRequest): Promise<void> {
  const ownerLogin = row.repo.split("/")[0] ?? ""
  const repositoryId = await ensureRepository(db, {
    id: row.repoNodeId,
    fullName: row.repo,
    ownerLogin,
    name: row.repo.split("/")[1] ?? "",
  })
  const pullId = await ingestPullRequest(db, {
    nodeId: row.id,
    source: "list",
    observedAt: row.syncedAt,
    repositoryId,
    number: row.number,
    title: row.title,
    url: row.url,
    author: row.author
      ? { id: row.authorNodeId, login: row.author, avatarUrl: row.authorAvatarUrl ?? undefined }
      : null,
    isDraft: row.isDraft,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    state: row.state,
    stateObservedAt: row.stateObservedAt,
    checkSnapshotComplete: row.checkSnapshotComplete,
    headOid: row.headOid,
    headRef: row.headRef,
    baseRef: row.baseRef,
    reviewDecision: row.reviewDecision,
    checkState: row.checkState,
    comments: row.comments,
    additions: row.additions,
    deletions: row.deletions,
    labels: row.labels,
    labelsComplete: row.labelsComplete,
    reviewRequestsComplete: row.reviewRequestsComplete,
    reviewRequests: row.reviewRequests,
    reviewRequestTargets: row.reviewRequestTargets,
  })
  const memberships = db.table<GroupPull>("groupPulls")
  const key = db.key("group-pull", row.groupId, pullId)
  const previous = memberships.collection.get(key)
  const observedAt = row.stateObservedAt ?? row.syncedAt ?? new Date().toISOString()
  if (previous && observedAt < previous.observedAt) return
  await memberships.upsert([
    {
      key,
      scope: db.scope,
      groupId: row.groupId,
      pullId,
      syncedAt: row.syncedAt ?? new Date().toISOString(),
      observedAt,
    },
  ])
}

async function removeGroupPulls(db: NormalizedDatabase, keys: string[]): Promise<void> {
  const membership = db.table<GroupPull>("groupPulls")
  const lookups = new Set(keys)
  const current = readPulls(db).filter((row) => lookups.has(row.key))
  const actualKeys = new Set(
    current.map((row) =>
      db.key("group-pull", row.groupId, findPullByRoute(db, row.repo, row.number)?.key ?? row.id),
    ),
  )
  await membership.remove(
    db
      .rows(membership)
      .filter((row) => actualKeys.has(row.key))
      .map((row) => row.key),
  )
}

function readDetails(db: NormalizedDatabase): PullRequestDetail[] {
  const observations = db.rows(db.table<PullDetailObservation>("pullDetailObservations"))
  return observations.flatMap((observation) => {
    const pull = findPull(db, observation.pullId)
    const repo = pull?.repositoryId ? readRepository(db, pull.repositoryId) : undefined
    if (
      !pull ||
      !repo ||
      pull.title === undefined ||
      pull.url === undefined ||
      pull.state === undefined ||
      pull.bodyHTML === undefined ||
      pull.headRef === undefined ||
      pull.headOid === undefined ||
      pull.baseRef === undefined
    )
      return []
    const author = pull.authorId ? readActor(db, pull.authorId) : undefined
    const timeline = db
      .rows(db.table<CanonicalTimelineItem>("timelineItems"))
      .filter((item) => item.pullId === pull.key)
      .sort((a, b) => a.order - b.order)
      .map((item) => toTimelineItem(db, item))
    const threads = readThreads(db, pull.key)
    const checks = db
      .rows(db.table<PullCheck>("pullChecks"))
      .filter((relation) => relation.pullId === pull.key && relation.headOid === pull.headOid)
      .sort((a, b) => a.order - b.order)
      .flatMap((relation) => {
        const check = db.table<CanonicalCheck>("checks").collection.get(relation.checkId)
        if (!check) return []
        const run = check.workflowRunKey
          ? db
              .table<{ key: string; scope: string; id: number; workflowKey?: string }>(
                "workflowRuns",
              )
              .collection.get(check.workflowRunKey)
          : undefined
        const workflow = run?.workflowKey
          ? db
              .table<{ key: string; scope: string; id: number; name: string }>("workflows")
              .collection.get(run.workflowKey)
          : undefined
        return [
          {
            kind: check.kind,
            name: check.name,
            status: check.status,
            conclusion: check.conclusion,
            url: check.url,
            workflowRunId: run?.id ?? null,
            workflowName: workflow?.name ?? null,
            id: check.id,
          },
        ]
      })
    return [
      {
        key: prKey(repo.fullName, pull.number),
        id: pull.nodeId ?? pull.key,
        repo: repo.fullName,
        number: pull.number,
        title: pull.title,
        url: pull.url,
        state: pull.state,
        isDraft: pull.isDraft ?? false,
        author: author ? { login: author.login, avatarUrl: author.avatarUrl ?? "" } : null,
        bodyHTML: pull.bodyHTML,
        createdAt: pull.createdAt ?? "",
        headRef: pull.headRef,
        headOid: pull.headOid,
        baseRef: pull.baseRef,
        baseOid: pull.baseOid ?? "",
        mergeable: pull.mergeable ?? "UNKNOWN",
        mergeStateStatus: pull.mergeStateStatus ?? "",
        reviewDecision: pull.reviewDecision ?? null,
        mergeMethods: pull.mergeMethods ?? [],
        viewerCanUpdate: pull.viewerCanUpdate ?? false,
        additions: pull.additions ?? 0,
        deletions: pull.deletions ?? 0,
        changedFiles: pull.changedFiles ?? 0,
        timeline,
        threads,
        checks,
      },
    ]
  })
}

function readThreads(db: NormalizedDatabase, pullId: string): ReviewThread[] {
  return db
    .rows(db.table<CanonicalReviewThread>("reviewThreads"))
    .filter((thread) => thread.pullId === pullId)
    .sort((a, b) => a.order - b.order)
    .map((thread) => ({
      id: thread.id,
      path: thread.path,
      line: thread.line,
      startLine: thread.startLine,
      side: thread.side,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      viewerCanResolve: thread.viewerCanResolve,
      comments: db
        .rows(db.table<CanonicalReviewComment>("reviewComments"))
        .filter((comment) => comment.pullId === pullId && comment.threadId === thread.id)
        .sort((a, b) => a.order - b.order)
        .map((comment) => ({
          id: comment.id,
          databaseId: comment.databaseId,
          author: comment.authorId ? actorDto(readActor(db, comment.authorId)) : null,
          body: comment.body,
          bodyHTML: comment.bodyHTML,
          createdAt: comment.createdAt,
        })),
    }))
}

function toTimelineItem(db: NormalizedDatabase, row: CanonicalTimelineItem): TimelineItem {
  const author = row.authorId ? actorDto(readActor(db, row.authorId)) : null
  if (row.kind === "comment")
    return {
      kind: "comment",
      id: row.id,
      databaseId: row.databaseId ?? 0,
      author,
      bodyHTML: row.bodyHTML ?? "",
      createdAt: row.createdAt,
    }
  if (row.kind === "review")
    return {
      kind: "review",
      id: row.id,
      author,
      state: row.state ?? "PENDING",
      bodyHTML: row.bodyHTML ?? "",
      createdAt: row.createdAt,
    }
  if (row.kind === "commit") {
    const commit = row.commitId
      ? db.rows(db.table<CanonicalCommit>("commits")).find((item) => item.key === row.commitId)
      : undefined
    return {
      kind: "commit",
      id: row.id,
      oid: commit?.oid ?? "",
      messageHeadline: commit?.messageHeadline ?? "",
      author: commit?.authorId
        ? (readActor(db, commit.authorId)?.login ?? null)
        : (commit?.authorText ?? null),
      createdAt: commit?.createdAt ?? row.createdAt,
    }
  }
  return {
    kind: "event",
    id: row.id,
    actor: author?.login ?? row.authorText ?? null,
    text: row.text ?? "",
    createdAt: row.createdAt,
  }
}

async function writeDetail(db: NormalizedDatabase, detail: PullRequestDetail): Promise<void> {
  const observedAt = detail.observedAt ?? new Date().toISOString()
  const previous = findPull(db, detail.id) ?? findPullByRoute(db, detail.repo, detail.number)
  if (previous?.scalarObservedAt && observedAt < previous.scalarObservedAt) return
  const repositoryId = await ensureRepository(db, {
    id: detail.repositoryNodeId,
    fullName: detail.repo,
    ownerLogin: detail.ownerLogin ?? detail.repo.split("/")[0] ?? "",
    ownerNodeId: detail.ownerNodeId,
    ownerKind: detail.ownerKind,
  })
  const pullId = await ingestPullRequest(db, {
    nodeId: detail.id,
    source: "detail",
    observedAt,
    repositoryId,
    number: detail.number,
    title: detail.title,
    url: detail.url,
    author: detail.author,
    isDraft: detail.isDraft,
    state: detail.state,
    stateObservedAt: detail.observedAt,
    bodyHTML: detail.bodyHTML,
    createdAt: detail.createdAt,
    headRef: detail.headRef,
    headOid: detail.headOid,
    baseRef: detail.baseRef,
    baseOid: detail.baseOid,
    mergeable: detail.mergeable,
    mergeStateStatus: detail.mergeStateStatus,
    reviewDecision: detail.reviewDecision,
    mergeMethods: detail.mergeMethods,
    viewerCanUpdate: detail.viewerCanUpdate,
    additions: detail.additions,
    deletions: detail.deletions,
    changedFiles: detail.changedFiles,
  } as CanonicalPullInput)
  const now = new Date().toISOString()
  const observationTable = db.table<PullDetailObservation>("pullDetailObservations")
  const observation: PullDetailObservation = {
    key: db.key("pull-detail-observation", pullId),
    scope: db.scope,
    pullId,
    observedAt: now,
    timelineComplete: detail.timelineComplete !== false,
    threadsComplete: detail.threadsComplete !== false,
    checksComplete: detail.checksComplete !== false,
  }
  await observationTable.upsert([observation])
  await writeTimeline(db, pullId, detail.timeline, observation.timelineComplete)
  await writeThreads(db, pullId, detail.threads, observation.threadsComplete)
  await writeChecks(db, pullId, detail.headOid, detail.checks, observation.checksComplete)
}

async function writeTimeline(
  db: NormalizedDatabase,
  pullId: string,
  items: TimelineItem[],
  complete: boolean,
) {
  const table = db.table<CanonicalTimelineItem>("timelineItems")
  const commitTable = db.table<CanonicalCommit>("commits")
  const pull = findPull(db, pullId)
  const rows: CanonicalTimelineItem[] = []
  for (const [order, item] of items.entries()) {
    const author =
      item.kind === "comment" || item.kind === "review"
        ? item.author
        : item.kind === "commit"
          ? item.authorIdentity
          : null
    const authorId = author
      ? await ensureActor(db, { id: author.id, login: author.login, avatarUrl: author.avatarUrl })
      : null
    let commitId: string | undefined
    if (item.kind === "commit" && pull?.repositoryId) {
      const key = db.key("commit", pull.repositoryId, item.oid)
      commitId = key
      await commitTable.upsert([
        {
          key,
          scope: db.scope,
          id: item.oid,
          repositoryId: pull.repositoryId,
          oid: item.oid,
          messageHeadline: item.messageHeadline,
          authorId,
          authorText: item.authorIdentity ? null : item.author,
          createdAt: item.createdAt,
        },
      ])
    }
    rows.push({
      key: db.key("timeline-item", pullId, item.id),
      scope: db.scope,
      pullId,
      kind: item.kind,
      id: item.id,
      order,
      authorId,
      authorText: item.kind === "event" ? item.actor : null,
      ...(item.kind === "comment" ? { databaseId: item.databaseId, bodyHTML: item.bodyHTML } : {}),
      ...(item.kind === "review" ? { state: item.state, bodyHTML: item.bodyHTML } : {}),
      ...(commitId ? { commitId } : {}),
      ...(item.kind === "event" ? { text: item.text } : {}),
      createdAt: item.createdAt,
    })
  }
  if (complete) {
    const priorCommitIds = db
      .rows(table)
      .filter((row) => row.pullId === pullId && row.commitId)
      .map((row) => row.commitId!)
    await table.replace(rows, (row) => row.pullId === pullId)
    const referencedCommitIds = new Set(
      db.rows(table).flatMap((row) => (row.commitId ? [row.commitId] : [])),
    )
    const orphanIds = [...new Set(priorCommitIds)].filter((key) => !referencedCommitIds.has(key))
    await db.table<CanonicalCommit>("commits").remove(orphanIds)
  } else {
    await table.upsert(rows)
  }
}

async function writeThreads(
  db: NormalizedDatabase,
  pullId: string,
  threads: ReviewThread[],
  complete: boolean,
) {
  const threadTable = db.table<CanonicalReviewThread>("reviewThreads")
  const commentTable = db.table<CanonicalReviewComment>("reviewComments")
  const threadRows: CanonicalReviewThread[] = []
  const commentRows: CanonicalReviewComment[] = []
  for (const [order, thread] of threads.entries()) {
    threadRows.push({
      key: db.key("review-thread", pullId, thread.id),
      scope: db.scope,
      pullId,
      id: thread.id,
      path: thread.path,
      line: thread.line,
      startLine: thread.startLine,
      side: thread.side,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      viewerCanResolve: thread.viewerCanResolve,
      order,
    })
    for (const [commentOrder, comment] of thread.comments.entries()) {
      const authorId = comment.author
        ? await ensureActor(db, {
            id: comment.author.id,
            login: comment.author.login,
            avatarUrl: comment.author.avatarUrl,
          })
        : null
      commentRows.push({
        key: db.key("review-comment", pullId, comment.id),
        scope: db.scope,
        pullId,
        threadId: thread.id,
        id: comment.id,
        databaseId: comment.databaseId,
        authorId,
        body: comment.body,
        bodyHTML: comment.bodyHTML,
        createdAt: comment.createdAt,
        order: commentOrder,
      })
    }
  }
  if (complete) {
    await threadTable.replace(threadRows, (row) => row.pullId === pullId)
    await commentTable.replace(commentRows, (row) => row.pullId === pullId)
  } else {
    await threadTable.upsert(threadRows)
    await commentTable.upsert(commentRows)
  }
}

async function writeChecks(
  db: NormalizedDatabase,
  pullId: string,
  headOid: string,
  checks: Check[],
  complete: boolean,
) {
  const table = db.table<CanonicalCheck>("checks")
  const relationTable = db.table<PullCheck>("pullChecks")
  const pull = findPull(db, pullId)
  if (!pull?.repositoryId) return
  const workflowRows = db.table<WorkflowRow>("workflows")
  const runRows = db.table<RunRow>("workflowRuns")
  const rows: CanonicalCheck[] = []
  const relations: PullCheck[] = []
  for (const [order, check] of checks.entries()) {
    const identity = check.id
      ? ["check", pull.repositoryId, check.id]
      : ["check", pull.repositoryId, headOid, check.kind, check.name]
    const key = db.key(...identity)
    let workflowRunKey: string | null = null
    if (check.workflowRunId !== null) {
      workflowRunKey = db.key("workflowRun", check.workflowRunId)
      let workflowKey: string | undefined
      if (check.workflowId !== null && check.workflowId !== undefined) {
        workflowKey = db.key("workflow", check.workflowId)
        const workflow = workflowRows.collection.get(workflowKey)
        await workflowRows.upsert([
          {
            ...workflow,
            key: workflowKey,
            scope: db.scope,
            id: check.workflowId,
            repositoryKey: pull.repositoryId,
            name: check.workflowName ?? workflow?.name ?? "",
            path: workflow?.path ?? "",
            state: workflow?.state ?? "",
            listed: workflow?.listed ?? false,
          },
        ])
      }
      const run = runRows.collection.get(workflowRunKey)
      await runRows.upsert([
        {
          ...run,
          key: workflowRunKey,
          scope: db.scope,
          id: check.workflowRunId,
          repositoryKey: pull.repositoryId,
          workflowKey: workflowKey ?? run?.workflowKey,
          listed: run?.listed ?? false,
        },
      ])
    }
    rows.push({
      key,
      scope: db.scope,
      id: check.id ?? key,
      repositoryId: pull.repositoryId,
      kind: check.kind,
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      url: check.url,
      workflowRunKey,
    })
    relations.push({
      key: db.key("pull-check", pullId, headOid, key),
      scope: db.scope,
      pullId,
      headOid,
      checkId: key,
      order,
    })
  }
  await table.upsert(rows)
  if (complete)
    await relationTable.replace(
      relations,
      (row) => row.pullId === pullId && row.headOid === headOid,
    )
  else await relationTable.upsert(relations)
}

function readFiles(db: NormalizedDatabase): PullRequestFiles[] {
  return db.rows(db.table<PullFileObservation>("pullFileObservations")).flatMap((observation) => {
    const pull = findPull(db, observation.pullId)
    const repo = pull?.repositoryId ? readRepository(db, pull.repositoryId) : undefined
    if (!pull || !repo) return []
    return [
      {
        key: prKey(repo.fullName, pull.number),
        headOid: observation.headOid,
        files: db
          .rows(db.table<CanonicalPullFile>("pullFiles"))
          .filter((file) => file.pullId === pull.key && file.headOid === observation.headOid)
          .sort((a, b) => a.order - b.order)
          .map(({ filename, previousFilename, status, additions, deletions, patch }) => ({
            filename,
            previousFilename,
            status,
            additions,
            deletions,
            patch,
          })),
      },
    ]
  })
}

async function writeFiles(db: NormalizedDatabase, item: PullRequestFiles) {
  const separator = item.key.lastIndexOf("#")
  const repo = item.key.slice(0, separator)
  const number = Number(item.key.slice(separator + 1))
  if (!findRepository(db, repo)) await ensureRepository(db, { fullName: repo })
  const pullId = await ensurePullIdentity(db, { repo, number })
  const pull = findPull(db, pullId)
  if (!pull) return
  const observationTable = db.table<PullFileObservation>("pullFileObservations")
  const observation: PullFileObservation = {
    key: db.key("pull-file-observation", pull.key, item.headOid),
    scope: db.scope,
    pullId: pull.key,
    headOid: item.headOid,
    observedAt: new Date().toISOString(),
    complete: item.complete !== false,
  }
  await observationTable.upsert([observation])
  const files = db.table<CanonicalPullFile>("pullFiles")
  if (item.complete !== false)
    await files.replace(
      item.files.map((file, order) => ({
        key: db.key("pull-file", pull.key, item.headOid, file.filename),
        scope: db.scope,
        pullId: pull.key,
        headOid: item.headOid,
        filename: file.filename,
        previousFilename: file.previousFilename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        order,
      })),
      (row) => row.pullId === pull.key && row.headOid === item.headOid,
    )
  else
    await files.upsert(
      item.files.map((file, order) => ({
        key: db.key("pull-file", pull.key, item.headOid, file.filename),
        scope: db.scope,
        pullId: pull.key,
        headOid: item.headOid,
        filename: file.filename,
        previousFilename: file.previousFilename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        order,
      })),
    )
}

async function removeDetails(db: NormalizedDatabase, keys: string[]) {
  const observations = db.table<PullDetailObservation>("pullDetailObservations")
  const selected = new Set(keys)
  const matching = readDetails(db).filter((row) => selected.has(row.key))
  const ids = new Set(
    matching.flatMap((detail) => {
      const pull = findPullByRoute(db, detail.repo, detail.number)
      return pull ? [pull.key] : []
    }),
  )
  await observations.remove(
    db
      .rows(observations)
      .filter((row) => ids.has(row.pullId))
      .map((row) => row.key),
  )
}

async function removeFileObservations(db: NormalizedDatabase, keys: string[]) {
  const observations = db.table<PullFileObservation>("pullFileObservations")
  const selected = new Set(keys)
  const matching = readFiles(db).filter((row) => selected.has(row.key))
  const ids = new Set(
    matching.flatMap((item) => {
      const pull = findPullByRoute(
        db,
        item.key.slice(0, item.key.lastIndexOf("#")),
        Number(item.key.slice(item.key.lastIndexOf("#") + 1)),
      )
      return pull ? [pull.key] : []
    }),
  )
  await observations.remove(
    db
      .rows(observations)
      .filter((row) => ids.has(row.pullId))
      .map((row) => row.key),
  )
}

function actorDto(actor: CanonicalActor | undefined) {
  return actor
    ? {
        login: actor.login,
        avatarUrl: actor.avatarUrl ?? "",
        ...(actor.nodeId ? { id: actor.nodeId } : {}),
      }
    : null
}

function toRepo(db: NormalizedDatabase, repository: CanonicalRepository): Repo {
  const owner = repository.ownerId ? readActor(db, repository.ownerId) : undefined
  return {
    nodeId: repository.nodeId,
    databaseId: repository.databaseId,
    ownerNodeId: owner?.nodeId,
    ownerDatabaseId: owner?.databaseId,
    ownerKind: owner?.kind,
    fullName: repository.fullName,
    owner: owner?.login ?? repository.fullName.split("/")[0] ?? "",
    name: repository.name,
    private: repository.private ?? false,
    archived: repository.archived ?? false,
    defaultBranch: repository.defaultBranch ?? "",
    pushedAt: repository.pushedAt ?? null,
  }
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>
}
