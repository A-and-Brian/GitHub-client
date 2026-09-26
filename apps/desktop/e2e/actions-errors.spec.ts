import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

const run = {
  id: 900,
  workflow_id: 70,
  name: "CI",
  display_title: "Fix deployment",
  run_number: 12,
  run_attempt: 1,
  event: "push",
  status: "completed",
  conclusion: "success",
  head_branch: "main",
  head_sha: "abc1234567890",
  actor: { login: "octo" },
  created_at: "2026-09-25T10:00:00Z",
  updated_at: "2026-09-25T10:01:00Z",
  html_url: "https://github.com/acme/api/actions/runs/900",
}

const job = (status: string) => ({
  id: 901,
  run_id: 900,
  name: "Build",
  status,
  conclusion: status === "completed" ? "success" : null,
  started_at: "2026-09-25T10:00:00Z",
  completed_at: status === "completed" ? "2026-09-25T10:01:00Z" : null,
  html_url: "https://github.com/acme/api/actions/runs/900/job/901",
  steps: [],
})

const json = (route: import("@playwright/test").Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

async function openActions(page: import("@playwright/test").Page) {
  await fakeGitHub(page)
  let resolveWorkflows!: () => void
  const workflowsLoaded = new Promise<void>((resolve) => {
    resolveWorkflows = resolve
  })
  await page.route("https://api.github.com/repos/acme/api/actions/runs**", (route) =>
    json(route, { total_count: 1, workflow_runs: [run] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/workflows**", async (route) => {
    await json(route, {
      total_count: 1,
      workflows: [{ id: 70, name: "CI", path: ".github/workflows/ci.yml", state: "active" }],
    })
    resolveWorkflows()
  })
  await page.route("https://api.github.com/repos/acme/api/actions/runs/900/jobs**", (route) =>
    json(route, { total_count: 1, jobs: [job("completed")] }),
  )
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/actions/acme/api")
  await workflowsLoaded
}

test("Actions refresh failure reports an error and keeps loaded runs", async ({ page }) => {
  let fail = false
  await fakeGitHub(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs**", (route) =>
    fail
      ? json(route, { message: "Actions temporarily unavailable" }, 503)
      : json(route, { total_count: 1, workflow_runs: [run] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/workflows**", (route) =>
    json(route, { total_count: 0, workflows: [] }),
  )
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/actions/acme/api")
  await expect(page.getByText("Fix deployment", { exact: true })).toBeVisible()

  fail = true
  await page.getByRole("button", { name: "Refresh", exact: true }).click()

  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Could not refresh acme/api workflow runs",
  )
  await expect(page.getByText("Fix deployment", { exact: true })).toBeVisible()
})

test("job fetch failure shows recovery guidance", async ({ page }) => {
  await openActions(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs/900/jobs**", (route) =>
    json(route, { message: "Job service unavailable" }, 503),
  )
  await page.goto("/#/actions/acme/api/runs/900")
  await expect(page.getByText("Could not load jobs. Use Refresh to try again.")).toBeVisible()
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Could not refresh jobs for run 900",
  )
})

test("log refresh failure keeps the previous log visible", async ({ page }) => {
  let fail = false
  await openActions(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs/900/jobs**", (route) =>
    json(route, { total_count: 1, jobs: [job("in_progress")] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/jobs/901/logs", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"message":"Log service unavailable"}',
        })
      : route.fulfill({ status: 200, contentType: "text/plain", body: "cached log output" }),
  )
  await page.getByText("Fix deployment", { exact: true }).click()
  await expect(page.getByText("cached log output", { exact: true })).toBeVisible()

  fail = true
  await expect(page.locator("[data-sonner-toast]")).toContainText("Could not load Build log", {
    timeout: 15_000,
  })
  await expect(page.getByText("cached log output", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Could not refresh the log. Showing previously loaded output.", { exact: true }),
  ).toBeVisible()
  await expect(page.locator("[data-sonner-toast]")).toContainText("Log service unavailable")
})

test("a running job's missing log stays informational", async ({ page }) => {
  await openActions(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs/900/jobs**", (route) =>
    json(route, { total_count: 1, jobs: [job("in_progress")] }),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/jobs/901/logs", (route) =>
    json(route, { message: "Not Found" }, 404),
  )
  await page.getByText("Fix deployment", { exact: true }).click()
  await expect(page.getByText("The log is not available yet.")).toBeVisible()
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
})

test("workflow inputs errors dismiss on close and do not return after reopening", async ({
  page,
}) => {
  let fail = true
  await openActions(page)
  await page.route("https://api.github.com/repos/acme/api/contents/**", (route) =>
    fail
      ? json(route, { message: "Contents service unavailable" }, 503)
      : route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: "on:\n  workflow_dispatch:\n    inputs:\n      deploy:\n        description: Deployment target\n        required: true\n        type: string\n",
        }),
  )

  await page.getByRole("button", { name: "Run workflow", exact: true }).click()
  await page.getByRole("combobox").click()
  await page.getByRole("option", { name: "CI", exact: true }).click()
  await expect(page.locator("[data-sonner-toast]")).toContainText("Could not read workflow inputs")
  await expect(page.getByText("Check the branch or workflow path, then try again.")).toBeVisible()

  await page.getByRole("button", { name: "Close", exact: true }).first().click()
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)

  fail = false
  await page.getByRole("button", { name: "Run workflow", exact: true }).click()
  await expect(page.getByLabel("deploy *", { exact: true })).toBeVisible()
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
})

test("older run fetch failure reports a contextual error", async ({ page }) => {
  await openActions(page)
  await page.route("https://api.github.com/repos/acme/api/actions/runs/999", (route) =>
    json(route, { message: "Run not found" }, 404),
  )
  await page.route("https://api.github.com/repos/acme/api/actions/runs/999/jobs**", (route) =>
    json(route, { total_count: 0, jobs: [] }),
  )
  await page.goto("/#/actions/acme/api/runs/999")

  await expect(page.locator("[data-sonner-toast]")).toContainText("Could not load workflow run 999")
  await expect(page.getByRole("heading", { name: "Run 999", exact: true })).toBeVisible()
})
