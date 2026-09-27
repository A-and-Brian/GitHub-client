# Instant revisits and offline repository browsing

## Decision and scope
Save visited content first, as Yi selected. Returning to a team, organization, repository, branch, or file must render its saved data without waiting for GitHub. Refresh stale data in the background without clearing the screen. Persist successful reads across desktop restarts. First visits still need the network; offline misses say “Not saved for offline use” instead of spinning forever.

This covers organization/team repository catalogs and the repository browser: summary, loaded branch pages, visited directory/file contents, README, and loaded open-PR pages. It preserves the existing PR-detail and Actions persistence. No full clone, recursive download, offline mutation queue, image cache, or settings-cache expansion.

## Evidence and current storage
The installed desktop database was measured read-only: 34,074,624 bytes of SQLite data, 5,026,432 bytes of write-ahead log, and 32,768 bytes of shared-memory bookkeeping, approximately 39.1 MB total. This is a point-in-time disk measurement, not a count of useful cached payload bytes.

The existing collections persist groups, basic repositories, group PRs, inbox preferences, PR details and files, workflow runs, jobs, workflows, and review drafts. Desktop uses SQLite; browser development uses OPFS SQLite when available and memory otherwise. Existing records have no general byte budget. Sign-out clears the collections.

The observed loading has a direct source explanation. RepositoryCatalog in apps/desktop/src/screens/dashboard.tsx:299-350 initializes an empty list and clears it on every mount/scope change. Its keyed instance remounts across teams. RepositoryBrowser in apps/desktop/src/screens/repository.tsx:53-249 holds summary, branches, contents, README, and PRs in component state, clears values for requests, and gates rendering on loading. Their APIs in packages/core/src/repositories.ts use direct REST GETs with no response cache. The basic repos collection is not a complete catalog snapshot and cannot supply those richer fields or pagination semantics.

This diagnosis is source-backed. No runtime reproduction or implementation validation is claimed yet. The prior persisted-writer lifecycle fix is present and is not the cause of these screens bypassing persistence.

## Approach and alternatives
Recommended: add a small typed repository-resource store backed by the existing synced collection and SQLite machinery. Keep one owner for resource reads, request deduplication, persistence, freshness, and invalidation. UI subscribes to the store and keeps only view controls locally.

An in-memory cache alone would fix short revisits but lose everything on restart and fail the offline requirement. A broad HTTP response cache would also retain unrelated endpoints and hide permission/pagination semantics. Neither is the chosen approach; a new caching framework is unnecessary.

## Data contract
Add a versioned repository-resources collection and a core repository-resource service owned by GitHubClient. Use a discriminated union of catalog pages, summary, branch pages, contents, README, and PR pages. Each successful snapshot stores its resource identity, payload, fetchedAt, lastAccessedAt, and serialized UTF-8 payload size. Empty lists and a successfully resolved absent README are saved values, distinct from no snapshot.

Use unhashed JSON tuple keys with GitHub host, account login, resource kind, organization/team or repository, explicit ref and path where applicable, and page/query parameters. Include list filters and page size in identity. Never reuse data across accounts, teams, repositories, refs, paths, or resource types. Scope UI reads before subscribing; do not show previous-route data for even one render. Resolve the default branch from the saved summary before loading contents; summary data from a catalog may seed the same account/repo summary snapshot.

Reuse collection persistence and lifecycle handling; no raw SQL from screens. Additive collection creation needs no destructive rewrite of existing data. Sign-out invalidates the service generation and clears both memory and persisted rows; late requests from the previous generation must not repopulate them. Account changes select a separate namespace even when sign-in occurs without normal sign-out.

## Read and refresh behavior
Warm navigation reads the exact resource from the live collection immediately. On restart, hydrate saved repository resources from SQLite before declaring a cache miss; local hydration must not trigger a network-gated empty screen. Share in-flight work for identical keys and retain completed requests for their original key when navigating elsewhere.

Use a 60-second freshness window. Fresh revisits do not refetch. Stale revisits render saved data immediately and refresh in the background; manual Refresh bypasses freshness. Avoid overlapping refreshes, respect existing rate-limit information, and refresh active stale resources on reconnect. Do not add whole-account polling or speculative recursive fetches.

For catalogs, branch lists, and PR lists, remember loaded pages and their hasMore status. Returning restores all loaded pages. Refresh the loaded range into a staged generation and replace the visible range atomically only when successful; truncate after a confirmed terminal page. A failed refresh keeps the previous consistent range. Load-more failures preserve earlier pages and retry that same page. Deduplicate rows by stable repository/PR/branch identity without changing server order. Overview and full catalog share the same saved pages; preview merely renders five rows.

A background request never clears existing data or replaces it with a loading placeholder. Preserve stable row keys, current scroll position, and focus during unchanged refreshes. Genuine additions/removals can change layout; the acceptance criterion is eliminating clear-and-repopulate jumps.

## Offline, errors, and permissions
Network failures, timeouts, server failures, and confirmed rate limits keep saved content visible with a quiet “Saved data · could not refresh” state and Retry. Never represent those failures as an empty result. An uncached offline resource shows a specific unavailable message; loaded pages remain readable and uncached Load more remains explicitly unavailable offline.

A confirmed unauthorized/forbidden/not-found response must not silently serve a known-inaccessible resource. Distinguish rate-limit 403 responses from permission 403 responses using GitHub response metadata, extending the error metadata narrowly if needed. Clear/hide the affected snapshot on confirmed access denial; a denied repository summary invalidates that repository's resource snapshots. A contents 404 invalidates that path/ref, not every repository. Preserve existing successful absent-README and empty-repository semantics. Cached admin flags never authorize writes.

Keep the existing cached-viewer offline startup path and test it. Cold app startup currently awaits the /user validation request before its offline fallback: add a bounded validation timeout if the restart test demonstrates it can hang, preserving the existing 401 rejection behavior. Do not turn this into a general authentication redesign. Browser OPFS fallback is explicitly memory-only and must not be presented as restart-safe persistence.

## Retention and storage budget
Bound the new visited-resource cache to 100 MiB of serialized payload per account with least-recently-used eviction. This is a logical payload budget, not a promise that the SQLite file shrinks to that size. Do not expire data merely because it is stale. Reuse the existing 1 MiB text-preview limit; no binary downloads or remote README-image persistence.

Evict inactive least-recently-used resources on insertion; protect active resources. If active entries leave insufficient budget, keep the new response usable in memory and clearly report that it could not be saved offline. Do not grow persistence beyond the configured budget or evict unrelated drafts/PR collections. Batch access-time updates to avoid writing on every render. Cache write failures retain the current network result and communicate the offline-save failure without reporting persistence success.

## Implementation slices
1. Core: add typed snapshots, resource keys, shared request/state service, persistence, retention, account/generation isolation, and error classification. Files: packages/core/src/repository-cache.ts (new), collections/index.ts, client.ts, repositories.ts, and narrow REST error metadata changes if needed.
2. Dashboard: replace RepositoryCatalog's disposable response state with the resource subscription, shared preview/full pagination, and nonblocking refresh/error states. File: apps/desktop/src/screens/dashboard.tsx, plus a small shared subscription hook in apps/desktop/src/app if needed.
3. Repository browser: migrate summary, branches, contents, README, and PR pages to the same store; retain ref/path behavior, sanitization, file limits, and distinct empty/access-denied states. File: apps/desktop/src/screens/repository.tsx.
4. Verification and delivery: focused core tests, browser regressions, isolated persistence/restart proof, typecheck/build/lint, required repository checks, and a patch changeset if required. Report native evidence separately from browser evidence. No installed app data reset or dev-server termination.

## Acceptance and proof
- Visit team A, team B, then A with the network response held. A's saved rows are already present and no “Loading repositories” replaces them. Repeat for organizations and overview/full-catalog navigation.
- Revisit within 60 seconds: zero extra requests for the same resource. Revisit after expiry: saved content remains visible while one refresh runs. Unchanged refresh preserves row position/focus; changed responses update correctly.
- Save two catalog/branch/PR pages, revisit, then fail refresh or load more. Saved rows persist without duplicates, page gaps, or wrong-page retry. Successful refresh removes deleted rows and respects a shorter terminal list.
- Visit repository root, README, nested directory, text file, another branch, and PR tab. Revisit each with delayed requests; exact saved data appears. Late responses cannot display another ref/path/account's content.
- After persistence has actually completed, recreate the client or restart an isolated app, disable network, and reopen visited resources. Confirm disk hydration rather than an in-memory-only test. An unvisited path gives the offline-miss message. Empty catalog and absent README remain resolved values.
- Exercise network failure, 5xx, rate-limit 403/429, permission 403, summary/path 404, and 401. Verify retention versus invalidation and bounded offline startup.
- Sign out while requests are pending, then sign in as a second account: no previous-account rows appear and late writes cannot recreate signed-out data.
- Verify eviction, active-resource protection, oversized payload handling, and failed persistence without damaging existing collections or falsely promising offline availability.
- Run focused unit tests and dashboard/navigation E2E, then workspace typecheck, build, lint, and required checks. Use a real persistence backend for restart proof; do not count browser memory fallback as success.

## Approval boundary
Only plan artifacts are written at this stage. Yi's AGENTS.md requires opening this raw HTML in Plannotator with --gate --json --require-approval and recording review.json. Implementation begins only after an approved structured decision. If changes are requested, revise this canonical Markdown, regenerate HTML, and repeat the gate.
