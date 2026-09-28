# Stop syncing starred repositories

Status: Awaiting approval. Author: Astra. Date: 2026-09-28.

## Outcome and scope

Stop treating a GitHub star as a reason to fetch a repository or its pull requests. Keep discovery of all organizations and teams the signed-in user belongs to, with the existing paginated behavior. Keep the personal **Involving me** feed.

Scope assumption for approval: “personal account” means the existing `involves:@me` feed, which can include PRs the user participates in outside their organizations. It does not currently mean all PRs in personally owned repositories. A strict personal-owner/member-organization boundary would be a separate query change; revise this plan if that is the intended scope.

## Current evidence

- `packages/core/src/sync/groups.ts:41-45`: group discovery requests organizations, teams, and up to 10 pages of starred repositories. Lines 102-113 create a Starred group and add its repositories to the shared cache.
- `packages/core/src/client.ts:385-430`: background sync registers every group and immediately refreshes new groups. Persisted groups start polling before discovery finishes, so removing only the REST call leaves a startup request path.
- `packages/core/src/sync/pulls.ts:103-137`: each group produces paginated GraphQL PR searches and stores group-specific copies.
- `packages/core/src/inbox.ts:68-111`: Inbox deduplicates all cached PR copies. Removing a group alone does not hide its old PRs.
- `apps/desktop/src/app/boot.tsx:25-27,112-116`: one client is created before authentication restoration; the ready path starts polling before rendering the app.

## Chosen approach

Remove the Starred source and retire its cached group/PR copies. Hiding only navigation would leave API traffic running. Adding an opt-in setting would add UI and state beyond this request.

### 1. Remove discovery and prevent every starred polling path

- Remove `/user/starred` enumeration, Starred group creation, and starred-derived repository upserts from `sync/groups.ts`.
- Preserve organization/team pagination, cached membership fallback, inaccessible-team handling, and personal involvement query semantics.
- Exclude legacy Starred groups from background registration and make direct watch/refresh of a legacy Starred group perform no network work. Keep a query-level guard so legacy cached groups cannot generate searches.
- Retain the legacy `starred` group discriminator only where needed to recognize persisted data; do not introduce a schema reset or a new setting.

### 2. Retire old cached rows before displaying the app

- Add a small core initialization operation that preloads groups and PRs, removes the legacy Starred group and only PR copies whose `groupId` is `starred`, and awaits persistence.
- Invoke it in the existing client creation promise before authenticated startup or offline fallback can render or start polling. Use existing collection APIs; repeated execution is harmless.
- Preserve organization/team/personal copies of overlapping PRs, repository metadata, repository resource caches, PR detail/file caches, drafts, and Inbox preferences. Shared repository metadata does not itself initiate polling.
- The existing group-driven sidebar, dashboard, and command palette should cease offering Starred once initialization finishes. Check legacy group routes safely fall back or show the existing missing-group state without requests.
- Keep current startup error handling if local cleanup cannot persist; do not conceal a failed cleanup or delete the database.

### 3. Prove behavior and record the change

- Discovery tests: no starred endpoint requests; member organizations and teams remain complete across pages and retained on unchanged responses; starred repositories are not inserted via discovery.
- Core client tests: seed legacy Starred group and PR rows alongside overlapping personal/organization copies; initialization removes only retired copies and is idempotent. Preserve preferences and drafts. Exercise startup while discovery is delayed/fails and direct watch/refresh; assert zero starred-origin GraphQL searches.
- Query tests: legacy Starred group yields no queries; retain team repo-query splitting coverage using team fixtures.
- Browser regression: after startup/reload, Starred is absent, personal and organization/team navigation works, and request recording contains no starred REST or starred-only PR search calls. Use mocked GitHub traffic to avoid consuming the user's API allowance.
- Add a desktop patch changeset. Run repository lint, typecheck, unit tests, and desktop browser tests as required by the web CI job. Report actual results and any unavailable gates; native code is outside this change.

## Acceptance and limits

Zero automatic `/user/starred` requests or PR searches caused solely by starring, including cached startup and manual refresh of an old group. Organization and personal involvement feeds remain functional. No user drafts/preferences or unrelated caches are cleared.

This reduces requests; the exact savings depend on starred repo count, query pagination, and polling duration. No live quota measurement or API calls are needed for validation. Explicitly opening a repository or PR continues to fetch its requested content. Broader polling optimization, team/org deduplication, repository browsing features, and release/publishing are outside scope.

## Review

Approve this scope in Plannotator before implementation. Record the structured response in `review.json`. If the strict owner/member boundary is desired, revise both this Markdown and its generated HTML before re-review.
