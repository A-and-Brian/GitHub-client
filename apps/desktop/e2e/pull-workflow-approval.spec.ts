import { expect, type Page, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

type PendingRun = {
  id: number
  name: string
  event: "pull_request" | "pull_request_target"
  conclusion: "action_required"
  head_sha: string
  pull_requests: Array<{ number: number; head: { sha: string } }>
}

const pendingRun = (id: number, name: string, number = 7, headSha = "abc123"): PendingRun => ({
  id,
  name,
  event: "pull_request",
  conclusion: "action_required",
  head_sha: headSha,
  pull_requests: [{ number, head: { sha: headSha } }],
})

const json = (route: import("@playwright/test").Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

async function openPull(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/inbox")
  await expect(page.getByRole("heading", { name: "PR inbox", exact: true })).toBeVisible()
  await page.getByText("Speed up the diff view", { exact: true }).click()
  await expect(page.getByRole("heading", { name: "Speed up the diff view" })).toBeVisible()
}

async function stubApprovalApi(page: Page, runs: PendingRun[], failIds: Set<number> = new Set()) {
  const approved = new Set<number>()
  const requests: number[] = []
  await page.route("https://api.github.com/repos/acme/api/actions/runs**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const approvalId = url.pathname.match(/\/actions\/runs\/(\d+)\/approve$/)
    if (request.method() === "POST" && approvalId) {
      const id = Number(approvalId[1])
      requests.push(id)
      if (failIds.has(id))
        return json(route, { message: "Repository policy blocked approval" }, 403)
      approved.add(id)
      return route.fulfill({ status: 201, body: "" })
    }
    if (/\/actions\/runs\/\d+\/jobs$/.test(url.pathname)) {
      return json(route, { total_count: 0, jobs: [] })
    }
    if (url.pathname === "/repos/acme/api/actions/runs") {
      const event = url.searchParams.get("event")
      return json(route, {
        total_count: runs.length,
        workflow_runs: runs.filter(
          (run) => !approved.has(run.id) && (!event || run.event === event),
        ),
      })
    }
    return route.fallback()
  })
  return requests
}

test("shows and approves no-job workflows in the wide rail and narrow Checks tab", async ({
  page,
}, info) => {
  await fakeGitHub(page, { checks: [] })
  const requests = await stubApprovalApi(page, [pendingRun(901, "CI")])
  await page.setViewportSize({ width: 2000, height: 1100 })
  await openPull(page)

  const banner = page.getByRole("region", { name: "Workflow approval required" })
  await expect(banner.getByRole("heading", { name: "1 workflow awaiting approval" })).toBeVisible()
  await expect(banner.getByText("CI", { exact: true })).toBeVisible()
  await expect(page.getByText("No checks reported for the head commit.")).toBeVisible()
  await page.screenshot({ path: info.outputPath("approval-wide-rail.png") })

  await page.setViewportSize({ width: 850, height: 1000 })
  const checksTab = page.getByRole("tab", { name: /Checks/ })
  await expect(checksTab).toBeVisible()
  await checksTab.click()
  await expect(checksTab).toHaveAttribute("aria-selected", "true")
  await expect(banner).toBeVisible()
  await page.screenshot({ path: info.outputPath("approval-narrow-checks.png") })

  await banner.getByRole("button", { name: "Approve and run" }).click()
  const dialog = page.getByRole("dialog", { name: "Approve workflows to run" })
  await expect(dialog).toContainText("CI")
  await expect(dialog).toContainText("allows its PR code to execute")
  await dialog.getByRole("button", { name: "Approve and run 1" }).click()

  await expect(page.locator("[data-sonner-toast]")).toContainText("Workflow approval requested")
  await expect(banner).toHaveCount(0)
  expect(requests).toEqual([901])
})

test("keeps failed workflows available after a partial approval", async ({ page }) => {
  await fakeGitHub(page, { checks: [] })
  const requests = await stubApprovalApi(
    page,
    [pendingRun(901, "CI"), pendingRun(902, "Web")],
    new Set([902]),
  )
  await page.setViewportSize({ width: 850, height: 1000 })
  await openPull(page)
  await page.getByRole("tab", { name: /Checks/ }).click()

  const banner = page.getByRole("region", { name: "Workflow approval required" })
  await expect(banner.getByRole("heading", { name: "2 workflows awaiting approval" })).toBeVisible()
  await banner.getByRole("button", { name: "Approve and run" }).click()
  const dialog = page.getByRole("dialog", { name: "Approve workflows to run" })
  await expect(dialog).toContainText("CI")
  await expect(dialog).toContainText("Web")
  await dialog.getByRole("button", { name: "Approve and run 2" }).click()

  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Repository policy blocked approval",
  )
  await page.getByRole("dialog").getByRole("button", { name: "Back" }).click()
  await expect(banner.getByRole("heading", { name: "1 workflow awaiting approval" })).toBeVisible()
  await expect(banner.getByText("Web", { exact: true })).toBeVisible()
  await expect(banner.getByText("CI", { exact: true })).toHaveCount(0)
  expect(requests.sort()).toEqual([901, 902])
})

test("late approval discovery from an earlier PR cannot replace the selected PR candidates", async ({
  page,
}) => {
  await fakeGitHub(page, { checks: [], pullCount: 2, headOids: { 8: "head-eight" } })
  let releaseOldResponse!: () => void
  const holdOldResponse = new Promise<void>((resolve) => {
    releaseOldResponse = resolve
  })
  let prQueryCount = 0
  let waitForLateTarget = false
  let finishOldDiscovery!: () => void
  const oldDiscoveryFinished = new Promise<void>((resolve) => {
    finishOldDiscovery = resolve
  })
  await page.route("https://api.github.com/repos/acme/api/actions/runs**", async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get("status") !== "action_required") return route.fallback()
    if (url.searchParams.get("event") === "pull_request") {
      prQueryCount++
      const headSha = url.searchParams.get("head_sha")
      if (headSha === "abc123" && prQueryCount === 1) {
        await holdOldResponse
        return json(route, {
          total_count: 1,
          workflow_runs: [pendingRun(910, "Old PR workflow", 7)],
        })
      }
      if (headSha === "abc123") {
        return json(route, {
          total_count: 1,
          workflow_runs: [pendingRun(910, "Old PR workflow", 7)],
        })
      }
      return json(route, {
        total_count: 1,
        workflow_runs: [pendingRun(920, "New PR workflow", 8, "head-eight")],
      })
    }
    if (waitForLateTarget) {
      waitForLateTarget = false
      finishOldDiscovery()
    }
    return json(route, { total_count: 0, workflow_runs: [] })
  })
  await page.setViewportSize({ width: 2000, height: 1100 })
  await openPull(page)
  await expect.poll(() => prQueryCount).toBeGreaterThan(0)

  await page
    .getByRole("complementary", { name: "Pull request inbox" })
    .getByText("Follow-up pull request 1", { exact: true })
    .click()
  await expect(page.getByRole("heading", { name: "Follow-up pull request 1" })).toBeVisible()
  const banner = page.getByRole("region", { name: "Workflow approval required" })
  await expect(banner.getByText("New PR workflow", { exact: true })).toBeVisible()
  waitForLateTarget = true
  releaseOldResponse()
  await oldDiscoveryFinished
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  await expect(banner.getByText("New PR workflow", { exact: true })).toBeVisible()
  await expect(banner.getByText("Old PR workflow", { exact: true })).toHaveCount(0)
})
