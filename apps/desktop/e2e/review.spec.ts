import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

test("a draft line comment is submitted with the review", async ({ page }) => {
  const requests = await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/pr/acme/api/7?tab=files")

  const line = page.locator("div.group", { hasText: "const rows = visible()" })
  await line.hover()
  await line.getByRole("button", { name: "Comment on this line" }).click()
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
