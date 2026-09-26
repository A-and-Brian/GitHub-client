import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

async function signIn(page: import("@playwright/test").Page) {
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "PR inbox", exact: true })).toBeVisible()
}

test("nested teams retain repository context and open settings", async ({ page }) => {
  await fakeGitHub(page, { hierarchy: true })
  await signIn(page)
  await expect(page.getByRole("link", { name: "Backend", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Collapse acme/Engineering", exact: true }).click()
  await expect(page.getByRole("link", { name: "Backend", exact: true })).toBeHidden()
  await page.getByRole("button", { name: "Expand acme/Engineering", exact: true }).click()
  await page.getByRole("link", { name: "Backend", exact: true }).click()
  await expect(page.getByRole("heading", { name: "acme/api", exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("API service")
})

test("settle is local, persists across reload, and failures remain discoverable", async ({
  page,
}) => {
  const requests = await fakeGitHub(page, { checkState: "FAILURE" })
  await signIn(page)
  const list = page.getByRole("region", { name: "Pull request inbox", exact: true })
  await expect(list.getByText("Speed up the diff view", { exact: true })).toHaveCount(1)
  await list.getByText("Speed up the diff view", { exact: true }).click()
  await page.getByRole("button", { name: "Settle", exact: true }).click()
  await expect(list.getByText("Speed up the diff view", { exact: true })).toHaveCount(0)
  await expect(
    page.getByText("Settled locally. GitHub PR unchanged.", { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByText("No pull requests in this view.")).toBeVisible()
  await page.getByRole("button", { name: "Failures", exact: true }).click()
  await list.getByText("Speed up the diff view", { exact: true }).click()
  await expect(page.getByText("Settled locally · GitHub PR unchanged")).toBeVisible()
  await page.getByRole("button", { name: "Restore to Active", exact: true }).click()
  await page.getByRole("button", { name: "Active", exact: true }).click()
  await expect(list.getByText("Speed up the diff view", { exact: true })).toHaveCount(1)
  expect(requests.filter((r) => r.method !== "GET" && r.path !== "/graphql")).toEqual([])
})

test("snooze survives reload and can be restored", async ({ page }) => {
  await fakeGitHub(page)
  await signIn(page)
  await page.getByText("Speed up the diff view", { exact: true }).click()
  await page.getByRole("button", { name: "Snooze", exact: true }).click()
  await page.getByRole("button", { name: "In one hour", exact: true }).click()
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Snoozed until" }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: "Snoozed", exact: true }).click()
  await page.getByText("Speed up the diff view", { exact: true }).click()
  await expect(page.getByRole("button", { name: "Restore to Active" })).toBeVisible()
  await page.getByRole("button", { name: "Restore to Active" }).click()
  await page.getByRole("button", { name: "Active", exact: true }).click()
  await expect(page.getByText("Speed up the diff view", { exact: true })).toBeVisible()
})

test("settings save changes to GitHub and preserve the draft on rejection", async ({ page }) => {
  const options = { settingsError: 0 }
  const requests = await fakeGitHub(page, options)
  await signIn(page)
  await page.goto("/#/settings/acme/api")
  await page.getByLabel("Description", { exact: true }).fill("Updated API")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled()
  expect(requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([
    { description: "Updated API" },
  ])
  options.settingsError = 403
  await page.getByLabel("Description", { exact: true }).fill("Retained draft")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByRole("alert")).toContainText("Organization policy")
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Retained draft")
})

test("settings are read-only without repository admin access", async ({ page }) => {
  const requests = await fakeGitHub(page, { admin: false })
  await signIn(page)
  await page.goto("/#/settings/acme/api")
  await expect(page.getByLabel("Description", { exact: true })).toBeDisabled()
  await expect(page.getByText(/Settings are read-only/)).toBeVisible()
  expect(requests.filter((r) => r.method === "PATCH")).toEqual([])
})

test("inbox and organization navigation work at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fakeGitHub(page, { hierarchy: true })
  await signIn(page)
  await page.getByRole("button", { name: "Navigation", exact: true }).click()
  await page.getByRole("link", { name: "Backend", exact: true }).click()
  await expect(page.getByRole("button", { name: "Close navigation" })).toHaveCount(0)
  await page.getByRole("button", { name: "Navigation", exact: true }).click()
  await page.getByRole("link", { name: "Inbox", exact: true }).click()
  await page.getByText("Speed up the diff view", { exact: true }).click()
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await expect(page.getByRole("region", { name: "Pull request inbox", exact: true })).toBeVisible()
})
