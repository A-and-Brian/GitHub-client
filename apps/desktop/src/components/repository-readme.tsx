import type { MouseEvent } from "react"
import { openExternal } from "@/platform"

const ALLOWED_TAGS = new Set([
  "A",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DEL",
  "DETAILS",
  "DIV",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "HR",
  "I",
  "IMG",
  "LI",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "STRONG",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL",
])

function safeUrl(value: string, base: string, image = false): string | null {
  try {
    const url = new URL(value, base)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    // GitHub's content endpoint can contain token-bearing URL parameters; never retain them.
    for (const key of [...url.searchParams.keys()]) {
      if (/token|signature|auth|key/i.test(key)) url.searchParams.delete(key)
    }
    if (image && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

/** Keep the README's basic Markdown structure while dropping active content. */
export function sanitizeReadmeHtml(html: string, baseUrl: string, imageBaseUrl = baseUrl): string {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const clean = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const element = child as HTMLElement
      if (!ALLOWED_TAGS.has(element.tagName)) {
        if (
          ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE"].includes(
            element.tagName,
          )
        ) {
          element.remove()
          continue
        }
        // Re-sanitize any unwrapped children first so an unknown container cannot
        // smuggle active descendants (for example SVG links or iframe content).
        clean(element)
        element.replaceWith(...element.childNodes)
        continue
      }
      for (const attr of [...element.attributes]) {
        if (element.tagName === "A" && attr.name === "href") {
          const href = safeUrl(attr.value, baseUrl)
          if (href) element.setAttribute("href", href)
          else element.removeAttribute("href")
        } else if (element.tagName === "IMG" && attr.name === "src") {
          const src = safeUrl(attr.value, imageBaseUrl, true)
          if (src) element.setAttribute("src", src)
          else element.removeAttribute("src")
        } else if (
          (element.tagName === "IMG" && ["alt", "width", "height"].includes(attr.name)) ||
          (element.tagName === "A" && attr.name === "title")
        ) {
          // These attributes have no navigation or execution behavior.
        } else {
          element.removeAttribute(attr.name)
        }
      }
      if (element.tagName === "A") {
        element.setAttribute("rel", "noreferrer")
        element.setAttribute("target", "_blank")
      }
      clean(element)
    }
  }
  clean(doc.body)
  return doc.body.innerHTML
}

export function RepositoryReadme({
  html,
  baseUrl,
  imageBaseUrl,
}: {
  html: string
  baseUrl: string
  imageBaseUrl?: string
}) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a")
    if (!anchor?.href) return
    event.preventDefault()
    void openExternal(anchor.href)
  }
  const safeHtml = sanitizeReadmeHtml(html, baseUrl, imageBaseUrl)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: links remain keyboard accessible and open externally
    // biome-ignore lint/a11y/noStaticElementInteractions: delegates activation for safe README links
    <div
      className="gh-markdown min-w-0"
      onClick={onClick}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: README markup is sanitized by the strict allowlist above.
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  )
}
