# Repository releases

Add a read-only Releases tab so people can inspect versions, notes, and downloadable assets without leaving repository context.

## Proposed behavior

- Add Releases beside the current repository tabs. Preserve repository/tab context in the URL, including reloads.
- Show release name (falling back to tag), tag, published date when available, and Draft / Pre-release labels. Preserve GitHub’s returned order; do not infer a Latest badge.
- Provide expandable notes as plain-text Markdown, preserving whitespace and wrapping long lines. Show “No release notes” when absent. The current GitHubHtml component expects rendered HTML, so it cannot render this Markdown directly.
- List attached assets by name and size. Open asset links and “Open on GitHub” through the existing external-browser helper. Private assets may require browser sign-in; this is not a built-in downloader.
- Fetch when the tab opens. Reuse repository cache, loading, refresh, error/retry, empty-state, and Load more behavior. Say “No releases yet” only after a successful empty response.

## Scope and assumptions

Assumption for approval: “releases section” means read-only browsing inside each repository. Notes and assets come from the same list response.

Out of scope: create, publish, edit, delete, upload assets, rendered Markdown, notifications, a global releases feed, plain Git tags, or automatic downloads. No new dependency, schema migration, or separate cache.

Respect GitHub visibility: drafts appear only when returned for the authenticated user. Existing credentials may lack Contents read permission; show the API error and preserve the GitHub escape link rather than changing authentication scopes.

## Implementation sequence

1. Add a small release/asset model and paginated GET /repos/{owner}/{repo}/releases mapping in packages/core/src/repositories.ts. Reuse RestClient and map only fields needed by the view, preserving optional name/body/dates.
2. Add a releases page kind in packages/core/src/repository-cache.ts and dispatch it through apps/desktop/src/app/repository-cache.ts. Preserve account, host, repository, and page isolation; reuse useRepositoryPages, loadMore, and existing refresh behavior.
3. Extend tab validation in apps/desktop/src/app/router.tsx and add the tab/view in apps/desktop/src/screens/repository.tsx. Reuse UI primitives and openExternal. Keep the view local unless its size warrants one focused component.
4. Extend existing API fixtures and behavioral tests, run focused checks and repository-required type/lint gates, then inspect desktop and narrow layouts.

## Acceptance and verification

- Extend packages/core/src/repositories.test.ts for endpoint/query parameters, release and asset mapping, optional name/body/date, draft/prerelease flags, pagination, and error propagation.
- Extend existing cache tests only where needed to prove release pages remain isolated across accounts, hosts, and repositories and follow existing refresh/pagination behavior.
- Add release fixtures in apps/desktop/e2e/fake-github.ts and repository coverage in apps/desktop/e2e/contextual-navigation.spec.ts. Verify tab/reload navigation, notes/assets, Load more, loading/results, empty, and failure/retry states. Confirm the browsing flow makes no release write requests.
- Verify keyboard-operable notes, external link handoff, wrapping of long names/notes, and continued navigation through existing repository tabs. Favor user-visible behavior over screenshot-only assertions.
- Report local checks separately from remote CI or desktop runtime proof. Stop when this browsing scope passes; do not expand into release management.

## Evidence and review decision

The repository screen already has “More on GitHub → Releases”; the proposed tab adds in-app browsing. Existing repository read/cache/page patterns support this without another data layer. No CodeGraph index exists in this checkout.

GitHub’s list endpoint supplies notes and asset URLs, supports page/per_page, excludes plain tags, and restricts draft visibility. Official source: https://docs.github.com/en/rest/releases/releases#list-releases

This Markdown file is canonical; plan.html presents the same proposal. Application changes require approval through the requested Plannotator gate. Its structured decision will be saved to review.json; no approval is assumed here.
