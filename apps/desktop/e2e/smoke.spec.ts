import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

test("sign in, see groups and pull requests, open a pull request", async ({ page }) => {
  await fakeGitHub(page)
  await page.goto("/")

  await page.getByLabel("Personal access token").fill("ghp_test")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page.getByRole("link", { name: /acme/ })).toBeVisible()
  await expect(page.getByText("Speed up the diff view")).toBeVisible()

  await page.getByRole("tab", { name: "Review requested" }).click()
  await expect(page.getByText("Speed up the diff view")).toBeVisible()
  await page.getByRole("tab", { name: "Mine" }).click()
  await expect(page.getByText("No open pull requests.")).toBeVisible()
  await page.getByRole("tab", { name: "All open" }).click()

  await page.keyboard.press("Enter")
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
  await expect(page.getByText("Looks promising.")).toBeVisible()

  await page.keyboard.press("3")
  await expect(page.getByText("test", { exact: true })).toBeVisible()
})

test("the command palette opens a pull request", async ({ page }) => {
  await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/")
  await expect(page.getByText("Speed up the diff view")).toBeVisible()

  await page.keyboard.press("Control+k")
  await page.getByPlaceholder(/Pull requests, groups/).fill("diff view")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
})
