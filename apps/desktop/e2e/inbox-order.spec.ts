import { expect, type Locator, type Page, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

const inbox = (page: Page) => page.getByRole("complementary", { name: "Pull request inbox" })
const row = (page: Page, id = "PR_1") => inbox(page).locator(`[data-pull-id="${id}"]`)
const active = (page: Page) => page.getByRole("list", { name: "Active pull requests", exact: true })
const pinned = (page: Page) => page.getByRole("list", { name: "Pinned pull requests", exact: true })

async function setup(page: Page) {
  const requests = await fakeGitHub(page, { pullCount: 4 })
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/")
  await expect(row(page)).toBeVisible()
  return requests
}

async function menuAction(page: Page, action: string, id = "PR_1") {
  await row(page, id)
    .getByRole("button", { name: /^Actions for/ })
    .click()
  await page.getByRole("menuitem", { name: action, exact: true }).click()
}

async function beginDrag(page: Page, source: Locator, target: Locator) {
  // Pointer APIs do not auto-wait for the row's async ordering/write readiness.
  const sourceRow = source.locator("xpath=ancestor-or-self::li[@data-pull-id]")
  const activator = sourceRow.getByTitle("Drag to reorder or move between sections", {
    exact: true,
  })
  await activator.click({ trial: true })
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error("Drag source or target is not visible")
  await page.mouse.move(from.x + Math.min(24, from.width / 2), from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + Math.min(24, from.width / 2) + 10, from.y + from.height / 2, {
    steps: 3,
  })
  await page.mouse.move(to.x + 24, to.y + to.height / 2, { steps: 10 })
  await expect(page.getByRole("status", { name: "Dragging pull request" })).toBeVisible()
}

test("pin order persists and exact Undo restores a snoozed pinned PR", async ({ page }) => {
  const requests = await setup(page)
  await menuAction(page, "Pin")
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  await expect(page.getByRole("heading", { name: "Speed up the diff view" })).toHaveCount(0)
  // The row moves optimistically; the success toast follows the durable commit.
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /^Pinned/ })).toBeVisible()
  await page.reload()
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  await row(page).getByText("Speed up the diff view", { exact: true }).click()
  await page.getByRole("button", { name: "Snooze", exact: true }).click()
  await page.getByRole("button", { name: "In one hour", exact: true }).click()
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Speed up the diff view" })).toBeVisible()
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Snoozed" })
    .getByRole("button", { name: "Undo", exact: true })
    .click()
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  expect(
    requests.filter((request) => request.method !== "GET" && request.path !== "/graphql"),
  ).toEqual([])
})

test("drag commits to an empty pinned target and Escape cancels a settle", async ({ page }) => {
  await setup(page)
  await row(page).getByText("Speed up the diff view", { exact: true }).click()
  await expect(page.getByRole("heading", { name: "Speed up the diff view" })).toBeVisible()
  const grip = row(page).locator(".lucide-grip-vertical")
  await expect(grip).toBeVisible()
  await beginDrag(page, grip, page.getByRole("heading", { name: /^Pinned/ }))
  await page.mouse.up()
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  await beginDrag(page, row(page), page.getByRole("button", { name: /^Settled/ }))
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  await expect(page.getByRole("heading", { name: "Speed up the diff view" })).toBeVisible()
  await beginDrag(page, row(page), page.getByRole("button", { name: /^Settled/ }))
  await page.mouse.up()
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toHaveCount(0)
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Settled locally · GitHub PR unchanged" }),
  ).toBeVisible()
  await page.keyboard.press("ControlOrMeta+z")
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
})

test("waking a snoozed pinned PR restores its placement", async ({ page }) => {
  await setup(page)
  await menuAction(page, "Pin")
  await row(page).getByText("Speed up the diff view", { exact: true }).click()
  await page.getByRole("button", { name: "Snooze", exact: true }).click()
  await page.getByRole("button", { name: "In one hour", exact: true }).click()
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toHaveCount(0)
  await menuAction(page, "Wake to previous position")
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  await expect(page.getByText("Woke to previous position", { exact: true })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+z")
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toHaveCount(0)
  await expect(row(page)).toBeVisible()
})

for (const reason of ["pointercancel", "blur", "resize", "pagehide", "lost-button"]) {
  test(`${reason} cancels a pending drag without changing state`, async ({ page }) => {
    await setup(page)
    await beginDrag(page, row(page), page.getByRole("heading", { name: /^Pinned/ }))
    await page.evaluate((eventName) => {
      if (eventName === "pointercancel") {
        document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }))
      } else if (eventName === "lost-button") {
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            isPrimary: true,
            buttons: 0,
          }),
        )
      } else {
        window.dispatchEvent(new Event(eventName))
      }
    }, reason)
    await expect(page.getByRole("status", { name: "Dragging pull request" })).toHaveCount(0)
    await page.mouse.up()
    await expect(active(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0)
  })
}

test("Failures keeps state actions available but disables manual ordering", async ({ page }) => {
  await fakeGitHub(page, { checkState: "FAILURE", pullCount: 2 })
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/")
  await expect(row(page)).toBeVisible()
  await page.getByRole("button", { name: "Failures", exact: true }).click()
  await row(page)
    .getByRole("button", { name: /^Actions for/ })
    .click()
  await expect(page.getByRole("menuitem", { name: "Move down", exact: true })).toBeDisabled()
  await expect(page.getByRole("menuitem", { name: "Pin", exact: true })).toBeEnabled()
})

test("Undo in an editable field remains native text Undo", async ({ page }) => {
  await setup(page)
  await menuAction(page, "Pin")
  const search = page.getByLabel("Filter inbox")
  await search.pressSequentially("diff")
  await page.keyboard.press("ControlOrMeta+z")
  // Chromium may group typing into more than one native undo step.
  await expect(search).not.toHaveValue("diff")
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
})

test("returning to Inbox gives the new action its own Undo lifetime", async ({ page }) => {
  await setup(page)
  await page.clock.install()
  await menuAction(page, "Pin")
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /^Pinned/ })).toBeVisible()
  await page.clock.fastForward(2500)
  await page.getByRole("link", { name: "Involving me", exact: true }).click()
  await page.getByRole("link", { name: "Inbox", exact: true }).click()
  await menuAction(page, "Unpin")
  const currentNotice = page.locator("[data-sonner-toast]").filter({ hasText: /^Unpinned/ })
  await expect(currentNotice).toBeVisible()
  await page.clock.fastForward(2700)
  await expect(currentNotice).toBeVisible()
  await currentNotice.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(pinned(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
})

test("keyboard ordering persists and filtered ordering preserves hidden PRs", async ({ page }) => {
  await setup(page)
  const ids = () =>
    active(page)
      .locator("[data-pull-id]")
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-pull-id")))
  await expect(active(page).locator("[data-pull-id]")).toHaveCount(4)
  const initial = await ids()
  await menuAction(page, "Move down")
  await expect.poll(ids).toEqual([initial[1], initial[0], ...initial.slice(2)])
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Inbox order updated" }),
  ).toBeVisible()
  await page.reload()
  await expect.poll(ids).toEqual([initial[1], initial[0], ...initial.slice(2)])
  await page.getByLabel("Filter inbox").fill("Follow-up")
  await menuAction(page, "Move down", initial[1]!)
  await page.getByLabel("Filter inbox").clear()
  await expect.poll(ids).toEqual([initial[0], initial[2], initial[1], initial[3]])
})

test("dragging within Active commits the indicated before-row position", async ({ page }) => {
  await setup(page)
  await row(page, "PR_3")
    .getByTitle("Drag to reorder or move between sections", { exact: true })
    .click({ trial: true })
  const from = await row(page, "PR_3").boundingBox()
  const to = await row(page, "PR_1").boundingBox()
  if (!from || !to) throw new Error("Reorder rows are missing")
  await page.mouse.move(from.x + Math.min(24, from.width / 2), from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + Math.min(24, from.width / 2) + 10, from.y + from.height / 2, {
    steps: 3,
  })
  await page.mouse.move(to.x + 24, to.y + 4, { steps: 10 })
  await expect(page.getByRole("status", { name: "Dragging pull request" })).toBeVisible()
  await page.mouse.up()
  await expect
    .poll(() =>
      active(page)
        .locator("[data-pull-id]")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-pull-id"))),
    )
    .toEqual(["PR_3", "PR_1", "PR_2", "PR_4"])
})

test("keyboard pinning a background PR preserves detail and restores row focus", async ({
  page,
}) => {
  await setup(page)
  await row(page).getByText("Speed up the diff view", { exact: true }).click()
  await row(page, "PR_2")
    .getByRole("button", { name: /^Actions for/ })
    .focus()
  await page.keyboard.press("Enter")
  await page.getByRole("menuitem", { name: "Pin", exact: true }).press("Enter")
  await expect(pinned(page).locator('[data-pull-id="PR_2"] :focus')).toHaveCount(1)
  await expect(page.getByRole("heading", { name: "Speed up the diff view" })).toBeVisible()
  await row(page, "PR_2")
    .getByRole("button", { name: /^Actions for/ })
    .press("Enter")
  await page.getByRole("menuitem", { name: "Settle locally", exact: true }).press("Enter")
  await expect(page.getByRole("button", { name: /^Settled/ })).toBeFocused()
  await expect(row(page, "PR_2")).toHaveCount(0)
})

test("sidebar resizing is keyboard accessible, persisted and resets", async ({ page }) => {
  await setup(page)
  const separator = page.getByRole("separator", { name: "Resize inbox sidebar" })
  await expect(separator).toHaveAttribute("aria-valuenow", "256")
  await separator.focus()
  await page.keyboard.press("ArrowRight")
  await expect(separator).toHaveAttribute("aria-valuenow", "272")
  await page.reload()
  await expect(separator).toHaveAttribute("aria-valuenow", "272")
  await separator.focus()
  await page.keyboard.press("Home")
  await expect(separator).toHaveAttribute("aria-valuenow", "256")
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(separator).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Go to/ })).toBeVisible()
  await row(page).getByText("Speed up the diff view", { exact: true }).click()
  await expect(inbox(page)).not.toBeVisible()
  await page.getByRole("button", { name: "Back to inbox", exact: true }).click()
  await expect(inbox(page)).toBeVisible()
  await page.setViewportSize({ width: 1400, height: 900 })
  await expect(separator).toHaveAttribute("aria-valuenow", "256")
})

test("short pointer movement and outside drops do not organize a PR", async ({ page }) => {
  await setup(page)
  const source = await row(page).boundingBox()
  if (!source) throw new Error("PR row is missing")
  await page.mouse.move(source.x + 24, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + 27, source.y + source.height / 2)
  await page.mouse.up()
  await expect(active(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0)
  await beginDrag(page, row(page), page.getByRole("heading", { name: /^Pinned/ }))
  await page.mouse.move(900, 600, { steps: 8 })
  await page.mouse.up()
  await expect(active(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0)
})

test("incoming GitHub activity changes freshness without reshuffling arranged work", async ({
  page,
}) => {
  const options = { pullCount: 4, pullUpdatedAt: {} as Record<string, string> }
  await fakeGitHub(page, options)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/")
  await expect(active(page).locator("[data-pull-id]")).toHaveCount(4)
  await menuAction(page, "Move down")
  // The row moves optimistically; wait for the success toast before reloading persisted order.
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Inbox order updated" }),
  ).toBeVisible()
  const order = await active(page)
    .locator("[data-pull-id]")
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-pull-id")))
  options.pullUpdatedAt.PR_4 = new Date().toISOString()
  await page.getByRole("button", { name: "Refresh inbox", exact: true }).click()
  await expect
    .poll(() =>
      active(page)
        .locator("[data-pull-id]")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-pull-id"))),
    )
    .toEqual(order)
  await page.reload()
  await expect
    .poll(() =>
      active(page)
        .locator("[data-pull-id]")
        .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-pull-id"))),
    )
    .toEqual(order)
})

test("multiple snoozes stack identified notifications with independent Undo", async ({ page }) => {
  await setup(page)
  for (const id of ["PR_1", "PR_2"]) {
    await row(page, id).locator("[data-inbox-row-select]").click()
    await page.getByRole("button", { name: "Snooze", exact: true }).click()
    await page.getByRole("button", { name: "In one hour", exact: true }).click()
  }
  const notices = page.locator("[data-sonner-toast]").filter({ hasText: "Snoozed" })
  await expect(notices).toHaveCount(2)
  const first = notices.filter({ hasText: "acme/api #7 · Speed up the diff view" })
  const second = notices.filter({ hasText: "acme/api #8 · Follow-up pull request 1" })
  await expect(first).toBeVisible()
  await expect(second).toBeVisible()
  await first.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(active(page).locator('[data-pull-id="PR_1"]')).toBeVisible()
  await expect(active(page).locator('[data-pull-id="PR_2"]')).toHaveCount(0)
  await second.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(active(page).locator('[data-pull-id="PR_2"]')).toBeVisible()
})
