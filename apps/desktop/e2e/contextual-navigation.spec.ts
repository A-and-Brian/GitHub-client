import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

for (const path of ["org/acme", "team/acme/backend"]) {
  test(`${path} keeps the parent tabs around its Inbox, PR, and check dialog`, async ({
    page,
  }, info) => {
    await fakeGitHub(page, { hierarchy: true, workflowRun: true })
    await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
    await page.goto(`/#/${path}`)
    const parentNav = page.getByRole("navigation", {
      name: path.startsWith("org") ? "acme navigation" : "Backend navigation",
    })
    await parentNav.getByRole("link", { name: "Pull requests", exact: true }).click()
    const inbox = page.getByRole("complementary", { name: "Pull request inbox" })
    await page.getByLabel("Filter inbox").fill("diff")
    await inbox
      .getByRole("button", { name: "acme/api #7: Speed up the diff view", exact: true })
      .click()
    await expect(parentNav.getByRole("link", { name: "Overview" })).toBeVisible()
    await expect(parentNav.getByRole("link", { name: "Repositories" })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${path}.*pull=`))
    await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
    await page.screenshot({ path: info.outputPath("scoped-inbox.png") })
    await page.getByRole("tab", { name: /^Checks/ }).click()
    await page.getByRole("link", { name: "test", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Workflow run 9" })).toBeVisible()
    await page.screenshot({ path: info.outputPath("check-dialog.png") })
    const runDialog = page.getByRole("dialog", { name: "Workflow run 9" })
    const closeBox = await runDialog
      .getByRole("button", { name: "Close", exact: true })
      .boundingBox()
    const externalBox = await runDialog
      .getByRole("button", { name: "Open on GitHub", exact: true })
      .boundingBox()
    expect(externalBox!.x + externalBox!.width).toBeLessThanOrEqual(closeBox!.x)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(runDialog).toBeVisible()
    expect(await runDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    )
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByRole("heading", { name: /Speed up the diff view/ })).toBeVisible()
    await expect(page.getByLabel("Filter inbox")).toHaveValue("diff")
    await parentNav.getByRole("link", { name: "Overview" }).click()
    await parentNav.getByRole("link", { name: "Pull requests", exact: true }).click()
    await expect(page.getByRole("heading", { name: /Speed up the diff view/ })).toBeVisible()
    await expect(page.getByLabel("Filter inbox")).toHaveValue("diff")
    await page.getByRole("button", { name: "Back to inbox" }).click()
    await expect(
      inbox.getByRole("button", { name: "acme/api #7: Speed up the diff view", exact: true }),
    ).toBeFocused()
    await page.goBack()
    await expect(page.getByRole("heading", { name: /Speed up the diff view/ })).toBeVisible()
    await page.reload()
    await expect(parentNav).toBeVisible()
    await expect(page.getByRole("heading", { name: /Speed up the diff view/ })).toBeVisible()
  })
}

test("recent organization PR opens inside its Pull requests tab even on a narrow window", async ({
  page,
}) => {
  await fakeGitHub(page, { hierarchy: true })
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.setViewportSize({ width: 700, height: 900 })
  await page.goto("/#/org/acme")
  await page.getByRole("link", { name: /Speed up the diff view/ }).click()
  await expect(page).toHaveURL(/org\/acme.*tab=pulls/)
  await expect(page.getByRole("navigation", { name: "acme navigation" })).toBeVisible()
  await expect(page.getByRole("heading", { name: /Speed up the diff view/ })).toBeVisible()
  await page.getByRole("button", { name: "Back to inbox" }).click()
  await expect(page.getByRole("complementary", { name: "Pull request inbox" })).toBeVisible()
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
})

test("repository tabs preserve the scoped Inbox and protect a settings draft", async ({ page }) => {
  await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api?tab=pulls")
  const nav = page.getByRole("navigation", { name: "Repository navigation" })
  await page.getByLabel("Filter inbox").fill("diff")
  await page
    .getByRole("complementary", { name: "Pull request inbox" })
    .getByRole("button", { name: "acme/api #7: Speed up the diff view", exact: true })
    .click()
  await nav.getByRole("button", { name: "Code", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Repository guide" })).toBeVisible()
  await nav.getByRole("button", { name: "Pull requests", exact: true }).click()
  await expect(page.getByLabel("Filter inbox")).toHaveValue("diff")
  await expect(page.getByRole("heading", { name: /Speed up the diff view/ })).toBeVisible()
  await nav.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByLabel("Description", { exact: true }).fill("Keep this draft")
  await nav.getByRole("button", { name: "Code", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Unsaved repository settings" })
  await dialog.getByRole("button", { name: "Stay", exact: true }).click()
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Keep this draft")
  await nav.getByRole("button", { name: "Code", exact: true }).click()
  await dialog.getByRole("button", { name: "Discard", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Repository guide" })).toBeVisible()
})

test("repository Inbox loads subsequent API pages, including PRs absent from personal sync", async ({
  page,
}) => {
  await fakeGitHub(page)
  await page.route("https://api.github.com/repos/acme/api/pulls?*", (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page"))
    return route.fulfill({
      json: Array.from({ length: pageNumber === 1 ? 30 : 1 }, (_, index) => ({
        node_id: `REPO_${pageNumber}_${index}`,
        number: pageNumber * 100 + index,
        title: `Repository-only change ${pageNumber}-${index}`,
        html_url: "https://github.com/acme/api/pull/100",
        draft: false,
        user: { login: "someone-else", avatar_url: "" },
        created_at: "2026-09-27T10:00:00Z",
        updated_at: "2026-09-27T10:00:00Z",
        head: { ref: "feature", sha: "abc" },
        base: { ref: "main" },
      })),
    })
  })
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api?tab=pulls")
  await expect(page.getByText("Repository-only change 1-0", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Load more pull requests" }).click()
  await page.getByLabel("Filter inbox").fill("2-0")
  await expect(page.getByText("Repository-only change 2-0", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Load more pull requests" })).toHaveCount(0)
})

test("repository Releases load on demand, preserve navigation, and hand assets to the browser", async ({
  page,
}, info) => {
  const requests = await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.addInitScript(() => {
    window.open = (url) => {
      ;(window as unknown as { externalHandoff?: string }).externalHandoff = String(url)
      return null
    }
  })
  await page.goto("/#/repo/acme/api")
  await expect(page.getByRole("heading", { name: "Repository guide" })).toBeVisible()
  expect(requests.filter((request) => request.path.endsWith("/releases"))).toHaveLength(0)
  const nav = page.getByRole("navigation", { name: "Repository navigation" })
  await nav.getByRole("button", { name: "Releases", exact: true }).click()
  await expect(page).toHaveURL(/repo\/acme\/api\?tab=releases/)
  await expect(
    page.getByRole("heading", {
      name: "Repository release with an intentionally long name that should wrap on narrow screens",
    }),
  ).toBeVisible()
  await expect(page.getByText("v1.2.0", { exact: true })).toBeVisible()
  await expect(page.getByText("Pre-release", { exact: true })).toBeVisible()
  const notes = page.getByText("Release notes", { exact: true })
  await notes.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText(/very-long-unbroken-sequence/)).toBeVisible()
  await page.screenshot({ path: info.outputPath("repository-releases-wide.png") })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
  expect(
    await page
      .getByRole("article")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath("repository-releases-narrow.png") })

  await page.getByRole("link", { name: "desktop-installer-with-a-long-name-x64.zip" }).click()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { externalHandoff?: string }).externalHandoff),
    )
    .toBe(
      "https://github.com/acme/api/releases/download/v1.2.0/desktop-installer-with-a-long-name-x64.zip",
    )
  await page.reload()
  await expect(
    page.getByRole("heading", { name: /Repository release with an intentionally long name/ }),
  ).toBeVisible()
  await nav.getByRole("button", { name: "Code", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Repository guide" })).toBeVisible()
  expect(
    requests
      .filter((request) => request.path.endsWith("/releases"))
      .every((request) => request.method === "GET"),
  ).toBe(true)
})

test("repository Releases retry failures, show empty results, and load later pages", async ({
  page,
}) => {
  const options = { releasesError: 403 }
  const requests = await fakeGitHub(page, options)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api?tab=releases")
  await expect(page.getByRole("alert")).toContainText("Could not load releases")
  await expect(page.getByRole("alert")).toContainText("Contents access is required")
  options.releasesError = undefined
  await page.getByRole("button", { name: "Retry", exact: true }).last().click()
  await expect(
    page.getByRole("heading", { name: /Repository release with an intentionally long name/ }),
  ).toBeVisible()

  await page.route("https://api.github.com/repos/acme/api/releases?*", (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page"))
    return route.fulfill({
      json: Array.from({ length: pageNumber === 1 ? 100 : 1 }, (_, index) => ({
        id: pageNumber * 100 + index,
        name: `Release page ${pageNumber} item ${index}`,
        tag_name: `v${pageNumber}.${index}`,
        body: null,
        draft: false,
        prerelease: false,
        published_at: null,
        html_url: "https://github.com/acme/api/releases",
        assets: [],
      })),
    })
  })
  await page.getByRole("button", { name: "Refresh repository" }).click()
  await expect(page.getByText("Release page 1 item 0", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Load more releases" }).click()
  await expect(page.getByText("Release page 2 item 0", { exact: true })).toBeVisible()
  expect(
    requests
      .filter((request) => request.path.endsWith("/releases"))
      .every((request) => request.method === "GET"),
  ).toBe(true)
})

test("repository Releases show an empty state only after a successful empty response", async ({
  page,
}) => {
  await fakeGitHub(page)
  await page.route("https://api.github.com/repos/acme/api/releases?*", (route) =>
    route.fulfill({ json: [] }),
  )
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api?tab=releases")
  await expect(page.getByText("No releases yet.", { exact: true })).toBeVisible()
  await page.route("https://api.github.com/repos/acme/api/releases?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: '{"message":"GitHub is temporarily unavailable"}',
    }),
  )
  await page.getByRole("button", { name: "Refresh repository" }).click()
  await expect(page.getByRole("alert")).toContainText("Could not refresh releases")
  await expect(page.getByRole("alert")).toContainText("GitHub is temporarily unavailable")
  await expect(page.getByText("No releases yet.", { exact: true })).toBeVisible()
})

test("repository Releases show loading until the successful empty response arrives", async ({
  page,
}) => {
  await fakeGitHub(page)
  let finishResponse!: () => void
  let markRequested!: () => void
  const responseGate = new Promise<void>((resolve) => {
    finishResponse = resolve
  })
  const requestStarted = new Promise<void>((resolve) => {
    markRequested = resolve
  })
  await page.route("https://api.github.com/repos/acme/api/releases?*", async (route) => {
    markRequested()
    await responseGate
    await route.fulfill({ json: [] })
  })
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api?tab=releases")
  await requestStarted
  try {
    await expect(
      page
        .getByRole("main")
        .getByRole("status")
        .filter({ hasText: /^Loading…$/ }),
    ).toBeVisible()
    await expect(page.getByText("No releases yet.", { exact: true })).toHaveCount(0)
  } finally {
    finishResponse()
  }
  await expect(page.getByText("No releases yet.", { exact: true })).toBeVisible()
})

test("changing entity scope and signing out clear the previous PR context", async ({ page }) => {
  await fakeGitHub(page, { hierarchy: true })
  await page.goto("/")
  await page.getByLabel("Personal access token").fill("ghp_test")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("button", { name: "octo", exact: true })).toBeVisible()
  await page.goto("/#/team/acme/backend?tab=pulls&pull=acme%2Fapi%237")
  await expect(page.getByRole("heading", { name: /Speed up the diff view/ })).toBeVisible()
  await page.getByRole("main").getByRole("link", { name: "acme", exact: true }).click()
  await page
    .getByRole("navigation", { name: "acme navigation" })
    .getByRole("link", { name: "Pull requests", exact: true })
    .click()
  await expect(page.getByRole("region", { name: "Selected pull request" })).toContainText(
    "Select a PR",
  )
  await page.getByLabel("Filter inbox").fill("diff")
  await page
    .getByRole("button", { name: "acme/api #7: Speed up the diff view", exact: true })
    .click()
  await page.getByRole("button", { name: "octo", exact: true }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page.getByLabel("Personal access token")).toBeVisible()
  await expect(page).toHaveURL(/#\/inbox$/)
  await page.route("https://api.github.com/user", (route) =>
    route.fulfill({ json: { login: "another-user", name: "Another user", avatar_url: "" } }),
  )
  await page.getByLabel("Personal access token").fill("ghp_other")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByLabel("Filter inbox")).toHaveValue("")
  await expect(page.getByRole("region", { name: "Selected pull request" })).toContainText(
    "Select a PR",
  )
})

test("partial repository rows do not erase a settled PR's check snapshot", async ({ page }) => {
  const options = { checkState: "FAILURE" as const, pullCount: 1 }
  await fakeGitHub(page, options)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/inbox")
  await page
    .getByRole("button", { name: "acme/api #7: Speed up the diff view", exact: true })
    .click()
  await page.getByRole("button", { name: "Settle locally", exact: true }).click()
  await expect(
    page.getByRole("list", { name: "Settled pull requests" }).locator("[data-pull-id]"),
  ).toHaveCount(1)
  options.pullCount = 0
  await page.getByRole("button", { name: "Refresh inbox" }).click()
  await expect(
    page.getByRole("button", { name: "Refresh inbox" }).locator(".animate-spin"),
  ).toHaveCount(0)
  await page.goto("/#/repo/acme/api?tab=pulls")
  await expect(
    page
      .getByRole("list", { name: "Settled pull requests" })
      .getByText("Speed up the diff view", { exact: true }),
  ).toBeVisible()
  options.pullCount = 1
  await page.getByRole("link", { name: "Inbox", exact: true }).click()
  await page.getByRole("button", { name: "Refresh inbox" }).click()
  await expect(
    page.getByRole("button", { name: "Refresh inbox" }).locator(".animate-spin"),
  ).toHaveCount(0)
  await expect(
    page
      .getByRole("list", { name: "Active pull requests" })
      .getByText("Speed up the diff view", { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("list", { name: "Settled pull requests" }).locator("[data-pull-id]"),
  ).toHaveCount(1)
})
