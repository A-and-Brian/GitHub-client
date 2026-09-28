import { expect, test } from "@playwright/test"
import { fakeGitHub } from "./fake-github"

test("repository code lazily browses files and keeps the preview in sync with the URL", async ({
  page,
}, info) => {
  const requests = await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api")

  await expect(page.getByRole("heading", { name: "Repository guide" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Repository files" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Expand src" })).toBeVisible()
  await page.screenshot({ path: info.outputPath("repository-split.png") })
  expect(
    requests.filter((request) => request.path === "/repos/acme/api/contents/src"),
  ).toHaveLength(0)

  await page.getByRole("button", { name: "Expand src" }).click()
  await expect(page.getByRole("button", { name: "index.ts" })).toBeVisible()
  expect(
    requests.filter((request) => request.path === "/repos/acme/api/contents/src"),
  ).toHaveLength(1)

  const fileTree = page.getByRole("navigation", { name: "Repository files" })
  await fileTree.getByRole("button", { name: "src", exact: true }).click()
  await expect(page).toHaveURL(/path=src/)
  await expect(page.getByRole("region", { name: "Files" })).toBeVisible()

  await fileTree.getByRole("button", { name: "index.ts" }).click()
  await expect(page).toHaveURL(/path=src%2Findex\.ts/)
  await expect(page.getByText("export { }", { exact: true })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Repository files" })).toBeVisible()

  await page.getByLabel("Branch").selectOption("feature")
  await expect(page).toHaveURL(/ref=feature/)
  await expect(page).not.toHaveURL(/path=/)
  await expect(page.getByRole("heading", { name: "Repository guide" })).toBeVisible()
})

test("repository code keeps its header fixed while a long README scrolls inside the preview", async ({
  page,
}) => {
  await fakeGitHub(page)
  await page.route("**/repos/acme/api/readme?*", async (route) => {
    if (route.request().headers().accept?.includes("application/vnd.github.html+json")) {
      const paragraphs = Array.from(
        { length: 60 },
        (_, index) =>
          `<p>README paragraph ${index + 1} with enough text to occupy several lines.</p>`,
      ).join("")
      await route.fulfill({ status: 200, contentType: "text/html", body: paragraphs })
      return
    }
    await route.fallback()
  })
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api")
  await expect(page.getByText("README paragraph 60")).toBeVisible()

  const geometry = await page
    .getByRole("heading", { name: "README" })
    .locator("xpath=../..")
    .evaluate((section) => {
      const preview = section.parentElement
      const branch = document.querySelector<HTMLSelectElement>('select[aria-label="Branch"]')
      if (!(preview instanceof HTMLElement) || !branch)
        throw new Error("Repository panes unavailable")
      const branchTop = branch.getBoundingClientRect().top
      preview.scrollTop = preview.scrollHeight
      return {
        pageScrollTop: document.scrollingElement?.scrollTop,
        previewScrollTop: preview.scrollTop,
        previewScrollHeight: preview.scrollHeight,
        previewClientHeight: preview.clientHeight,
        branchTop,
        branchTopAfterScroll: branch.getBoundingClientRect().top,
      }
    })

  expect(geometry.previewScrollHeight).toBeGreaterThan(geometry.previewClientHeight)
  expect(geometry.previewScrollTop).toBeGreaterThan(0)
  expect(geometry.pageScrollTop).toBe(0)
  expect(geometry.branchTopAfterScroll).toBe(geometry.branchTop)
})

test("narrow repository code opens the file drawer and returns focus after selection", async ({
  page,
}) => {
  const requests = await fakeGitHub(page)
  await page.setViewportSize({ width: 700, height: 900 })
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api")

  const filesButton = page.getByRole("button", { name: "Files" })
  await expect(filesButton).toBeVisible()
  await filesButton.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByRole("button", { name: "Expand src" }).click()
  await page.getByRole("button", { name: "index.ts" }).click()

  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(filesButton).toBeFocused()
  await expect(page).toHaveURL(/path=src%2Findex\.ts/)
  expect(
    requests.filter((request) => request.path === "/repos/acme/api/contents/src"),
  ).toHaveLength(1)
})

test("the split navigator and file preview reuse saved directories after an offline reload", async ({
  page,
}) => {
  const requests = await fakeGitHub(page)
  await page.addInitScript(() => sessionStorage.setItem("github-client.dev-token", "ghp_test"))
  await page.goto("/#/repo/acme/api")
  const navigator = page.getByRole("navigation", { name: "Repository files" })
  await navigator.getByRole("button", { name: "Expand src", exact: true }).click()
  await navigator.getByRole("button", { name: "src", exact: true }).click()
  await expect(page.getByRole("region", { name: "Files" })).toBeVisible()
  expect(
    requests.filter((request) => request.path === "/repos/acme/api/contents/src"),
  ).toHaveLength(1)
  await navigator.getByRole("button", { name: "index.ts", exact: true }).click()
  await expect(page.locator("pre")).toContainText("export")
  await expect(page.getByTestId("repository-cache-status")).toHaveAttribute("data-saved", "true")
  await page.route("https://api.github.com/**", (route) => route.abort("internetdisconnected"))
  await page.reload()
  await expect(page.locator("pre")).toContainText("export")
  await expect(navigator.getByRole("button", { name: "index.ts", exact: true })).toBeVisible()
  await navigator.getByRole("button", { name: "src", exact: true }).click()
  await expect(page.getByRole("region", { name: "Files" })).toBeVisible()
})
