interface CacheState {
  loaded: boolean
  refreshing: boolean
  persisted: boolean
  error?: unknown
  saveError?: unknown
}

/** Keep feedback in one stable line while saved content remains on screen. */
export function RepositoryCacheStatus({ states }: { states: CacheState[] }) {
  const saved = states.length > 0 && states.every((state) => state.loaded && state.persisted)
  const saveError = states.some((state) => state.saveError)
  const refreshError = states.some((state) => state.loaded && state.error)
  const refreshing = states.some((state) => state.refreshing)
  const message = saveError
    ? "Could not save for offline use. Current content is still available."
    : refreshError
      ? "Saved data · could not refresh. Try again."
      : refreshing && states.some((state) => state.loaded)
        ? "Refreshing saved data…"
        : saved
          ? "Saved for offline use"
          : ""
  return (
    <p
      role="status"
      title={message}
      data-testid="repository-cache-status"
      data-saved={saved}
      className="min-h-5 min-w-0 flex-1 truncate text-xs text-muted-foreground"
    >
      {message}
    </p>
  )
}
