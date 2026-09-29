import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

test.beforeEach(async ({ page }) => {
  await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
})

test("repository breadcrumbs navigate home, owner, and code root while Back restores context", async ({
  page,
}) => {
  await page.goto("/#/repo/acme/api?tab=pulls&pull=acme%2Fapi%237")
  const header = page
    .locator("header")
    .filter({ has: page.getByRole("heading", { name: "acme/api", exact: true }) })
  await expect(header.getByRole("link", { name: "acme", exact: true })).toHaveAttribute(
    "href",
    /\/org\/acme/,
  )
  await header.getByRole("link", { name: "api", exact: true }).click()
  await expect(page).toHaveURL(/tab=code/)
  await expect(page).not.toHaveURL(/pull=/)
  await expect(page.getByRole("heading", { name: "Repository guide" })).toBeVisible()
  await header.getByRole("button", { name: "Back", exact: true }).click()
  await expect(page).toHaveURL(/tab=pulls.*pull=/)
  await header.getByRole("link", { name: "acme", exact: true }).click()
  await expect(page).toHaveURL(/\/org\/acme.*tab=repositories/)
  await page.goBack()
  await header.getByRole("link", { name: "Home", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Organizations and teams" })).toBeVisible()
})

test("direct repository entry has a safe Back destination and a compact two-row header", async ({
  page,
}, info) => {
  await page.goto("/#/repo/acme/api")
  const header = page
    .locator("header")
    .filter({ has: page.getByRole("heading", { name: "acme/api", exact: true }) })
  await expect(header.getByRole("link", { name: "acme", exact: true })).toHaveAttribute(
    "href",
    /\/org\/acme/,
  )
  await expect(page.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  for (const width of [1400, 700, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const box = await header.boundingBox()
    expect(box!.height).toBeLessThanOrEqual(112)
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    )
    const tabs = await header
      .getByRole("navigation", { name: "Repository navigation" })
      .boundingBox()
    const refresh = await header.getByRole("button", { name: "Refresh repository" }).boundingBox()
    expect(Math.abs(tabs!.y + tabs!.height / 2 - refresh!.y - refresh!.height / 2)).toBeLessThan(3)
    await page.screenshot({ path: info.outputPath(`repository-header-${width}.png`) })
  }
  await header.getByRole("button", { name: "Back", exact: true }).click()
  await expect(page).toHaveURL(/\/org\/acme.*tab=repositories/)
})

test("personal owner links to its GitHub profile and direct Back falls back to Home", async ({
  page,
}) => {
  await page.goto("/#/repo/octo/personal")
  const header = page
    .locator("header")
    .filter({ has: page.getByRole("heading", { name: "octo/personal", exact: true }) })
  await expect(header.getByRole("link", { name: "octo", exact: true })).toHaveAttribute(
    "href",
    "https://github.com/octo",
  )
  await header.getByRole("button", { name: "Back", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Organizations and teams" })).toBeVisible()
})
