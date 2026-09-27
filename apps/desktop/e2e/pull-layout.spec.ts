import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

const CHECKS = { role: "complementary" as const, name: "Pull request checks" }
const checks = (page: Page) => page.getByRole(CHECKS.role, { name: CHECKS.name })

async function signIn(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
}

async function sizePane(page: Page, desiredWidth: number) {
  const pane = page.locator(".pull-content-body")
  await expect(pane).toBeVisible()
  const box = await pane.boundingBox()
  if (!box) throw new Error("Pull content pane is not visible")
  const viewport = page.viewportSize()
  if (!viewport) throw new Error("Viewport is unavailable")
  await page.setViewportSize({
    width: viewport.width + desiredWidth - box.width,
    height: viewport.height,
  })
  await expect
    .poll(async () => Math.round((await pane.boundingBox())?.width ?? 0))
    .toBe(desiredWidth)
}

async function openInbox(page: Page) {
  await signIn(page)
  await page.goto("/#/inbox")
  await page
    .getByRole("button", { name: "acme/api #7: Speed up the diff view", exact: true })
    .click()
  await expect(page.locator(".pull-content-body")).toBeVisible()
}

test("capture wide and narrow conversation in light and dark themes", async ({
  page,
}, testInfo) => {
  await fakeGitHub(page)
  await signIn(page)
  await page.goto("/#/pr/acme/api/7?tab=conversation")
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.classList.remove("light", "dark")
      document.documentElement.classList.add(value)
    }, theme)
    await sizePane(page, 1200)
    await expect(checks(page)).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath(`pull-wide-${theme}.png`),
      animations: "disabled",
    })
    await sizePane(page, 900)
    await expect(checks(page)).toBeHidden()
    await page.screenshot({
      path: testInfo.outputPath(`pull-narrow-${theme}.png`),
      animations: "disabled",
    })
  }
})

test("standalone and inbox use the detail pane width at the 1152px breakpoint", async ({
  page,
}) => {
  await fakeGitHub(page)
  await signIn(page)
  await page.goto("/#/pr/acme/api/7?tab=conversation")

  for (const width of [1151, 1152]) {
    await sizePane(page, width)
    const sidebar = checks(page)
    if (width === 1152) {
      await expect(sidebar).toBeVisible()
      await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
    } else {
      await expect(sidebar).toBeHidden()
      await expect
        .poll(async () =>
          page.locator(".pull-conversation-layout").evaluate((layout) => {
            const pane = layout.parentElement!.getBoundingClientRect()
            const box = layout.getBoundingClientRect()
            return Math.abs(box.left - pane.left - (pane.width - box.width) / 2) < 1
          }),
        )
        .toBe(true)
      await expect(page.locator(".pull-conversation-scroll")).toHaveJSProperty("scrollWidth", 1151)
    }
  }

  await page.setViewportSize({ width: 1800, height: 900 })
  await openInbox(page)
  for (const width of [1151, 1152]) {
    await sizePane(page, width)
    if (width === 1152) await expect(checks(page)).toBeVisible()
    else await expect(checks(page)).toBeHidden()
  }
})

test("checks stay beside a long conversation and drafts survive resizing", async ({ page }) => {
  await fakeGitHub(page, {
    commentCount: 30,
    checks: Array.from({ length: 36 }, (_, index) => ({
      name: `Check ${String(index + 1).padStart(2, "0")}`,
      status: index === 35 ? "IN_PROGRESS" : "COMPLETED",
      conclusion: index === 35 ? null : "SUCCESS",
      workflowName: `Long workflow name for group ${Math.floor(index / 6) + 1}`,
    })),
  })
  await signIn(page)
  await page.goto("/#/pr/acme/api/7?tab=conversation")
  await page.setViewportSize({ width: 1400, height: 600 })
  await sizePane(page, 1200)
  const sidebar = checks(page)
  const comment = page.getByPlaceholder("Leave a comment (Markdown). Ctrl+Enter to send.")
  await expect(sidebar).toBeVisible()
  await comment.fill("keep this draft")

  // Details render before the files request completes. Its completion removes
  // the freshness notice and shifts the whole pane, independently of scrolling.
  await expect(page.getByText(/Awaiting refresh/)).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }).locator(".animate-spin"),
  ).toHaveCount(0)

  const scroll = page.locator(".pull-conversation-scroll")
  await scroll.evaluate((node) => node.scrollTo({ top: 0, behavior: "instant" }))
  const before = await sidebar.boundingBox()
  await scroll.evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: "instant" }))
  const after = await sidebar.boundingBox()
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0)
  const conversationBox = await scroll.boundingBox()
  expect(after!.y + after!.height).toBeLessThanOrEqual(conversationBox!.y + conversationBox!.height)
  expect(await scroll.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  const lastCheck = sidebar.getByText("Check 36")
  await sidebar.evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: "instant" }))
  await expect(lastCheck).toBeVisible()
  const sidebarBox = await sidebar.boundingBox()
  const lastCheckBox = await lastCheck.boundingBox()
  expect(lastCheckBox!.y + lastCheckBox!.height).toBeLessThanOrEqual(
    sidebarBox!.y + sidebarBox!.height,
  )

  await sizePane(page, 1151)
  await expect(sidebar).toBeHidden()
  await expect(comment).toHaveValue("keep this draft")
  await sizePane(page, 1152)
  await expect(sidebar).toBeVisible()
  await expect(comment).toHaveCount(1)
  await expect(comment).toHaveValue("keep this draft")
  await expect(page.getByRole("button", { name: "Squash and merge" })).toBeVisible()
})

test("check states, links, tabs, shortcuts, and empty checks remain available", async ({
  page,
  browser,
}) => {
  await fakeGitHub(page, {
    checks: [
      { name: "Frontend", status: "COMPLETED", conclusion: "SUCCESS", workflowName: "CI" },
      { name: "Release skipped", status: "COMPLETED", conclusion: "SKIPPED", workflowName: "CI" },
      { name: "Integration running", status: "IN_PROGRESS", conclusion: null, workflowName: "CI" },
      { name: "Backend failed", status: "COMPLETED", conclusion: "FAILURE", workflowName: "CI" },
    ],
  })
  await signIn(page)
  await page.goto("/#/pr/acme/api/7?tab=conversation")
  await sizePane(page, 1200)

  const sidebar = checks(page)
  await expect(sidebar.getByText("Frontend")).toBeVisible()
  await expect(sidebar.getByText(/^success$/i)).toBeVisible()
  await expect(sidebar.getByText(/^skipped$/i)).toBeVisible()
  await expect(sidebar.getByText(/in_progress/i)).toBeVisible()
  await expect(sidebar.getByText(/^failure$/i)).toBeVisible()
  await page.goto("/#/pr/acme/api/7?tab=checks")
  await expect(sidebar).toBeVisible()
  await expect(page.getByRole("tab", { name: /Checks/ })).toBeHidden()
  await expect(sidebar.getByRole("link", { name: "Frontend" })).toHaveAttribute(
    "href",
    /\/actions\/acme\/api\/runs\/9\?job=99/,
  )

  await page.getByRole("tab", { name: /Files/ }).click()
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByText("Frontend")).toBeVisible()
  await page.keyboard.press("3")
  await expect(page.getByText("Backend failed")).toBeVisible()
  await expect(sidebar).toBeFocused()
  await page.keyboard.press("1")
  await expect(sidebar).toBeVisible()
  await expect(page.getByRole("tab", { name: /Checks/ })).toBeHidden()

  await page.setViewportSize({ width: 1000, height: 800 })
  await expect(page.getByRole("tab", { name: /Checks/ })).toBeVisible()
  await page.goto("/#/pr/acme/api/7?tab=checks")
  await expect(page.getByText("Backend failed")).toBeVisible()
  await page.getByRole("link", { name: "Frontend" }).click()
  await expect(page.getByRole("dialog", { name: "Workflow run 9" })).toBeVisible()
  await page.keyboard.press("Escape")

  const emptyContext = await browser.newContext()
  const empty = await emptyContext.newPage()
  await fakeGitHub(empty, { checks: [] })
  await signIn(empty)
  await empty.goto("/#/pr/acme/api/7?tab=checks")
  await expect(empty.getByText("No checks reported for the head commit.")).toBeVisible()
  await emptyContext.close()
})

test("wide check runs open in a dialog and preserve the PR when closed", async ({ page }) => {
  await fakeGitHub(page, {
    checks: [{ name: "Frontend", status: "COMPLETED", conclusion: "SUCCESS", workflowName: "CI" }],
  })
  await signIn(page)
  await page.goto("/#/pr/acme/api/7?tab=conversation")
  await sizePane(page, 1200)
  const comment = page.getByPlaceholder("Leave a comment (Markdown). Ctrl+Enter to send.")
  await comment.fill("keep the PR draft")
  const checkLink = checks(page).getByRole("link", { name: "Frontend" })
  await checkLink.click()
  const dialog = page.getByRole("dialog", { name: "Workflow run 9" })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/run=9.*job=99/)
  await page.keyboard.press("3")
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(dialog).toBeHidden()
  await expect(comment).toHaveValue("keep the PR draft")
  await checkLink.click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/tab=pulls/)
  await expect(page).toHaveURL(/pull=acme%2Fapi%237/)
  await expect(page).not.toHaveURL(/(?:run|job)=\d+/)
  await expect(comment).toHaveValue("keep the PR draft")
  await expect(checkLink).toBeFocused()
  await expect(checks(page)).toBeVisible()
})
