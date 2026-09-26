import { expect, test } from "vitest"
import { GitHubClient } from "./client"
import type { Platform } from "./platform"
import { fakeGitHub } from "./test/fake-github"

function platform(stored: string | null, env: string | null): Platform {
  let token = stored
  return {
    fetch: fakeGitHub().fetch,
    secrets: {
      get: async () => token,
      set: async (t) => {
        token = t
      },
      clear: async () => {
        token = null
      },
    },
    envToken: async () => env,
  }
}

test("restore prefers the stored token and can skip GITHUB_TOKEN", async () => {
  expect(await new GitHubClient(platform("stored", "env")).auth.restore()).toBe(true)

  const envOnly = new GitHubClient(platform(null, "env"))
  expect(await envOnly.auth.restore({ allowEnv: false })).toBe(false)
  expect(await envOnly.auth.restore()).toBe(true)
  expect(envOnly.auth.getToken()).toBe("env")
})

test("sign-out forgets the token and deletes cached data and drafts", async () => {
  const client = new GitHubClient(platform("stored", null))
  await client.auth.restore()
  await client.collections.repos.upsert([
    {
      fullName: "a/b",
      owner: "a",
      name: "b",
      private: false,
      archived: false,
      defaultBranch: "main",
      pushedAt: null,
    },
  ])
  await client.collections.pullFiles.upsert([{ key: "a/b#1", headOid: "abc", files: [] }])
  client.addDraft({ prKey: "a/b#1", path: "x", line: 1, startLine: null, side: "RIGHT", body: "?" })

  await client.signOut()

  expect(client.auth.getToken()).toBeNull()
  expect(await client.platform.secrets.get()).toBeNull()
  expect(client.collections.repos.collection.size).toBe(0)
  expect(client.collections.drafts.size).toBe(0)
})
