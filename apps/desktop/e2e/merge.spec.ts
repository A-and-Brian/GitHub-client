import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

async function openPull(page: Page) {
  await page.addInitScript(() => {
    window.confirm = () => {
      throw new Error("Native confirmation must not be used")
    }
    sessionStorage.setItem("github-client.dev-token", "ghp_test")
  })
  await page.goto("/#/pr/acme/api/7?tab=conversation")
  return page.getByRole("button", { name: "Squash and merge" })
}

test("merge confirmation can be canceled without sending a request", async ({ page }) => {
  const requests = await fakeGitHub(page)
  const merge = await openPull(page)

  await merge.click()
  const confirm = page.getByRole("button", { name: "Confirm merge" })
  await expect(confirm).toBeVisible()
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible()
  await expect(page.getByText(/Squash and merge for acme\/api#7 into main/i)).toBeVisible()
  await expect(page.getByRole("combobox")).toHaveCount(0)
  await page.getByRole("button", { name: "Cancel" }).click()

  await expect(merge).toBeVisible()
  expect(requests.filter((request) => request.path.endsWith("/merge"))).toHaveLength(0)
})

test("Escape cancels confirmation and returns focus to the merge button", async ({ page }) => {
  await fakeGitHub(page)
  const merge = await openPull(page)

  await merge.click()
  await expect(page.getByRole("button", { name: "Confirm merge" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(merge).toBeFocused()
})

test("confirmation submits the selected method and head SHA once while pending", async ({
  page,
}) => {
  let releaseMerge!: () => void
  const mergeGate = new Promise<void>((resolve) => {
    releaseMerge = resolve
  })
  const requests = await fakeGitHub(page, { mergeGate })
  await openPull(page)
  await page.getByRole("combobox").click()
  await page.getByRole("option", { name: "Create a merge commit" }).click()
  const merge = page.getByRole("button", { name: "Create a merge commit" })
  await merge.click()
  const confirm = page.getByRole("button", { name: "Confirm merge" })
  const before = await confirm.boundingBox()
  await confirm.click()

  const pending = page.getByRole("button", { name: "Merging…" })
  await expect(pending).toBeDisabled()
  expect(await pending.boundingBox()).toEqual(before)
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled()
  await expect
    .poll(() => requests.filter((request) => request.path.endsWith("/merge")).length)
    .toBe(1)
  const mergeRequests = requests.filter(
    (request) => request.path === "/repos/acme/api/pulls/7/merge",
  )
  expect(mergeRequests).toHaveLength(1)
  expect(mergeRequests[0]).toMatchObject({
    method: "PUT",
    body: { merge_method: "merge", sha: "abc123" },
  })
  await expect(page.getByRole("button", { name: "Confirm merge" })).toHaveCount(0)
  await pending.dispatchEvent("click")
  expect(
    requests.filter((request) => request.path === "/repos/acme/api/pulls/7/merge"),
  ).toHaveLength(1)
  releaseMerge()
  await expect(page.getByText("Merged #7")).toBeVisible()
  await expect(page.getByLabel("Merged")).toBeVisible()
  await expect(page.getByRole("button", { name: /merge/i })).toHaveCount(0)
})

test("failed merge remains retryable", async ({ page }) => {
  const requests = await fakeGitHub(page, { mergeError: 409 })
  const merge = await openPull(page)
  await merge.click()
  await page.getByRole("button", { name: "Confirm merge" }).click()

  await expect(page.getByText(/Merge failed: Merge is blocked by repository policy/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirm merge" })).toBeEnabled()
  await page.getByRole("button", { name: "Confirm merge" }).click()
  await expect
    .poll(() => requests.filter((request) => request.path.endsWith("/merge")).length)
    .toBe(2)
})

test("draft pull requests cannot be merged", async ({ page }) => {
  const requests = await fakeGitHub(page, { draft: true })
  await openPull(page)
  await expect(page.getByRole("button", { name: "Squash and merge" })).toBeDisabled()
  expect(requests.filter((request) => request.path.endsWith("/merge"))).toHaveLength(0)
})

test("conflicting pull requests cannot be merged", async ({ page }) => {
  const requests = await fakeGitHub(page, { mergeable: "CONFLICTING" })
  await openPull(page)
  await expect(page.getByRole("button", { name: "Squash and merge" })).toBeDisabled()
  await expect(page.getByText("Conflicts")).toBeVisible()
  expect(requests.filter((request) => request.path.endsWith("/merge"))).toHaveLength(0)
})

test("a changed head revision invalidates confirmation", async ({ page }) => {
  const options: { headOid?: string } = {}
  const requests = await fakeGitHub(page, options)
  const merge = await openPull(page)
  await merge.click()
  await expect(page.getByRole("button", { name: "Confirm merge" })).toBeVisible()

  options.headOid = "new456"
  await page.getByRole("button", { name: "Refresh" }).click()
  await expect(page.getByRole("button", { name: "Confirm merge" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Squash and merge" })).toBeVisible()
  expect(requests.filter((request) => request.path.endsWith("/merge"))).toHaveLength(0)
})

test("a repository with one merge method can be confirmed", async ({ page }) => {
  const requests = await fakeGitHub(page, { mergeMethods: ["squash"] })
  const merge = await openPull(page)
  await expect(page.getByRole("combobox")).toHaveCount(0)
  await merge.click()
  await expect(page.getByRole("button", { name: "Confirm merge" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible()
  expect(requests.filter((request) => request.path.endsWith("/merge"))).toHaveLength(0)
})

for (const viewport of [1280, 760]) {
  test(`merge button keeps its size through confirmation at ${viewport}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport, height: 900 })
    await fakeGitHub(page)
    const merge = await openPull(page)
    await expect(merge).toBeVisible()
    const before = await merge.boundingBox()
    expect(before).not.toBeNull()

    await merge.click()
    const confirm = page.getByRole("button", { name: "Confirm merge" })
    const after = await confirm.boundingBox()
    expect(after).not.toBeNull()
    expect(after!.width).toBeCloseTo(before!.width, 0)
    expect(after!.height).toBeCloseTo(before!.height, 0)
    expect(after!.x).toBeCloseTo(before!.x, 0)
    expect(after!.y).toBeCloseTo(before!.y, 0)
  })
}
