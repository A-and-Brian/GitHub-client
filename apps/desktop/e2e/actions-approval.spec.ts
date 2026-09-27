import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

const run = {
  id: 900,
  workflow_id: 70,
  name: "CI",
  display_title: "Validate PR",
  run_number: 12,
  run_attempt: 1,
  event: "pull_request",
  status: "completed",
  conclusion: "action_required",
  head_branch: "feature",
  head_sha: "abc1234567890",
  actor: { login: "octo" },
  created_at: "2026-09-25T10:00:00Z",
  updated_at: "2026-09-25T10:01:00Z",
  html_url: "https://github.com/acme/api/actions/runs/900",
}

const json = (route: import("@playwright/test").Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

async function openRun(page: import("@playwright/test").Page) {
  await fakeGitHub(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs**", (route) =>
    json(route, { total_count: 1, workflow_runs: [run] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/workflows**", (route) =>
    json(route, { total_count: 0, workflows: [] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/runs/900/jobs**", (route) =>
    json(route, { total_count: 0, jobs: [] }),
  )
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/actions/acme/api/runs/900")
  await expect(page.getByRole("button", { name: "Approve workflow", exact: true })).toBeVisible()
}

test("approves an action-required PR run and refreshes its status and jobs", async ({ page }) => {
  let approved = false
  let approvalRequests = 0
  await fakeGitHub(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs**", (route) =>
    json(route, {
      total_count: 1,
      workflow_runs: [{ ...run, ...(approved ? { status: "queued", conclusion: null } : {}) }],
    }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/workflows**", (route) =>
    json(route, { total_count: 0, workflows: [] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/runs/900/jobs**", (route) =>
    json(route, { total_count: 0, jobs: [] }),
  )
  await page.route(
    "https://api.github.com/repos/acme/api/actions/runs/900/approve",
    async (route) => {
      approvalRequests++
      approved = true
      await route.fulfill({ status: 201, body: "" })
    },
  )
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/actions/acme/api/runs/900")

  await expect(page.getByRole("button", { name: "Approve workflow", exact: true })).toBeVisible()
  await expect(
    page.getByText(
      "This run has no jobs yet. Approve the workflow to allow its PR code to execute.",
    ),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Re-run all jobs", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Approve workflow", exact: true }).click()
  await expect(page.getByText(/allows its PR code to execute/)).toBeVisible()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve workflow", exact: true })
    .click()

  await expect(page.locator("[data-sonner-toast]")).toContainText("Approval requested")
  await expect(page.getByRole("button", { name: "Approve workflow", exact: true })).toHaveCount(0)
  await expect(page.getByText("This run has no jobs.", { exact: true })).toBeVisible()
  expect(approvalRequests).toBe(1)
})

test("shows the approval action for an older run loaded by its detail endpoint", async ({
  page,
}) => {
  let approved = false
  await fakeGitHub(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs**", (route) =>
    json(route, { total_count: 1, workflow_runs: [] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/workflows**", (route) =>
    json(route, { total_count: 0, workflows: [] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/runs/999", (route) =>
    json(route, {
      ...run,
      id: 999,
      ...(approved ? { status: "queued", conclusion: null } : {}),
      html_url: "https://github.com/acme/api/actions/runs/999",
    }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/runs/999/jobs**", (route) =>
    json(route, { total_count: 0, jobs: [] }),
  )
  await page.route(
    "https://api.github.com/repos/acme/api/actions/runs/999/approve",
    async (route) => {
      approved = true
      await route.fulfill({ status: 201, body: "" })
    },
  )
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/actions/acme/api/runs/999")

  await expect(page.getByRole("button", { name: "Approve workflow", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Approve workflow", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve workflow", exact: true })
    .click()
  await expect(page.locator("[data-sonner-toast]")).toContainText("Approval requested")
  await expect(page.getByRole("button", { name: "Approve workflow", exact: true })).toHaveCount(0)
})

for (const [event, status, conclusion] of [
  ["push", "completed", "action_required"],
  ["pull_request", "completed", "failure"],
  ["pull_request", "completed", "success"],
  ["pull_request", "in_progress", null],
  ["workflow_dispatch", "waiting", null],
] as const) {
  test(`hides approval for ${event} ${status} runs with ${conclusion ?? "no conclusion"}`, async ({
    page,
  }) => {
    await openRun(page)
    await page.route("https://api.github.com/repos/acme/api/actions/runs**", (route) =>
      json(route, {
        total_count: 1,
        workflow_runs: [{ ...run, event, status, conclusion }],
      }),
    )
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await expect(page.getByRole("button", { name: "Approve workflow", exact: true })).toHaveCount(0)
  })
}

test("shows approval for a pull_request_target event", async ({ page }) => {
  await openRun(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs**", (route) =>
    json(route, {
      total_count: 1,
      workflow_runs: [{ ...run, event: "pull_request_target" }],
    }),
  )
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(page.getByRole("button", { name: "Approve workflow", exact: true })).toBeVisible()
})

test("keeps GitHub error feedback when workflow approval is rejected", async ({ page }) => {
  await openRun(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs/900/approve", (route) =>
    json(route, { message: "Resource not accessible by integration" }, 403),
  )
  await page.getByRole("button", { name: "Approve workflow", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve workflow", exact: true })
    .click()

  await expect(page.locator("[data-sonner-toast]")).toContainText("Approve workflow failed")
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Resource not accessible by integration",
  )
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Approve workflow", exact: true })).toBeEnabled()
})
