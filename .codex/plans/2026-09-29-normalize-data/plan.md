# Normalize all persisted application data

Replace duplicated entity payloads with canonical entities and explicit relationships across every current domain collection. Keep the existing screens and workflows, TanStack DB, and SQLite persistence. The user accepts loss of existing local domain data; implementation begins only after approval of this plan. Accepted architecture decision: normalize entities and relations while retaining TanStack storage.

## Decisions for approval

- Normalize all eleven current collections and the entities embedded in them, including repository browsing resources. This is one completed refactor, delivered in dependent stages rather than stopping after pull requests.
- Keep one database and namespace every domain key by normalized GitHub host and authenticated account identity. Use stable GitHub node IDs where available; use explicit composite keys for values with no API identity. No new application hashing, ORM, generic entity framework, or multi-account product expansion. Existing library-owned hashed SQLite table names remain an adapter internal.
- Keep hydrated objects as transient view models assembled from canonical collections. Persisting a view model, page response, or detail response containing copies of canonical entities is prohibited.
- Preserve opaque bodies and genuine historical observations as values: Markdown/HTML, patches, file text, logs, event descriptions, and settled-inbox comparison snapshots. Normalization does not mean turning every scalar into a table.
- This is logical entity normalization within TanStack collections. Its SQLite adapter still stores generic JSON rows and synchronization metadata; the plan does not claim conventional domain SQL tables or database-enforced foreign keys. Domain write functions and tests enforce references.
- Start a new versioned local database, leaving the previous database untouched. Existing cached data, drafts, and inbox preferences will not carry forward. Authentication tokens and unrelated settings remain intact.

## Current boundaries and evidence

| Current source | Finding and implementation boundary |
| --- | --- |
| `packages/core/src/collections/index.ts:26` | Eleven collections: groups, repos, pulls, inboxPreferences, pullDetails, pullFiles, workflowRuns, jobs, workflows, repositoryResources, drafts. Screens read collections rather than SQL. |
| `packages/core/src/domain/types.ts:15` | Groups embed repository names and parent display information. Pull rows repeat one PR per group. Details repeat PR fields and embed timeline, threads, comments, and checks; files and job steps are arrays. |
| `packages/core/src/repository-cache.ts:53` | Persisted resources contain opaque `data`; pages duplicate repository, PR, release, branch, and content payloads. Cache snapshots also hold transient copies. |
| `packages/core/src/repositories.ts:3` | Repository summaries overlap Repo; releases embed assets; contents embed entries. Several response mappers omit stable IDs that the normalized model must retain. |
| `packages/core/src/inbox.ts:6` | Inbox preferences reference PR identity and intentionally retain a settled-work comparison snapshot. Current key includes account login but lacks host. |
| `packages/core/src/actions/reviews.ts:6` | Drafts reference a display PR key and commit. Their file/line positions are historical draft facts. |
| `packages/core/src/client.ts:119` | Authentication generations protect requests; sign-out clears collections and drafts. Every new entity and relation must participate in the same lifecycle. |
| `apps/desktop/src/platform/browser.ts:13`, `apps/desktop/src/platform/tauri.ts:7`, `apps/desktop/src-tauri/src/database.rs:7` | Browser and desktop use `github-client.sqlite`; native initialization fixes SQLite to one connection for adapter transaction affinity. Preserve this guarantee. |

## Canonical model

All entity and relation keys include scope `(host, account)`. Select stable IDs in existing GraphQL/REST responses rather than discarding them. A repository has one stable GitHub node identity; owner/name is its current route and display value. A PR has one node identity plus repository reference and number. Route lookup resolves those values to the canonical entity. Do not create parallel canonical rows keyed by route and by ID.

Use a small typed key helper with unambiguous tuple encoding, not string concatenation that can collide on slashes or separators. Repository, PR, and actor IDs retain their API meaning. Case normalization applies to case-insensitive host/login lookup only; preserve refs, paths, and display casing.

| Existing collection / embedded data | Canonical entities and relationships |
| --- | --- |
| `groups` | Groups retain kind and local sort order, referencing explicit organization/team entities when applicable. Canonical teams own `parentTeamId`; navigation derives hierarchy and names from those entities. Only a deliberate local alias may override a name. `groupRepositories` relates group IDs to repository IDs; review targets reference the same organization/team identities. |
| `repos` and resource catalog/summary | One `repositories` entity per stable ID. Owner references the canonical user/organization actor. Summary-only fields enrich the same row. Catalog memberships and order belong to resource-result relations. |
| `pulls` and repository PR pages | One `pullRequests` entity per node ID. `groupPulls` relates group to PR and holds group observation facts; repository page membership references the same PR. Author references a canonical actor. |
| PR labels and requested reviews | Repository-scoped labels use their GitHub IDs; `pullLabels` joins PR to label. `pullReviewRequests` joins PR to typed user/team targets. Do not embed current label or actor payloads in PRs. |
| `pullDetails` | Merge scalar detail fields into the canonical PR; retain detail completeness separately. Timeline membership/order references comment, review, commit, or event entities. Threads reference PRs; review comments reference threads and authors. Comments/reviews have one canonical row wherever presented. |
| Timeline actors/commits/events | Users/organizations use API IDs and mutable profile fields. Commits use repository + OID; author text without a GitHub identity remains a historical value. Timeline event text and recorded actor labels are immutable observations where the API provides no identity. |
| Checks in details/list snapshots | Check runs use stable check IDs; status contexts use repository + head OID + context (and API identity when available). PR/head check membership references these rows. Check-to-workflow/run references replace repeated workflow display fields. Aggregate check state remains an explicitly observed summary, never a substitute for a complete check set. |
| `pullFiles` | `pullFiles` stores individual PR + head OID + path records; previous path and patch remain values. File-set observation metadata marks which head and pages are complete. No persisted array of file payloads. |
| `workflowRuns`, `workflows`, `jobs` | Each is canonical with scoped GitHub ID. Runs reference repository/workflow/actor; jobs reference runs. `jobSteps` uses job ID + step number. Run attempts are retained in observation/cache identity where fetching depends on attempt. |
| Resource releases | `releases` references repository; `releaseAssets` references release and uses the API asset ID. Markdown release notes remain a body value. Page results reference release IDs. |
| Resource branches | `branches` uses repository + branch name; page results reference branch keys. Branch identity is distinct from a file browser ref, which may name a branch, tag, or commit. |
| Resource contents and README | `contentEntries` uses repository + exact ref + path, with file body stored once alongside its entry/document record. Directory-result relations carry entry IDs and order. README resolution points to that document identity; its returned HTML is a document representation, not another repository payload. Preserve file/directory kind, truncation/limited status, unavailable-text reasons, and exact ref. |
| `repositoryResources` | Replace `data: unknown` with typed resource/query metadata and ordered `resourceItems` references. Metadata retains scope, query/ref/path, page/pageSize, kind, hasMore, fetched/access times, completeness, and refresh state needed for existing behavior. Scalar document results point to their canonical document. No entity payloads in pages. |
| `inboxPreferences` | One scope + PR preference row. State, ordering, snooze expiry, terminal observation, and the settled-work snapshot remain local values. Snapshot review targets are historical identities used for comparison, not duplicated live user/team entities. |
| `drafts` | Scoped local draft ID, canonical PR reference, and authored commit/path/line/body facts. Never infer its file identity from the newest head. Drafts and preferences keep their referenced PR reachable. |
| Viewed files (currently localStorage) | Scoped PR + head OID + path relation replaces persisted arrays from `apps/desktop/src/screens/pull/viewed.ts`. Ignore old keys on clean start; viewed state participates in account isolation and reference retention. |

The table defines domain boundaries, not a requirement to create a separate module for each row. Put related collection definitions, mappers, and selectors together using existing package boundaries. Only store fields the product already uses plus IDs/completeness needed to preserve correctness.

## Write, observation, and lifecycle rules

1. Every sync path maps responses into bounded scoped writes. The current helper supports per-collection writes, not an atomic cross-collection transaction. Write parent entities before children and memberships last; retain the prior membership set until candidate entity writes finish. Clear the affected observation's completion state before changing it and mark refresh successful only after all writes persist. Delete relationships before pruning entities. An interrupted scope remains stale and is idempotently refetched; readers treat missing references as incomplete/loading, never as successful empty results. This preserves honest recovery without adding a transaction or staging framework; a crash can leave partially updated entities until recovery.
2. Partial list responses patch only supplied fields. Missing fields never erase detail fields; explicit null is accepted only for a field that the response authoritatively supplies. Keep observation metadata for list, detail, lifecycle, check set, files, and resource page where their completeness differs. An older request or previous account generation cannot overwrite a newer applicable observation.
3. Check/file/thread/timeline replacement is bounded by the head, source, pagination, and completeness actually observed. A partial or failed page fetch upserts observed entities and retains prior complete memberships. Only a successful complete refresh removes missing memberships within that exact result set. A successful empty result is distinct from not loaded.
4. Removing a PR from one group or page deletes that membership, not the PR and not another group's membership. Absence from search is not evidence of closed/merged state. Apply terminal lifecycle only from an authoritative PR observation; retain settled-inbox semantics and chronological guards.
5. Canonical updates invalidate affected selectors so inbox, group, repository page, detail, and Actions views converge immediately. Use existing TanStack live queries or focused selectors; no persistent denormalized mirrors. Transient derived objects may be memoized only with canonical dependency invalidation.
6. Local mutations target canonical IDs. Optimistic review/resolve/merge/Actions changes update one canonical entity or bounded relation set. A rollback restores only fields still owned by that mutation generation; it must not overwrite a newer refresh. Successful remote writes reconcile with an authoritative fetch. Drafts clear only after successful review submission; failed submission preserves drafts. Existing stale-head and permission guards remain.
7. Resource eviction removes page/result metadata and memberships first. Prune only entities unreachable from any retained result, detail subscription/cache, group, draft, or preference, and cascade owned children together. Track canonical entity/document byte cost once plus relation overhead against the existing resource budget; shared payloads are not counted or deleted once per page. If a result has unresolved references after interrupted writes, mark it stale and refetch rather than render a misleading complete result.
8. All queries constrain scope. Sign-out invalidates in-flight work before clearing every scoped entity/relation and transient cache; direct account change cannot expose old data. Preserve existing authentication-generation protection and refresh-after-persistence behavior. Test host collisions as well as account collisions without adding new account-switching UI.

## Clean start and rollback

Use `github-client-normalized-v1.sqlite` for browser OPFS and the Tauri database key/filename. Update both native and JavaScript names together, including native tests/configuration references that actually name this database. Keep native `max_connections(1)`, disabled idle timeout/max lifetime, shared adapter queue, and the patched TanStack persistence adapter.

Do not read, transform, or delete the old `github-client.sqlite`. The new build starts empty and resynchronizes using the retained credential. Old cached rows, local drafts, viewed-file state, and inbox ordering/snooze/settled preferences are not imported; this is the accepted data-loss boundary. Do not clear keychain secrets, browser session token storage, theme, window state, update dismissal, signed-out state, or unrelated presentation preferences. The offline viewer bootstrap snapshot remains an authentication bootstrap value, not a second canonical profile store. No database reset is performed during planning.

Rollback consists of using the prior binary/build, which opens the old filename. New edits in the normalized database will not appear in that old build. Keep the old file untouched during this change; later disk cleanup is a separate decision. Collection schema versions remain explicit for the new model, without a compatibility migrator or dual-write period.

## Implementation sequence

1. Define scoped canonical types, natural key helpers, typed relation collections, and observation metadata. Add focused fixtures for duplicated PRs, repository summaries, and nested details. Establish identity and sparse-merge invariants before replacing consumers.
2. Move group/repository/actor ingestion and PR list/detail/file ingestion through canonical writes. Replace inbox deduplication over group copies with joins, preserving preference behavior and view DTOs. Update review and merge mutations alongside their new write targets so no writer can resurrect the old shape.
3. Normalize workflow/run/job/step ingestion and Actions mutations. Resolve checks to canonical identities and preserve head/attempt-specific freshness, permissions, and log behavior.
4. Replace repository payload caches with canonical ingestion plus ID-only result membership. Cover catalog, summary, PR pages, releases/assets, branches, contents, and README. Rework cache hydration, pagination, refresh, and budget pruning to obey shared ownership.
5. Complete desktop selectors, draft/preferences references, sign-in/out clearing, and persistence initialization. Switch both platforms to the new database version only as part of the coherent change. Remove obsolete aggregate collections, duplicate-payload writes, and migration-only scaffolding before the refactor is considered complete.
6. Run targeted behavior tests and full required gates, inspect wide/narrow UI behavior, and verify a real persisted reload. Add the desktop Changeset required for core/app behavior changes. Report local checks separately from CI, packaged desktop proof, and release; publishing or live operations are not part of this approval.

Stages depend on the identity/write contract established first. They are implementation organization, not permission to ship a half-normalized model.

## Acceptance and verification

| Invariant | Meaningful proof |
| --- | --- |
| One current entity across all views | A PR returned in two groups, a repository page, and detail produces one PR row and ID relations. Updating its title/state changes every view. A repository catalog and summary enrich one repository. Assert persisted rows, not only rendered labels. |
| No entity payload aggregates | Inspect the complete collection schema and representative persisted fixtures for all mapping-table rows. No group repo array, PR label/target payload array, detail timeline/thread/check array, file array, job step array, release asset array, or resource entity `data` remains. Opaque bodies and comparison snapshots remain intentional values. |
| Sparse and ordered observations | List refresh preserves detail-only fields. Older requests do not regress lifecycle/head; previous-account responses are discarded. Partial pagination/error cannot remove unseen members. Complete empty response can clear its own membership only. |
| Stable identity and isolation | Two hosts/accounts with equal numeric IDs and equal routes remain isolated. Repository rename preserves references through stable ID. Paths and refs containing slashes/separators do not collide. Actor/profile changes propagate without rewriting embedded copies. |
| Lifecycle and local work | Removing one membership preserves the entity and others. Draft commit positions survive newer heads; failed review preserves drafts. Snooze, settle, wake, pin/order, terminal observations, and undo continue to pass existing behavioral tests. |
| Mutations and refresh race | Resolve/review/merge/rerun updates all dependent views; failed optimism rolls back without erasing a newer refresh. Preserve existing stale-head action tests and forced-refresh-after-persistence regression coverage. |
| Cache and persistence | Shared entity survives eviction of one page; unreferenced owned children can be pruned. Hydrated result order, hasMore, empty, failed-more-page retry, budget handling, and incomplete-write recovery behave correctly. Await persistence readiness before reload assertions. |
| Clean start and rollback boundary | Seed old-name fixture DB, open new build, prove empty new domain store and retained credentials/settings. Restart and verify new rows persist. Confirm old fixture file remains unchanged and old-name initialization can still read it. Test browser and native names and native transaction affinity. |
| User-visible parity | Existing inbox/group/detail/review/Actions/repository browsing flows pass, including releases, files, README, pagination, loading/error/retry and external links. Inspect wide and narrow layouts; browsing remains read-only except explicitly initiated existing actions. |

Extend existing suites in `packages/core/src/sync`, `collections`, `repository-cache.test.ts`, `repositories.test.ts`, `inbox*.test.ts`, and `actions`; extend existing desktop E2E fixtures and relevant navigation/detail/Actions tests rather than adding brittle shape-only UI assertions. Run core tests, desktop E2E, `bun run typecheck`, `bun run lint`, repository build checks, native database tests, and `bunx changeset status --since=origin/main` as required by the checkout's workflows. Install locked dependencies as needed; this checkout currently lacks `node_modules`. Record any environmental blocker instead of treating an unrun gate as passed.

## Review boundary

This Markdown is canonical; `plan.html` presents the same proposal. Approval authorizes the normalization scope, accepted local-data clean start, and implementation sequence above. No application edits, database deletion, reset, publication, or deployment have been performed for this plan. The Plannotator structured decision will be stored in `review.json`; implementation must wait for an approved decision.
