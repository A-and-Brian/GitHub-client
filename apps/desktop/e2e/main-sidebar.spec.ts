import { expect, type Page, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

async function signIn(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/inbox")
  await expect(page.getByRole("complementary", { name: "Pull request inbox" })).toHaveAttribute(
    "data-inbox-ready",
    "true",
  )
}

test("main sidebar resizes with pointer and keyboard, persists, and keeps the mobile drawer", async ({
  page,
}, info) => {
  await fakeGitHub(page, { hierarchy: true })
  await signIn(page)
  const sidebar = page.getByRole("complementary", { name: "Main navigation" })
  const resize = page.getByRole("separator", { name: "Resize main sidebar" })
  const width = () => sidebar.evaluate((element) => element.getBoundingClientRect().width)
  await expect.poll(width).toBe(240)
  const handle = await resize.boundingBox()
  if (!handle) throw new Error("Main sidebar resize handle is missing")
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + 100, { steps: 5 })
  await page.mouse.up()
  await expect.poll(width).toBe(320)
  await resize.focus()
  await page.keyboard.press("ArrowRight")
  await expect.poll(width).toBe(336)
  await page.reload()
  await expect.poll(width).toBe(336)
  await resize.focus()
  await page.keyboard.press("Home")
  await page.keyboard.press("ArrowLeft")
  await expect.poll(width).toBe(200)
  await page.keyboard.press("End")
  await page.keyboard.press("ArrowRight")
  await expect.poll(width).toBe(400)
  await page.screenshot({ path: info.outputPath("main-sidebar.png") })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Navigation", exact: true }).click()
  await expect(sidebar).toBeVisible()
  await expect.poll(width).toBe(240)
  await expect(resize).toBeHidden()
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
  // An open mobile drawer becomes a normal sidebar when returning to desktop.
  await page.setViewportSize({ width: 1400, height: 900 })
  await expect.poll(width).toBe(400)
  await expect(sidebar).toHaveCSS("position", "relative")
  await expect(resize).toBeVisible()
})

for (const pullCount of [0, 3]) {
  test(`sidebar shows ${pullCount} PRs per feed without duplicate personal navigation`, async ({
    page,
  }) => {
    await fakeGitHub(page, { hierarchy: true, pullCount })
    await signIn(page)
    const sidebar = page.getByRole("complementary", { name: "Main navigation" })
    await expect(sidebar.getByRole("link", { name: "Involving me" })).toHaveCount(0)
    await expect(sidebar.getByRole("separator")).toHaveCount(2)
    await expect(sidebar.locator('hr:not([aria-orientation="vertical"])')).toBeVisible()
    // The same PRs occur in several feeds; Inbox must count each PR only once.
    await expect(sidebar.getByRole("link", { name: "Inbox", exact: true })).toHaveText(
      `Inbox${pullCount}`,
    )
    for (const name of ["acme", "Engineering", "Backend"]) {
      const row = sidebar.getByRole("link", { name, exact: true }).locator("..")
      await expect(row).toHaveText(`${name}${pullCount}`)
    }
  })
}
