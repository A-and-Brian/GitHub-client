import { createHighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import { bundledLanguages } from "shiki/langs"
import githubDark from "shiki/themes/github-dark.mjs"
import githubLight from "shiki/themes/github-light.mjs"

/** Token text with its light and dark theme colors. */
export type Token = [text: string, light?: string, dark?: string]

export interface HighlightRequest {
  id: number
  path: string
  texts: string[]
}

/** Tokens per text and line; null when the language is unknown or fails. */
export interface HighlightResponse {
  id: number
  tokens: Token[][][] | null
}

const FILE_NAMES: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  "cmakelists.txt": "cmake",
}
const EXTENSIONS: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  h: "c",
}

function languageOf(path: string): keyof typeof bundledLanguages | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : ""
  const lang = FILE_NAMES[name] ?? EXTENSIONS[ext] ?? ext
  return lang in bundledLanguages ? (lang as keyof typeof bundledLanguages) : null
}

// The JavaScript regex engine avoids shipping and compiling Oniguruma WASM.
const highlighter = createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
})

async function highlight(path: string, texts: string[]): Promise<Token[][][] | null> {
  const lang = languageOf(path)
  if (!lang) return null
  const h = await highlighter
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(bundledLanguages[lang])
  return texts.map((text) =>
    h
      .codeToTokensWithThemes(text, {
        lang,
        themes: { light: "github-light", dark: "github-dark" },
      })
      .map((line) =>
        line.map((t): Token => [t.content, t.variants.light?.color, t.variants.dark?.color]),
      ),
  )
}

self.onmessage = async (event: MessageEvent<HighlightRequest>) => {
  const { id, path, texts } = event.data
  let tokens: Token[][][] | null = null
  try {
    tokens = await highlight(path, texts)
  } catch (error) {
    console.warn(`Highlighting ${path} failed`, error)
  }
  self.postMessage({ id, tokens } satisfies HighlightResponse)
}
