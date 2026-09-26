import { defineConfig } from "@playwright/test"

const PORT = 5199

export default defineConfig({
  testDir: "e2e",
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1400, height: 900 } },
  webServer: {
    command: `bunx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
})
