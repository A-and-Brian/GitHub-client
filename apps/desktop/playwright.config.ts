import { defineConfig } from "@playwright/test"

const PORT = 5199

export default defineConfig({
  testDir: "e2e",
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1400, height: 900 } },
  webServer: {
    // Vite's first-run dependency optimization reload can interrupt an E2E interaction.
    command: `bun run build && bunx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
})
