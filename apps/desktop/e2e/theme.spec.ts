import { expect, type Page, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

async function expectTheme(page: Page, theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveClass(theme)
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme)
}

async function openAccountMenu(page: Page) {
  await page.getByRole("button", { name: "octo", exact: true }).click()
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`fresh sessions follow the ${colorScheme} system theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto("/")
    await expect(page.getByLabel("Personal access token")).toBeVisible()
    await expectTheme(page, colorScheme)
    const opposite = colorScheme === "dark" ? "light" : "dark"
    await page.emulateMedia({ colorScheme: opposite })
    await expectTheme(page, opposite)
  })
}

test("appearance choices persist and both menus can restore System", async ({ page }) => {
  await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/")
  await openAccountMenu(page)
  await expect(page.getByRole("menuitemradio", { name: "System", exact: true })).toBeChecked()
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click()
  await expectTheme(page, "dark")
  await page.reload()
  await expectTheme(page, "dark")
  await openAccountMenu(page)
  await expect(page.getByRole("menuitemradio", { name: "Dark", exact: true })).toBeChecked()
  await page.keyboard.press("Escape")

  await page.keyboard.press("Control+k")
  await page.getByPlaceholder(/Pull requests, groups/).fill("Use system theme")
  await page.keyboard.press("Enter")
  await expectTheme(page, "light")
  await page.emulateMedia({ colorScheme: "dark" })
  await expectTheme(page, "dark")
  await openAccountMenu(page)
  await expect(page.getByRole("menuitemradio", { name: "System", exact: true })).toBeChecked()
  await page.keyboard.press("Escape")

  await page.keyboard.press("Control+k")
  await page.getByPlaceholder(/Pull requests, groups/).fill("Use light theme")
  await page.keyboard.press("Enter")
  await expectTheme(page, "light")
  await page.emulateMedia({ colorScheme: "light" })
  await page.emulateMedia({ colorScheme: "dark" })
  await expectTheme(page, "light")
  await page.reload()
  await expectTheme(page, "light")
  await openAccountMenu(page)
  await expect(page.getByRole("menuitemradio", { name: "Light", exact: true })).toBeChecked()
  await page.getByRole("menuitemradio", { name: "System", exact: true }).click()
  await expectTheme(page, "dark")
})
