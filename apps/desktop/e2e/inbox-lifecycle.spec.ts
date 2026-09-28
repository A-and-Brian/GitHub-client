import { expect, type Page, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

const row = (page: Page, section: string) =>
  page
    .getByRole("list", { name: `${section} pull requests`, exact: true })
    .locator('[data-pull-id="PR_1"]')

async function openInbox(page: Page, path = "/#/inbox") {
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto(path)
  await expect(row(page, "Active")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Refresh inbox" }).locator(".animate-spin"),
  ).toHaveCount(0)
}

test("merging settles the PR and retains it after refresh and reload", async ({ page }) => {
  const requests = await fakeGitHub(page)
  await openInbox(page)
  await row(page, "Active").getByText("Speed up the diff view", { exact: true }).click()
  await page.getByRole("button", { name: "Squash and merge", exact: true }).click()
  await page.getByRole("button", { name: "Confirm merge", exact: true }).click()
  await expect(page.getByText("Merged #7", { exact: true })).toBeVisible()
  await expect(row(page, "Settled")).toBeVisible()
  await expect(row(page, "Active")).toHaveCount(0)
  await page.getByRole("button", { name: "Refresh inbox" }).click()
  await expect(
    page.getByRole("button", { name: "Refresh inbox" }).locator(".animate-spin"),
  ).toHaveCount(0)
  await page.reload()
  await expect(row(page, "Settled")).toBeVisible()
  expect(requests.filter((request) => request.path.endsWith("/merge"))).toHaveLength(1)
})

test("a rejected merge keeps the PR active", async ({ page }) => {
  await fakeGitHub(page, { mergeError: 409 })
  await openInbox(page)
  await row(page, "Active").getByText("Speed up the diff view", { exact: true }).click()
  await page.getByRole("button", { name: "Squash and merge", exact: true }).click()
  await page.getByRole("button", { name: "Confirm merge", exact: true }).click()
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Merge failed" }),
  ).toBeVisible()
  await expect(row(page, "Active")).toBeVisible()
  await expect(row(page, "Settled")).toHaveCount(0)
})

test("detail refresh settles and reopens a PR independently of its group search", async ({
  page,
}) => {
  const options = { pullCount: 1, pullStates: {} as Record<number, "OPEN" | "CLOSED" | "MERGED"> }
  await fakeGitHub(page, options)
  await openInbox(page)
  await row(page, "Active").getByText("Speed up the diff view", { exact: true }).click()
  const refresh = page.getByRole("button", { name: "Refresh", exact: true })
  await expect(refresh.locator(".animate-spin")).toHaveCount(0)
  options.pullStates[7] = "CLOSED"
  await refresh.click()
  await expect(row(page, "Settled")).toBeVisible()
  options.pullCount = 0
  options.pullStates[7] = "OPEN"
  await refresh.click()
  await expect(row(page, "Active")).toBeVisible()
  await expect(row(page, "Settled")).toHaveCount(0)
})

test("a slow GitHub refresh does not block local settlement", async ({ page }) => {
  await fakeGitHub(page)
  await openInbox(page)
  let releaseRefresh: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  let refreshStarted = false
  await page.route("https://api.github.com/graphql", async (route) => {
    if (route.request().postDataJSON().query.includes("SearchPulls")) {
      refreshStarted = true
      await pending
    }
    await route.fallback()
  })
  try {
    await page.getByRole("button", { name: "Refresh inbox" }).click()
    await expect.poll(() => refreshStarted).toBe(true)
    await row(page, "Active")
      .getByRole("button", { name: /^Actions for/ })
      .click()
    await page.getByRole("menuitem", { name: "Settle locally", exact: true }).click()
    await expect(row(page, "Settled")).toBeVisible()
    await expect(
      page
        .locator("[data-sonner-toast]")
        .getByText("Settled locally · GitHub PR unchanged", { exact: true }),
    ).toBeVisible()
  } finally {
    releaseRefresh()
  }
  await expect(
    page.getByRole("button", { name: "Refresh inbox" }).locator(".animate-spin"),
  ).toHaveCount(0)
  await expect(row(page, "Settled")).toBeVisible()
})

for (const scoped of [false, true]) {
  test(`an external close settles a known ${scoped ? "repository-only" : "global"} PR and reopening restores it`, async ({
    page,
  }) => {
    const options = {
      pullCount: scoped ? 0 : 1,
      pullStates: {} as Record<number, "OPEN" | "CLOSED" | "MERGED">,
    }
    await fakeGitHub(page, options)
    await openInbox(page, scoped ? "/#/repo/acme/api?tab=pulls" : "/#/inbox")
    // A detail selection is deliberately unnecessary: list sync must discover closure.
    options.pullStates[7] = "CLOSED"
    await page.getByRole("button", { name: "Refresh inbox" }).click()
    await expect(row(page, "Settled")).toBeVisible()
    await expect(row(page, "Active")).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Refresh inbox" }).locator(".animate-spin"),
    ).toHaveCount(0)
    await page.reload()
    await expect(row(page, "Settled")).toBeVisible()
    await expect(row(page, "Settled").getByRole("button", { name: /^Actions for/ })).toHaveCount(0)
    options.pullStates[7] = "OPEN"
    await page.getByRole("button", { name: "Refresh inbox" }).click()
    await expect(row(page, "Active")).toBeVisible()
    await expect(row(page, "Settled")).toHaveCount(0)
  })
}
