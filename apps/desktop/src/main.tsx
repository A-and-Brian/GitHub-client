import "@github-client/ui/globals.css"
import "./styles.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Boot } from "@/app/boot"
import { ThemeProvider } from "@/components/theme-provider"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <Boot />
    </ThemeProvider>
  </StrictMode>,
)
