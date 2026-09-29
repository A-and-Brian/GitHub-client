import { expect, type Page, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

async function signIn(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/inbox")
  await expect(page.getByRole("heading", { name: "PR inbox", exact: true })).toBeVisible()
}

const inbox = (page: Page) => page.getByRole("complementary", { name: "Pull request inbox" })
const openPull = (page: Page) =>
  inbox(page).getByText("Speed up the diff view", { exact: true }).click()

test("persistent outer navigation and inner inbox preserve archived selection, filter and failure state", async ({
  page,
}) => {
  const requests = await fakeGitHub(page, { checkState: "FAILURE" })
  await signIn(page)
  await expect(page.getByRole("complementary")).toHaveCount(2)
  await expect(page.getByRole("button", { name: /Go to/ })).toBeVisible()
  await page.getByLabel("Filter inbox").fill("diff")
  await openPull(page)
  await page.getByRole("button", { name: "Settle locally", exact: true }).click()
  await openPull(page)
  await expect(page.getByRole("heading", { name: "Speed up the diff view" })).toBeVisible()
  await page.getByRole("button", { name: "Failures", exact: true }).click()
  await expect(inbox(page).getByText("Speed up the diff view", { exact: true })).toHaveCount(1)
  await expect(
    page
      .getByRole("region", { name: "Selected pull request" })
      .getByText("Settled locally · GitHub PR unchanged"),
  ).toBeVisible()
  await page.getByRole("button", { name: "Failures", exact: true }).click()
  await expect(page.getByRole("heading", { name: /^Settled/ })).toHaveCount(0)
  await expect(
    page
      .getByRole("list", { name: "Settled pull requests" })
      .getByText("Speed up the diff view", { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel("Filter inbox")).toHaveValue("diff")
  expect(requests.filter((r) => r.method !== "GET" && r.path !== "/graphql")).toEqual([])
})

test("checks distinguish every loaded category and explain the limit", async ({ page }) => {
  await fakeGitHub(page, {
    checks: [
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "COMPLETED", conclusion: "FAILURE" },
      { status: "QUEUED", conclusion: null },
      { status: "IN_PROGRESS", conclusion: null },
      { status: "COMPLETED", conclusion: "SKIPPED" },
      { status: "COMPLETED", conclusion: "CANCELLED" },
      { status: "COMPLETED", conclusion: "NEUTRAL" },
    ],
  })
  await signIn(page)
  await openPull(page)
  await expect(
    page.getByRole("tab", {
      name: /Checks.*1 passed.*1 failed.*1 pending.*1 running.*1 skipped.*1 cancelled.*1 neutral.*7 loaded/,
    }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Check status details" }).click()
  await expect(page.getByText(/Shows up to 100 check results/)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("heading", { name: "Speed up the diff view" })).toBeVisible()
})

test("empty check results are not presented as passed", async ({ page }) => {
  await fakeGitHub(page, { checks: [] })
  await signIn(page)
  await openPull(page)
  await expect(page.getByRole("tab", { name: /Checks.*No checks/ })).toBeVisible()
})

test("contributions expose dates, keyboard navigation, year view and reuse cached data", async ({
  page,
}) => {
  const requests = await fakeGitHub(page)
  await signIn(page)
  const recent = page.getByRole("group", {
    name: "Contributions over the last thirteen weeks",
    exact: true,
  })
  await expect(recent).toBeVisible()
  const tabbable = recent.locator('button[tabindex="0"]')
  await expect(tabbable).toHaveCount(1)
  await tabbable.focus()
  const firstDate = await tabbable.getAttribute("aria-label")
  await page.keyboard.press("ArrowDown")
  await expect(recent.locator('button[tabindex="0"]')).toBeFocused()
  expect(await recent.locator('button[tabindex="0"]').getAttribute("aria-label")).not.toBe(
    firstDate,
  )
  await page.getByRole("button", { name: "View year" }).click()
  await expect(
    page.getByRole("group", { name: "Contributions over the last year", exact: true }),
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("link", { name: "Home", exact: true }).click()
  await page.getByRole("link", { name: "Inbox", exact: true }).click()
  await expect(recent).toBeVisible()
  expect(
    requests.filter(
      (r) =>
        r.path === "/graphql" &&
        String((r.body as { query: string }).query).includes("query Contributions"),
    ),
  ).toHaveLength(1)
})

test("calendar errors remain unavailable, and retry can show a real zero", async ({ page }) => {
  const options = { contributionsError: true, contributionsZero: true }
  await fakeGitHub(page, options)
  await signIn(page)
  await expect(page.getByText("Contributions are unavailable.")).toBeVisible()
  await expect(page.getByText(/^0 contributions/)).toHaveCount(0)
  options.contributionsError = false
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(page.getByText("0 contributions in the last year")).toBeVisible()
})

for (const width of [1440, 1024, 900, 390]) {
  for (const theme of ["light", "dark"] as const) {
    test(`layout and mobile return at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: theme })
      await fakeGitHub(page, { hierarchy: true, pullCount: 18, checkState: "FAILURE" })
      await signIn(page)
      await page.getByLabel("Filter inbox").fill("diff")
      await openPull(page)
      await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
      expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath("inbox.png"), fullPage: true })
      await page.getByRole("button", { name: "Back to inbox", exact: true }).click()
      await expect(page.getByLabel("Filter inbox")).toHaveValue("diff")
      await expect(inbox(page)).toBeVisible()
      await page.screenshot({ path: info.outputPath("list.png"), fullPage: true })
    })
  }
}

test("repository destinations remain consistent", async ({ page }, info) => {
  await fakeGitHub(page)
  await signIn(page)
  await openPull(page)
  const nav = page.getByRole("navigation", { name: "Repository navigation" })
  await nav.getByRole("link", { name: "Actions", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Workflow runs" })).toBeVisible()
  await page.screenshot({ path: info.outputPath("actions.png") })
  await nav.getByRole("button", { name: "Settings", exact: true }).click()
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("API service")
  await page.screenshot({ path: info.outputPath("settings.png") })
  await page.goto("/#/pr/acme/api/7")
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
  await page.screenshot({ path: info.outputPath("standalone.png") })
  await page.getByRole("link", { name: "Inbox", exact: true }).click()
  await expect(inbox(page)).toBeVisible()
})

test("larger text keeps long PR rows and sidebar controls usable", async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  const title =
    "Preserve repository context while making the pull request navigation easier to scan"
  await fakeGitHub(page, { pullTitle: title })
  await signIn(page)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "20px"
  })
  await expect(inbox(page).getByText(title, { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "View year", exact: true })).toBeVisible()
  // The resize rail intentionally extends across the sidebar boundary.
  const overflow = await inbox(page).evaluate((element) =>
    [...element.children]
      .filter((child) => child.getAttribute("role") !== "separator")
      .filter((child) => child.scrollWidth > child.clientWidth + 1)
      .map((child) => ({
        tag: child.tagName,
        label: child.getAttribute("aria-label"),
        width: child.clientWidth,
        content: child.scrollWidth,
      })),
  )
  expect(overflow).toEqual([])
  await inbox(page)
    .getByRole("button", { name: `Actions for ${title}` })
    .focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: "Pin", exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("large-text.png") })
})

test("short window keeps Active and footer usable with both archives populated", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 540 })
  await fakeGitHub(page, { pullCount: 24 })
  await signIn(page)
  await openPull(page)
  await page.getByRole("button", { name: "Settle locally", exact: true }).click()
  await inbox(page).getByText("Follow-up pull request 1", { exact: true }).click()
  await page.getByRole("button", { name: "Snooze", exact: true }).click()
  await page.getByRole("button", { name: "In one hour", exact: true }).click()
  const active = page.getByRole("list", { name: "Active pull requests" })
  const footer = page.locator("footer")
  const activeBox = await active.boundingBox()
  const footerBox = await footer.boundingBox()
  expect(activeBox!.height).toBeGreaterThanOrEqual(80)
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(540)
  await expect(inbox(page).getByText("Follow-up pull request 2", { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("short-window.png") })
})

test("calendar remains in the tab order after a shorter refreshed range", async ({ page }) => {
  const options = { lastContributionDays: 7 }
  await page.clock.install({ time: new Date() })
  await fakeGitHub(page, options)
  await signIn(page)
  const recent = page.getByRole("group", {
    name: "Contributions over the last thirteen weeks",
    exact: true,
  })
  await expect(recent.getByRole("button")).toHaveCount(91)
  await recent.getByRole("button").last().focus()
  options.lastContributionDays = 1
  await page.clock.setFixedTime(new Date(Date.now() + 60 * 60 * 1000 + 1000))
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(recent.getByRole("button")).toHaveCount(85)
  await expect(recent.locator('button[tabindex="0"]')).toHaveCount(1)
  await recent.locator('button[tabindex="0"]').focus()
  await page.keyboard.press("ArrowUp")
  await expect(recent.locator('button[tabindex="0"]')).toBeFocused()
})

test("Actions run retains its repository context and confirmation boundary", async ({
  page,
}, info) => {
  const requests = await fakeGitHub(page, { workflowRun: true })
  await signIn(page)
  await page.goto("/#/actions/acme/api/runs/9")
  await expect(page.getByRole("heading", { name: "Verify navigation" })).toBeVisible()
  const nav = page.getByRole("navigation", { name: "Repository navigation", includeHidden: true })
  await expect(
    nav.getByRole("button", { name: "Actions", exact: true, includeHidden: true }),
  ).toBeVisible()
  await expect(
    nav.getByRole("button", { name: "Settings", exact: true, includeHidden: true }),
  ).toBeVisible()
  await page.screenshot({ path: info.outputPath("run.png") })
  await page.getByRole("button", { name: "Re-run all jobs", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Re-run all jobs" })).toBeVisible()
  await page
    .getByRole("dialog", { name: "Re-run all jobs" })
    .getByRole("button", { name: "Back", exact: true })
    .click()
  expect(requests.filter((r) => r.method !== "GET" && r.path !== "/graphql")).toEqual([])
})

test("long PR titles and offline status remain readable on a phone", async ({ page }, info) => {
  const title =
    "Preserve organization and repository context while improving the pull request navigation hierarchy"
  await page.setViewportSize({ width: 390, height: 844 })
  await fakeGitHub(page, { pullTitle: title })
  await signIn(page)
  await inbox(page).getByText(title, { exact: true }).click()
  await expect(page.getByRole("heading", { name: title })).toBeVisible()
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
  await page.context().setOffline(true)
  await expect(page.getByText("Offline · Showing cached pull request and checks.")).toBeVisible()
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("offline-long-title.png") })
  await page.getByRole("button", { name: "Back to inbox" }).click()
  await expect(
    inbox(page).getByRole("button", { name: `acme/api #7: ${title}`, exact: true }),
  ).toBeFocused()
})
