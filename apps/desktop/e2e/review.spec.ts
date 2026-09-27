import { expect, type Route, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

test("a failed PR refresh shows one toast and preserves loaded content", async ({ page }) => {
  await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  const filesUrl = "https://api.github.com/repos/acme/api/pulls/7/files*"
  const initialFilesResponse = page.waitForResponse(filesUrl)
  await page.goto("/#/pr/acme/api/7")
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
  // Detail loads before the initial files sync finishes; refresh joins that in-flight sync.
  await (await initialFilesResponse).finished()
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }).locator("svg"),
  ).not.toHaveClass(/animate-spin/)

  let failedRequests = 0
  const failFiles = async (route: Route) => {
    failedRequests++
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Files temporarily unavailable" }),
    })
  }
  await page.route(filesUrl, failFiles)
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  const errorToast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Could not load acme/api #7" })
  await expect(errorToast).toBeVisible()
  await expect(errorToast).toContainText("Files temporarily unavailable")
  await expect(page.getByText("Virtualizes the diff rows.")).toBeVisible()
  await expect(page.getByText("Could not load:")).toHaveCount(0)
  await page.getByRole("tab", { name: "Checks" }).click()
  await expect(errorToast).toHaveCount(1)

  // Once dismissed, an identical background failure must not reopen the toast.
  await expect(errorToast).toHaveCount(0)
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect.poll(() => failedRequests).toBe(2)
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }).locator("svg"),
  ).not.toHaveClass(/animate-spin/)
  await expect(errorToast).toHaveCount(0)

  await page.unroute(filesUrl)
  const recoveryResponse = page.waitForResponse(filesUrl)
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }).locator("svg"),
  ).not.toHaveClass(/animate-spin/)
  await (await recoveryResponse).finished()
  await page.route(filesUrl, failFiles)
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(errorToast).toBeVisible()
  await page.getByRole("complementary").getByRole("link", { name: "Inbox", exact: true }).click()
  await expect(errorToast).toHaveCount(0)
})

test("a draft line comment is submitted with the review", async ({ page }) => {
  const requests = await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/pr/acme/api/7?tab=files")

  const line = page.locator("div.group", { hasText: "const rows = visible()" })
  // Select the right-side line gutter and use the shortcut because virtualized rows can move under a hover.
  await line.getByRole("button").nth(1).click()
  await page.keyboard.press("c")
  await page.getByPlaceholder(/Ctrl\+Enter to save/).fill("Why visible()?")
  await page.getByRole("button", { name: "Save draft" }).click()
  await expect(page.getByText("Why visible()?")).toBeVisible()

  await page.getByRole("button", { name: "Review (1)" }).click()
  await page.getByLabel(/Request changes/).check()
  await page.getByPlaceholder(/Summary/).fill("Needs a comment")
  await page.getByRole("button", { name: "Submit review" }).click()
  await expect(page.getByText("Review submitted")).toBeVisible()

  const review = requests.find((r) => r.path === "/repos/acme/api/pulls/7/reviews")
  expect(review?.body).toEqual({
    commit_id: "abc123",
    event: "REQUEST_CHANGES",
    body: "Needs a comment",
    comments: [{ path: "src/diff.ts", body: "Why visible()?", line: 2, side: "RIGHT" }],
  })
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible()
})
