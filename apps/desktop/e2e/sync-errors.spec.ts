import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

test("inbox sync failures toast once and retain cached pull requests", async ({ page }) => {
  await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/inbox")
  await expect(page.getByText("Speed up the diff view", { exact: true })).toBeVisible()
  await page.route("https://api.github.com/graphql", async (route) => {
    if (!String(route.request().postDataJSON()?.query).includes("SearchPulls"))
      return route.fallback()
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Search unavailable" }),
    })
  })
  await page.getByRole("button", { name: "Refresh inbox", exact: true }).click()
  const errors = page.locator('[data-sonner-toast][data-type="error"]')
  await expect(errors).toHaveCount(1)
  await expect(errors).toContainText("Could not refresh inbox")
  await expect(page.getByText("Speed up the diff view", { exact: true })).toBeVisible()
})

test("startup failure shows a toast and retains the blocking explanation", async ({ page }) => {
  await fakeGitHub(page)
  await page.route("https://api.github.com/user", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "GitHub temporarily unavailable" }),
    }),
  )
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/")
  await expect(page.locator("[data-sonner-toast]")).toContainText("Could not start GitHub-client")
  await expect(page.getByText(/Could not start:/)).toContainText("GitHub temporarily unavailable")
})
