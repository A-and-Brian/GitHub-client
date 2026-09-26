import { useState } from "react"

const storageKey = (prKey: string) => `github-client.viewed:${prKey}`

/** Only the latest head is kept: files viewed on an older head count as unviewed. */
function read(prKey: string, headOid: string): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(prKey)) ?? "null")
    return new Set(saved?.headOid === headOid ? saved.paths : [])
  } catch {
    return new Set()
  }
}

/** Paths marked "Viewed" for one pull request at one head commit, kept in localStorage. */
export function useViewedFiles(prKey: string, headOid: string) {
  const id = `${prKey}@${headOid}`
  const [state, setState] = useState(() => ({ id, paths: read(prKey, headOid) }))
  if (state.id !== id) setState({ id, paths: read(prKey, headOid) })

  const toggle = (path: string) => {
    const paths = new Set(state.paths)
    if (!paths.delete(path)) paths.add(path)
    localStorage.setItem(storageKey(prKey), JSON.stringify({ headOid, paths: [...paths] }))
    setState({ id, paths })
  }
  return { viewed: state.paths, toggle }
}
