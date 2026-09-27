import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

test("failed sign-in shows a toast and keeps the recovery message", async ({ page }) => {
  await fakeGitHub(page)
  await page.route("https://api.github.com/user", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Bad credentials" }),
    }),
  )
  await page.goto("/")
  await page.getByLabel("Personal access token").fill("ghp_invalid")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Sign-in failed" }),
  ).toBeVisible()
  await expect(page.getByRole("alert")).toContainText("Bad credentials")
  await expect(page.getByLabel("Personal access token")).toHaveValue("ghp_invalid")
})

test("sign in, see groups and pull requests, open a pull request", async ({ page }) => {
  await fakeGitHub(page)
  await page.goto("/")

  await page.getByLabel("Personal access token").fill("ghp_test")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(
    page.getByRole("complementary").getByRole("link", { name: "acme", exact: true }),
  ).toBeVisible()
  await page.getByRole("link", { name: "Involving me", exact: true }).click()
  await expect(page.getByText("Speed up the diff view")).toBeVisible()

  await page.getByLabel("Inbox scope").selectOption("involving")
  await expect(page.getByText("Speed up the diff view")).toBeVisible()
  await page.getByLabel("Filter inbox").fill("no matching pull")
  await expect(page.getByText("No active pull requests.")).toBeVisible()
  await page.getByLabel("Filter inbox").fill("")
  await page
    .getByRole("button", { name: "acme/api #7: Speed up the diff view", exact: true })
    .click()
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
  await expect(page.getByText("Looks promising.")).toBeVisible()

  await page.keyboard.press("3")
  await expect(page.getByText("test", { exact: true })).toBeVisible()
})

test("the command palette opens a pull request", async ({ page }) => {
  await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/inbox")
  await expect(page.getByText("Speed up the diff view")).toBeVisible()

  await page.keyboard.press("Control+k")
  await page.getByPlaceholder(/Pull requests, groups/).fill("diff view")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
})
