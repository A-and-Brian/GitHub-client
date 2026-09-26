import type { Group } from "./types"

export interface GroupTreeNode {
  group: Group
  /** True when GitHub identifies this parent but the viewer is not a member. */
  contextOnly: boolean
  contextKind?: "org" | "team"
  children: GroupTreeNode[]
}

/** Build org/team navigation from explicit GitHub parent slugs. */
export function buildGroupTree(groups: Group[]): GroupTreeNode[] {
  const nodes = new Map<string, GroupTreeNode>()
  for (const group of groups) nodes.set(group.id, { group, contextOnly: false, children: [] })

  for (const child of groups) {
    if (child.kind !== "team" || !child.org) continue
    const orgId = `org:${child.org}`
    if (!nodes.has(orgId)) {
      nodes.set(orgId, {
        group: { id: orgId, kind: "org", name: child.org, org: child.org, order: child.order },
        contextOnly: true,
        contextKind: "org",
        children: [],
      })
    }
    if (!child.parentSlug) continue
    const id = teamId(child.org, child.parentSlug)
    if (!nodes.has(id)) {
      nodes.set(id, {
        group: {
          id,
          kind: "team",
          name: child.parentName ?? child.parentSlug,
          org: child.org,
          order: child.order,
        },
        contextOnly: true,
        contextKind: "team",
        children: [],
      })
    }
  }

  const parents = new Map<string, string>()
  for (const { group } of nodes.values()) {
    if (group.kind !== "team" || !group.org || !group.parentSlug) continue
    const parentId = teamId(group.org, group.parentSlug)
    if (parentId !== group.id && nodes.has(parentId)) parents.set(group.id, parentId)
  }

  // Cut any cyclic edge. The affected team becomes a root under its organization.
  for (const id of parents.keys()) {
    const seen = new Set([id])
    let parent = parents.get(id)
    while (parent) {
      if (seen.has(parent)) {
        parents.delete(id)
        break
      }
      seen.add(parent)
      parent = parents.get(parent)
    }
  }

  const roots: GroupTreeNode[] = []
  for (const [id, node] of nodes) {
    if (node.group.kind !== "team") {
      roots.push(node)
      continue
    }
    const parentId = parents.get(id) ?? (node.group.org ? `org:${node.group.org}` : undefined)
    const parent = parentId ? nodes.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sort = (list: GroupTreeNode[]) => {
    list.sort((a, b) => a.group.order - b.group.order || a.group.name.localeCompare(b.group.name))
    for (const node of list) sort(node.children)
  }
  sort(roots)
  return roots
}

function teamId(org: string, slug: string): string {
  return `team:${org}/${slug}`
}
