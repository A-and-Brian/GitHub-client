import { type Hunk, hunkSides } from "@github-client/core"
import { useEffect, useSyncExternalStore } from "react"
import type { HighlightRequest, HighlightResponse, Token } from "./highlight.worker"

export type { Token }

/** Tokens per hunk and diff line. */
export type FileTokens = Token[][][]

// Past this size highlighting costs more than it helps; the diff stays plain text.
const MAX_CHARS = 400_000
const CACHE_SIZE = 300

/** Keyed by head OID and path. Null: this file is not highlighted. */
const cache = new Map<string, FileTokens | null>()
const listeners = new Set<() => void>()
const pending = new Set<string>()

let worker: Worker | undefined
let nextId = 0
const replies = new Map<number, (tokens: Token[][][] | null) => void>()

function request(path: string, texts: string[]): Promise<Token[][][] | null> {
  if (!worker) {
    worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
      replies.get(event.data.id)?.(event.data.tokens)
      replies.delete(event.data.id)
    }
  }
  const id = nextId++
  worker.postMessage({ id, path, texts } satisfies HighlightRequest)
  return new Promise((resolve) => replies.set(id, resolve))
}

function store(key: string, tokens: FileTokens | null) {
  cache.set(key, tokens)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  for (const listener of listeners) listener()
}

/** Highlights each hunk's old and new side as a whole, so tokens have context. */
async function highlight(key: string, path: string, hunks: Hunk[]) {
  const sides = hunks.map(hunkSides)
  const texts = sides.flatMap((s) => [s.oldText, s.newText])
  if (texts.reduce((n, t) => n + t.length, 0) > MAX_CHARS) return store(key, null)
  pending.add(key)
  const tokens = await request(path, texts)
  pending.delete(key)
  store(
    key,
    tokens &&
      sides.map((side, h) =>
        hunks[h]!.lines.map((line, l) =>
          line.kind === "del"
            ? (tokens[2 * h]?.[side.oldIndex[l]!] ?? [])
            : (tokens[2 * h + 1]?.[side.newIndex[l]!] ?? []),
        ),
      ),
  )
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Highlighted tokens of a file; undefined until they arrive, null when not highlighted. */
export function useFileTokens(
  headOid: string,
  path: string,
  hunks: Hunk[],
): FileTokens | null | undefined {
  const key = `${headOid}:${path}`
  const tokens = useSyncExternalStore(subscribe, () => cache.get(key))
  useEffect(() => {
    if (!cache.has(key) && !pending.has(key)) void highlight(key, path, hunks)
  }, [key, path, hunks])
  return tokens
}
