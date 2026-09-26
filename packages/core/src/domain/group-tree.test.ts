import { expect, test } from "vitest"
import { buildGroupTree } from "./group-tree"
import type { Group } from "./types"

const org: Group = { id: "org:acme", kind: "org", name: "acme", org: "acme", order: 1 }
const team = (slug: string, order: number, parentSlug?: string, parentName?: string): Group => ({
  id: `team:acme/${slug}`,
  kind: "team",
  name: `acme/${slug}`,
  org: "acme",
  order,
  parentSlug,
  parentName,
})
const at = <T>(list: T[], index: number): T => {
  const value = list[index]
  if (!value) throw new Error(`Missing test item at ${index}`)
  return value
}

test("nests member teams beneath an inaccessible parent without making it selectable", () => {
  const tree = buildGroupTree([org, team("child", 3, "parent", "Parent"), team("peer", 2)])
  const orgNode = tree.find((node) => node.group.id === org.id)!
  expect(orgNode.children.map((node) => node.group.id)).toEqual([
    "team:acme/peer",
    "team:acme/parent",
  ])
  expect(at(orgNode.children, 1)).toMatchObject({
    contextOnly: true,
    group: { name: "Parent" },
    children: [{ group: { id: "team:acme/child" }, contextOnly: false }],
  })
})

test("supports deep nesting and keeps same-named teams in different organizations distinct", () => {
  const tree = buildGroupTree([
    org,
    team("root", 1),
    team("middle", 2, "root", "root"),
    team("leaf", 3, "middle", "middle"),
    { ...org, id: "org:other", name: "other", org: "other" },
    { ...team("root", 4), id: "team:other/root", org: "other" },
  ])
  const acme = tree.find((node) => node.group.id === "org:acme")!
  expect(at(at(at(acme.children, 0).children, 0).children, 0).group.id).toBe("team:acme/leaf")
  expect(at(tree.find((node) => node.group.id === "org:other")!.children, 0).group.id).toBe(
    "team:other/root",
  )
})

test("treats a missing parent as a root and cuts parent cycles", () => {
  const missing = buildGroupTree([org, team("child", 1, "gone", "Gone")])
  expect(at(missing.find((node) => node.group.id === org.id)!.children, 0).contextOnly).toBe(true)

  const cycle = buildGroupTree([org, team("one", 1, "two", "Two"), team("two", 2, "one", "One")])
  const orgNode = cycle.find((node) => node.group.id === org.id)!
  expect(orgNode.children).toHaveLength(1)
  expect(at(orgNode.children, 0).group.id).toBe("team:acme/one")
  expect(at(at(orgNode.children, 0).children, 0).group.id).toBe("team:acme/two")
})

test("shows a missing organization as context without making it selectable", () => {
  const tree = buildGroupTree([team("child", 1)])
  expect(tree).toMatchObject([
    {
      contextOnly: true,
      contextKind: "org",
      group: { id: "org:acme", name: "acme" },
      children: [{ group: { id: "team:acme/child" }, contextOnly: false }],
    },
  ])
})
