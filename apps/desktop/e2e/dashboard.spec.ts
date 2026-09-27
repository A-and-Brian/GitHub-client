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
  await expect(page.getByText("No open pull requests.", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0)
  await page.goBack()
  await page.goBack()
  await expect(page.getByRole("heading", { name: "Backend", exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Inbox", exact: true }).click()
  await expect(page.getByRole("heading", { name: "PR inbox", exact: true })).toBeVisible()
})

test("catalog pagination retries a failed later page without losing or duplicating rows", async ({
  page,
}) => {
  await setup(page, { paginated: true })
  await page.goto("/#/org/acme?tab=repositories")
  await expect(page.getByRole("link", { name: /handbook/ })).toBeVisible()
  await page.getByRole("button", { name: "Load more", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("could not be loaded")
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
  await expect(page.getByRole("alert")).toContainText("Could not load repository contents")
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
