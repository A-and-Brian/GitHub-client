import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Tauri expects a fixed dev port and must see its own logs.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  worker: { format: "es" },
  // wa-sqlite ships WASM that Vite's dependency optimizer must not rewrite.
  optimizeDeps: {
    exclude: ["@journeyapps/wa-sqlite", "@tanstack/browser-db-sqlite-persistence"],
  },
})
