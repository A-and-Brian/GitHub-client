import { expect, type Page, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

const repository = (id = 50, name = "handbook") => ({
  id,
  name,
  full_name: `acme/${name}`,
  owner: { login: "acme" },
  description: "Documentation without any pull requests",
  private: true,
  archived: false,
  default_branch: "main",
  html_url: `https://github.com/acme/${name}`,
  permissions: { admin: false },
})

async function setup(page: Page, options: { paginated?: boolean; denied?: boolean } = {}) {
  const requests = await fakeGitHub(page, { hierarchy: true })
  const contentRefs: string[] = []
  let failNextPage = true
  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url())
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
    if (url.pathname === "/orgs/acme/repos") {
      if (options.denied) return json({ message: "Forbidden" }, 403)
      if (url.searchParams.get("page") === "2") {
        if (failNextPage) {
          failNextPage = false
          return json({ message: "Try again" }, 500)
        }
        return json([repository(), repository(200, "last-repo")])
      }
      return json(
        options.paginated
          ? [
              repository(),
              ...Array.from({ length: 99 }, (_, i) => repository(i + 1000, `repo-${i}`)),
            ]
          : [repository()],
      )
    }
    if (/^\/orgs\/acme\/teams\/[^/]+\/repos$/.test(url.pathname)) return json([repository()])
    if (url.pathname === "/repos/acme/handbook") return json(repository())
    if (url.pathname === "/repos/acme/handbook/branches")
      return json([{ name: "main" }, { name: "docs/navigation" }])
    if (url.pathname === "/repos/acme/handbook/pulls") return json([])
    if (url.pathname === "/repos/acme/handbook/readme") {
      if (route.request().headers().accept?.includes("html"))
        return route.fulfill({
          contentType: "text/html",
          body: '<h1>Handbook README</h1><p>Team guide</p><script>window.readmeExecuted=true</script><img src="x" onerror="window.readmeExecuted=true"><a href="javascript:alert(1)">Unsafe</a><a href="docs/guide.md">Guide</a>',
        })
      return json({ name: "README.md", path: "README.md", type: "file", size: 100 })
    }
    if (url.pathname.startsWith("/repos/acme/handbook/contents")) {
      const ref = url.searchParams.get("ref") ?? "main"
      contentRefs.push(ref)
      const path = decodeURIComponent(
        url.pathname.replace("/repos/acme/handbook/contents", "").replace(/^\//, ""),
      )
      if (!path)
        return json([
          { name: "docs", path: "docs", type: "dir", size: 0 },
          { name: "README.md", path: "README.md", type: "file", size: 100 },
          { name: "large.bin", path: "large.bin", type: "file", size: 2_000_000 },
        ])
      if (path === "docs")
        return json([{ name: "guide.md", path: "docs/guide.md", type: "file", size: 100 }])
      if (path === "large.bin")
        return json({
          name: path,
          path,
          type: "file",
          size: 2_000_000,
          encoding: "none",
          content: "",
          html_url: "https://github.com/acme/handbook/blob/main/large.bin",
        })
      return json({
        name: path.split("/").at(-1),
        path,
        type: "file",
        size: 100,
        encoding: "base64",
        content: Buffer.from(`Guide on ${ref}`).toString("base64"),
      })
    }
    return route.fallback()
  })
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Organizations and teams", exact: true }),
  ).toBeVisible()
  return { requests, contentRefs }
}

test("home and scoped dashboards discover repositories without PRs and retain deep links", async ({
  page,
}) => {
  const { requests } = await setup(page)
  // Existing group background sync continues; Home adds no repository-specific PR fetches.
  expect(requests.filter((request) => request.path.endsWith("/pulls"))).toHaveLength(0)
  await page.getByRole("complementary").getByRole("link", { name: "acme", exact: true }).click()
  await expect(page.getByRole("heading", { name: "acme", exact: true })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Recent synced open pull requests" }),
  ).toBeVisible()
  await page.getByRole("complementary").getByRole("link", { name: "Backend", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Backend", exact: true })).toBeVisible()
  await page.getByRole("link", { name: /handbook/ }).click()
  await expect(page.getByRole("heading", { name: "acme/handbook", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Handbook README", exact: true })).toBeVisible()
  expect(
    await page.evaluate(() => (window as unknown as { readmeExecuted?: boolean }).readmeExecuted),
  ).toBeUndefined()
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Guide", exact: true })).toHaveAttribute(
    "href",
    /docs.*guide\.md/,
  )
  await page.getByRole("button", { name: "Pull requests", exact: true }).click()
  await expect(page.getByText("No active pull requests.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible()
  await page.goBack()
  await page.goBack()
  await expect(page.getByRole("heading", { name: "Backend", exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Inbox", exact: true }).click()
  await expect(page.getByRole("heading", { name: "PR inbox", exact: true })).toBeVisible()
})

test("startup and reload sync personal and organization feeds without fetching starred repos", async ({
  page,
}) => {
  const { requests } = await setup(page)
  const searchQueries = () =>
    requests.flatMap(({ path, body }) => {
      const operation = body as { query?: string; variables?: { q?: string } } | null
      return path === "/graphql" && operation?.query?.includes("SearchPulls")
        ? [operation.variables?.q ?? ""]
        : []
    })

  const expectFeeds = async () => {
    await expect
      .poll(searchQueries)
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining("involves:@me"),
          expect.stringContaining("org:acme"),
          expect.stringContaining("repo:acme/handbook"),
        ]),
      )
    const navigation = page.getByRole("complementary")
    await expect(navigation.getByRole("link", { name: "Involving me", exact: true })).toBeVisible()
    await expect(navigation.getByRole("link", { name: "acme", exact: true })).toBeVisible()
    await expect(navigation.getByRole("link", { name: "Backend", exact: true })).toBeVisible()
    await expect(navigation.getByRole("link", { name: "Starred", exact: true })).toHaveCount(0)
    expect(requests.filter(({ path }) => path === "/user/starred")).toHaveLength(0)
  }

  await expectFeeds()
  await page.getByRole("complementary").getByRole("link", { name: "Involving me" }).click()
  await expect(page.getByRole("heading", { name: "PR inbox", exact: true })).toBeVisible()
  await expect(page.getByText("Speed up the diff view", { exact: true }).first()).toBeVisible()
  requests.length = 0
  await page.reload()
  await expectFeeds()
})

test("catalog pagination retries a failed later page without losing or duplicating rows", async ({
  page,
}) => {
  await setup(page, { paginated: true })
  await page.goto("/#/org/acme?tab=repositories")
  await expect(page.getByRole("link", { name: /handbook/ })).toBeVisible()
  await page.getByRole("button", { name: "Load more", exact: true }).click()
  await expect(page.getByTestId("repository-cache-status")).toContainText("could not refresh")
  await expect(page.getByRole("link", { name: /handbook/ })).toHaveCount(1)
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(page.getByRole("link", { name: /last-repo/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /handbook/ })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0)
})

test("catalog permission errors are not shown as empty repositories", async ({ page }) => {
  await setup(page, { denied: true })
  await page.goto("/#/org/acme?tab=repositories")
  await expect(page.getByRole("alert")).toContainText("inaccessible")
  await expect(page.getByText("No repositories found.")).toHaveCount(0)
})

test("slash branch and directory navigation preserve ref across reload", async ({ page }) => {
  const { contentRefs } = await setup(page)
  await page.goto("/#/repo/acme/handbook?tab=code&ref=docs%2Fnavigation&path=docs%2Fguide.md")
  await expect(page.locator("pre")).toContainText("Guide on docs/navigation")
  await page.reload()
  await expect(page.locator("pre")).toContainText("Guide on docs/navigation")
  expect(contentRefs).toContain("docs/navigation")
})

test("branch switching ignores a late response from the previous branch", async ({ page }) => {
  await setup(page)
  let releaseOld: (() => void) | undefined
  const delayed = new Promise<void>((resolve) => {
    releaseOld = resolve
  })
  let oldRequested = false
  await page.route("https://api.github.com/repos/acme/handbook/contents*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("ref") !== "main") return route.fallback()
    oldRequested = true
    await delayed
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ name: "old-only.txt", path: "old-only.txt", type: "file", size: 1 }]),
    })
  })
  await page.goto("/#/repo/acme/handbook?tab=code")
  await expect.poll(() => oldRequested).toBe(true)
  await page.getByLabel("Branch", { exact: true }).selectOption("docs/navigation")
  await expect(page.getByRole("button", { name: /README.md/ })).toBeVisible()
  releaseOld?.()
  await expect(page.getByRole("button", { name: /old-only/ })).toHaveCount(0)
  await expect(page.getByLabel("Branch", { exact: true })).toHaveValue("docs/navigation")
})

test("large files have an explicit fallback and narrow repository pages stay usable", async ({
  page,
}) => {
  await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/#/repo/acme/handbook?tab=code&path=large.bin")
  await expect(page.getByText(/too large to preview/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Open on GitHub", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("empty repositories are distinct from inaccessible contents", async ({ page }) => {
  await setup(page)
  await page.route("https://api.github.com/repos/acme/handbook/contents*", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ message: "Git Repository is empty." }),
    }),
  )
  await page.goto("/#/repo/acme/handbook?tab=code")
  await expect(page.getByText("This repository is empty and has no files yet.")).toBeVisible()
  await page.route("https://api.github.com/repos/acme/handbook/contents*", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "Forbidden" }),
    }),
  )
  await page.reload()
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not load repository contents" }),
  ).toBeVisible()
  await expect(page.getByText("This repository is empty and has no files yet.")).toHaveCount(0)
})

test("branch selector loads beyond the first page", async ({ page }) => {
  await setup(page)
  await page.route("https://api.github.com/repos/acme/handbook/branches*", (route) => {
    const pageNumber = new URL(route.request().url()).searchParams.get("page")
    const branches =
      pageNumber === "2"
        ? [{ name: "docs/navigation" }]
        : [{ name: "main" }, ...Array.from({ length: 99 }, (_, i) => ({ name: `feature-${i}` }))]
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(branches) })
  })
  await page.goto("/#/repo/acme/handbook?tab=code")
  await page.getByRole("button", { name: "More branches", exact: true }).click()
  await page.getByLabel("Branch", { exact: true }).selectOption("docs/navigation")
  await expect(page.getByLabel("Branch", { exact: true })).toHaveValue("docs/navigation")
  await expect(page.getByRole("button", { name: "More branches", exact: true })).toHaveCount(0)
})

test("returning to a team renders saved repositories without a network round trip", async ({
  page,
}) => {
  await setup(page)
  const sidebar = page.getByRole("complementary")
  await sidebar.getByRole("link", { name: "Backend", exact: true }).click()
  await expect(page.getByRole("link", { name: /handbook/ })).toBeVisible()
  await sidebar.getByRole("link", { name: "acme", exact: true }).click()
  await expect(page.getByRole("heading", { name: "acme", exact: true })).toBeVisible()
  let catalogRequests = 0
  await page.route("https://api.github.com/orgs/acme/teams/*/repos*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("page")) {
      catalogRequests++
      return route.abort("internetdisconnected")
    }
    return route.fallback()
  })
  await sidebar.getByRole("link", { name: "Backend", exact: true }).click()
  await expect(page.getByRole("link", { name: /handbook/ })).toBeVisible()
  await expect(page.getByText("Loading repositories…", { exact: true })).toHaveCount(0)
  expect(catalogRequests).toBe(0)
})

test("visited repository files survive offline reload and uncached paths explain the miss", async ({
  page,
}) => {
  await setup(page)
  await page.goto("/#/repo/acme/handbook?tab=code&path=docs%2Fguide.md")
  await expect(page.locator("pre")).toContainText("Guide on main")
  await expect(page.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await page.route("https://api.github.com/**", (route) => route.abort("internetdisconnected"))
  await page.reload()
  await expect(page.locator("pre")).toContainText("Guide on main")
  await page.goto("/#/repo/acme/handbook?tab=code&path=never-opened.txt")
  await expect(page.getByText("Not saved for offline use", { exact: false })).toBeVisible()
  await expect(page.locator("pre")).toHaveCount(0)
})

test("cached repository content stays visible when refresh fails", async ({ page }) => {
  await setup(page)
  await page.goto("/#/repo/acme/handbook?tab=code&path=docs%2Fguide.md")
  await expect(page.locator("pre")).toContainText("Guide on main")
  // Visible content can still be saving; finish the initial cache operation before refreshing.
  await expect(page.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await page.route("https://api.github.com/repos/acme/handbook/contents**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unavailable" }),
    }),
  )
  const failedRefresh = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/repos/acme/handbook/contents/docs/guide.md" &&
      response.status() === 503,
  )
  await page.getByRole("button", { name: "Refresh repository", exact: true }).click()
  await failedRefresh
  await expect(page.getByText(/Saved data.*could not refresh/i)).toBeVisible()
  await expect(page.locator("pre")).toContainText("Guide on main")
  await expect(page.getByText("Loading repository contents…")).toHaveCount(0)
})

test("startup uses the saved viewer when account validation stalls", async ({ page }) => {
  await setup(page)
  await page.route("https://api.github.com/user", async (route) => {
    await new Promise<void>((resolve) => page.once("close", () => resolve()))
    await route.abort().catch(() => undefined)
  })
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Organizations and teams", exact: true }),
  ).toBeVisible({ timeout: 5000 })
})

test("organization catalog restores loaded pages and keeps rows through a failed refresh", async ({
  page,
}) => {
  await setup(page, { paginated: true })
  await page.goto("/#/org/acme?tab=repositories")
  await expect(page.getByRole("link", { name: /handbook/ })).toBeVisible()
  await page.getByRole("button", { name: "Load more", exact: true }).click()
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(page.getByRole("link", { name: /last-repo/ })).toBeVisible()
  await expect(page.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await page.getByRole("link", { name: /handbook/ }).click()
  await expect(page.getByRole("heading", { name: "acme/handbook", exact: true })).toBeVisible()
  await page.route("https://api.github.com/orgs/acme/repos*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unavailable" }),
    }),
  )
  await page.goBack()
  await expect(page.getByRole("link", { name: /last-repo/ })).toBeVisible()
  await page.getByRole("button", { name: "Refresh repositories", exact: true }).click()
  await expect(page.getByTestId("repository-cache-status")).toContainText("could not refresh")
  await expect(page.getByRole("link", { name: /handbook/ })).toHaveCount(1)
  await expect(page.getByRole("link", { name: /last-repo/ })).toHaveCount(1)
})

test("saved root and README remain readable offline without mixing branches", async ({ page }) => {
  await setup(page)
  await page.goto("/#/repo/acme/handbook?tab=code")
  await expect(page.getByRole("heading", { name: "Handbook README", exact: true })).toBeVisible()
  await expect(page.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await page.getByLabel("Branch", { exact: true }).selectOption("docs/navigation")
  await expect(page).toHaveURL(/ref=docs(%2F|%2f|\/)navigation/)
  await expect(page.getByLabel("Branch", { exact: true })).toHaveValue("docs/navigation")
  await expect(page.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await page.route("https://api.github.com/**", (route) => route.abort("internetdisconnected"))
  await page.reload()
  await expect(page.getByRole("heading", { name: "Handbook README", exact: true })).toBeVisible()
  await expect(page.getByLabel("Branch", { exact: true })).toHaveValue("docs/navigation")
  await page.getByLabel("Branch", { exact: true }).selectOption("main")
  await expect(page.getByRole("button", { name: /README.md/ })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Handbook README", exact: true })).toBeVisible()
})

test("repository pull pages retry the failed page and retain rows and focus during stale refresh", async ({
  page,
}) => {
  await setup(page)
  let failSecond = true
  let holdRefresh = false
  let refreshStarted = false
  let releaseRefresh: (() => void) | undefined
  const paused = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const pull = (number: number) => ({
    node_id: `PR_handbook_${number}`,
    number,
    created_at: "2026-09-27T00:00:00Z",
    head: { ref: "feature", sha: "abc123" },
    base: { ref: "main" },
    title: `Saved pull ${number}`,
    state: "open",
    draft: false,
    user: { login: "octo" },
    html_url: `https://github.com/acme/handbook/pull/${number}`,
    updated_at: "2026-09-27T00:00:00Z",
  })
  await page.route("https://api.github.com/repos/acme/handbook/pulls*", async (route) => {
    const number = Number(new URL(route.request().url()).searchParams.get("page"))
    if (holdRefresh && number === 1) {
      refreshStarted = true
      await paused
    }
    if (number === 2 && failSecond) {
      failSecond = false
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unavailable" }),
      })
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        number === 1 ? Array.from({ length: 30 }, (_, i) => pull(i + 1)) : [pull(99)],
      ),
    })
  })
  await page.goto("/#/repo/acme/handbook?tab=pulls")
  const inbox = page.getByRole("complementary", { name: "Pull request inbox" })
  const first = inbox.getByRole("button", { name: "acme/handbook #1: Saved pull 1", exact: true })
  await expect(first).toBeVisible()
  await page.getByRole("button", { name: "Load more pull requests", exact: true }).click()
  await expect(inbox.getByTestId("repository-cache-status")).toContainText("could not refresh")
  await inbox.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(
    inbox.getByRole("button", { name: "acme/handbook #99: Saved pull 99", exact: true }),
  ).toBeVisible()
  await expect(inbox.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await first.focus()
  const before = await first.boundingBox()
  holdRefresh = true
  await page.clock.install()
  await page.clock.setSystemTime(Date.now() + 61_000)
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await expect.poll(() => refreshStarted).toBe(true)
  await expect(first).toBeFocused()
  expect(await first.boundingBox()).toEqual(before)
  await expect(page.getByText("Loading pull requests…", { exact: true })).toHaveCount(0)
  releaseRefresh?.()
  await expect(inbox.getByTestId("repository-cache-status")).toContainText("Saved for offline use")
  await expect(first).toBeFocused()
  expect(await first.boundingBox()).toEqual(before)
  await page.route("https://api.github.com/repos/acme/handbook/pulls*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unavailable" }),
    }),
  )
  await page.clock.setSystemTime(Date.now() + 122_000)
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await expect(inbox.getByTestId("repository-cache-status")).toContainText("could not refresh")
  await expect(first).toBeFocused()
  expect(await first.boundingBox()).toEqual(before)
})

test("a rejected saved token still requires sign-in instead of opening cached data", async ({
  page,
}) => {
  await setup(page)
  await page.route("https://api.github.com/user", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Bad credentials" }),
    }),
  )
  await page.reload()
  await expect(
    page.getByText("The saved token was rejected. Sign in again.", { exact: true }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Organizations and teams", exact: true }),
  ).toHaveCount(0)
})

test("saved empty catalogs and PR lists remain resolved when refresh fails", async ({ page }) => {
  await setup(page)
  await page.route("https://api.github.com/orgs/acme/repos*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  )
  await page.goto("/#/org/acme?tab=overview")
  await expect(page.getByText("No repositories found.", { exact: true })).toBeVisible()
  await expect(page.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await page.route("https://api.github.com/orgs/acme/repos*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unavailable" }),
    }),
  )
  await page.getByRole("button", { name: "Refresh repositories", exact: true }).click()
  await expect(page.getByTestId("repository-cache-status")).toContainText("could not refresh")
  await expect(page.getByText("No repositories found.", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "View all repositories", exact: true })).toBeVisible()
  await page.goto("/#/repo/acme/handbook?tab=pulls")
  const inbox = page.getByRole("complementary", { name: "Pull request inbox" })
  await expect(page.getByText("No active pull requests.", { exact: true })).toBeVisible()
  await expect(inbox.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await page.route("https://api.github.com/repos/acme/handbook/pulls*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unavailable" }),
    }),
  )
  await page.getByRole("button", { name: "Refresh inbox", exact: true }).click()
  await expect(inbox.getByTestId("repository-cache-status")).toContainText("could not refresh")
  await expect(page.getByText("No active pull requests.", { exact: true })).toBeVisible()
})
