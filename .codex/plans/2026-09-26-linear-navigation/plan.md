# T3-style PR sidebar with Linear-inspired surfaces

Date: 2026-09-26 · Revision 2
Status: Revision 2 approved in Plannotator and user chat on 2026-09-26.

## What changed in this revision
The attached T3 Code screenshot replaces the previous three-column inbox proposal. Use one PR sidebar and one main detail canvas. Add a Checks status/count summary and a signed-in-user GitHub contribution calendar. The user confirmed profile-style contributions, not commits alone.

## Evidence and references
The user's annotated screenshot shows Search, an Active thread list, selected-thread highlighting, and Snoozed/Settled sections at the bottom of one sidebar. Adopt that hierarchy for PRs. Pinned threads and T3-specific actions are not part of this change.

Current source has a persistent desktop sidebar in screens/layout.tsx, local inbox state in screens/inbox.tsx, shared detail in screens/pull/pull-page.tsx, and existing hash routes. The first proposal retained a redundant global-sidebar-plus-inbox-list structure; this revision removes that duplication on Inbox.

Inspected Linear references provide restrained visual hierarchy:
- [Sidebar hierarchy](https://mobbin.com/screens/2679ae03-f852-47c3-a880-480c493c1369)
- [Breadcrumb, tabs and list](https://mobbin.com/screens/815793b1-5c75-43ac-94c7-93380781e337)
- [Detail surfaces](https://mobbin.com/screens/cef36326-d8ec-4c6f-acd4-a9f1e1060d33)

The HTML mockup uses invented PRs and synthetic calendar values. No app runtime proof is claimed; no dev server was listening on port 5173 during the first review.

## Decision and boundaries
Use a T3-style single sidebar for Inbox, with Linear-inspired surfaces and compact context. A cosmetic-only pass leaves duplicate navigation; a full route migration is unnecessary. Keep existing URLs, permissions, data ownership and local inbox semantics. URL-backed inbox selection and pinning remain deferred.

The contribution calendar is a newly requested, read-only data slice. It is the only planned expansion into the GitHub client data API. No database migration, new backend, repository/team administration or unrelated workflows.

## Single sidebar and navigation
On Inbox, the shell renders one sidebar approximately 300–340px wide and the PR canvas. Do not render the existing 240px group rail next to another inbox list. Inbox owns its list, selection, filters and mutations; Layout provides a narrowly scoped route presentation mode rather than copying inbox state into a global store.

At the top: app identity, a compact location/scope chooser, search, the existing Involving me / All synced PRs control, and a Failures filter. Scope chooser exposes Inbox and the existing personal/starred/organization/nested-team destinations with their counts and context-only ancestor semantics. Existing group routes continue to use the navigation tree; the same chooser provides a predictable return to Inbox. Reuse existing UI popover/disclosure primitives and group tree rendering without a generalized sidebar framework.

Active is the expanded, independently scrolling main PR list. Each row shows owner/repository, title, number, update time and meaningful status. Use one subdued selected-row fill. Snoozed and Settled are collapsible sections below Active, with counts; expanding either reveals its PRs in a bounded scrolling region without pushing the footer off-screen. Multiple sections may be open. Selecting a row shows its detail; collapsing its section does not clear the selection.

Apply search and inbox scope across all sections. Section counts reflect their filtered rows. Failures switches the list area to one deduplicated cross-state failure list labeled Failures across all states; switching back restores the disclosure state and does not mutate PR preferences. Unknown/stale status remains text-labeled. No drag-to-settle or pin behavior is introduced.

The main canvas has compact origin/repository context and Actions/Settings links, then the PR title and local/GitHub actions, then Conversation/Files/Checks. Keep local settle clearly separate from GitHub merge/close. Do not add another inbox header or filter strip above the canvas.

For mobile Inbox, show the PR sidebar as the full-width list. Selecting a PR shows detail; a labeled Back to inbox control returns to the same search, scope, disclosure and scroll context. Desktop retains both regions. Group and repository routes retain mobile navigation access. Links never imply a nonexistent repository overview destination. Direct standalone PRs have an explicit Inbox link when no origin is known; preserve browser history.

## Checks: status and counts
Replace bare Checks 3 with a compact icon and explicit breakdown, for example Checks · 2 passed · 1 failed / 3 loaded. At narrow widths show a status icon and compact counts with an accessible full summary and keyboard/touch-accessible explanation.

Derive counts from the existing detail.checks collection and reuse components/status.tsx runState normalization. Track success, failure, pending/running, skipped, cancelled and neutral separately; skipped/cancelled/neutral never inflate passed. Counts sum to the displayed loaded total. Zero checks says No checks; unloaded data says Loading checks; stale/error/offline remains visible.

The current query loads contexts(first: 100), without complete pagination metadata. Label the denominator loaded checks, and explain the 100-context limit. Do not claim the count is a complete GitHub total or declare an overall successful rollup from partial data. The icon indicates an observed failure or pending check; otherwise it describes the loaded checks only. Full check pagination is outside this change.

## Contribution calendar
Show a compact 13-week GitHub profile-style Contributions calendar above the account/sync footer in the Inbox sidebar. Make it collapsible on small/short windows so it never displaces PR navigation. Provide View year in an accessible popover with the full returned year and a textual date/count readout. Grid cells expose date and contribution count on pointer and keyboard focus; use one roving tab stop and arrow-key navigation instead of hundreds of tab stops. A text summary and legend convey meaning without color alone.

Use the signed-in viewer's contributionsCollection.contributionCalendar through the existing authenticated GraphQL client, returning date, weekday, contributionCount and contributionLevel grouped by weeks. Request an explicit trailing-year range; display GitHub's date strings without timezone shifts. Derive recent weeks by slicing the returned calendar, not by summing cached PRs. Label everything contributions, not commits.

Use an account/session-scoped in-memory snapshot and fetched timestamp. Fetch once when the widget first mounts, reuse for an hour across route changes, refresh on next mount/focus when older than an hour and on explicit retry; coalesce in-flight requests. Discard results after sign-out/account change. No 15-second polling and no persistent-cache migration. Cold offline shows Unavailable; failed refresh can keep a labeled stale snapshot. Error/rate-limit/missing permissions never become zero activity. Zero is shown only after a successful response reporting zero.

Private contribution visibility follows GitHub's returned data and token permissions. Do not automatically request broader scopes, expose private repository names or promise parity with a profile viewed under other credentials. GitHub documents that private/internal contributions need the optional read:user scope. Source: [GitHub GraphQL users reference](https://docs.github.com/en/graphql/reference/users#contributionscollection).

## Visual surfaces
Three levels: muted sidebar/shell, flat main canvas with restrained separators, elevated transient popovers/dialogs. Use existing theme tokens/primitives, clear type sizes and spacing. Reserve filled treatments for selection and meaningful controls. Keep focus and semantic status colors legible in light/dark. Avoid nested cards around normal content and decorative changes to code/diff backgrounds. No permanent properties column narrowing the PR canvas.

## Implementation sequence and ownership
1. apps/desktop/src/screens/layout.tsx and screens/inbox.tsx: one-sidebar Inbox presentation and section-based PR list; keep inbox state in its current owner. Reuse existing organization tree in a small shared scope chooser if necessary. No duplicated query/mutation ownership.
2. screens/pull/pull-page.tsx and components/status.tsx: coherent detail header and shared check summary. Only add a small action composition seam where needed. Test embedded and standalone PR views.
3. screens/group-pulls.tsx, screens/actions/runs.tsx, screens/actions/run.tsx and screens/repository-settings.tsx: consistent existing-route context and repository Actions/Settings links. Paths in steps 1–3 are relative to apps/desktop/src.
4. packages/core/src/client.ts plus a small dedicated GitHub contribution query module: read-only viewer calendar and account/session-scoped cache using current API conventions. Add focused query/cache tests. Exact module placement follows the existing client organization; no synced collection or poller needed.
5. apps/desktop/src/components/contribution-calendar.tsx: reusable calendar presentation and accessible date details; compose into Inbox footer. apps/desktop/src/styles.css applies existing tokens. Change shared theme tokens only if necessary.
6. Extend desktop mocked E2E fixtures and behavior tests. No router migration, new backend or storage changes.

## Acceptance
- Inbox has exactly one sidebar and one detail canvas at desktop widths; no redundant group rail or full-width inbox filter header.
- Existing personal/organization/team destinations remain discoverable with correct hierarchy and permissions.
- Active/Snoozed/Settled sections, filtered counts and Failures across all states work without changing local preferences.
- Inbox selection, search, scope and disclosure/scroll context survive the list/detail return flow.
- Snooze, settle, Undo/Restore, expiry/reactivation and account isolation keep existing semantics.
- Repository identity remains unambiguous; Actions and Settings links resolve to existing routes.
- Check categories sum to loaded count, never call skipped passed, and disclose the current pagination limit. Loading/zero/stale/error states are distinct.
- Contributions use real API calendar dates/counts; private-data limits, zero, unavailable, stale and account-switch behavior are truthful.
- Keyboard/touch access works for chooser, disclosures, status details and calendar; long labels and short/narrow windows remain usable in both themes.
- Settings Save/Cancel, capability checks and Actions confirmations remain intact.

## Validation
Capture relevant existing fixture behavior before implementation. After approval run bun run typecheck, bun run lint, bun run test, bun run build and bun --cwd apps/desktop run test:e2e. Add behavior tests for section selection/disclosure, Failures without preference mutation, repository links, mobile return, check-state categories and contribution fetch/cache/account isolation. Avoid CSS-class snapshot tests.

Inspect approximately 1440, 1024 and 390px widths plus a short desktop window in light/dark. Cover selected Inbox PR, collapsed/expanded sections, no PR, standalone PR, Actions and Settings; check long labels, offline/stale/loading/error and calendar focus. Use fixtures without live GitHub mutations. Report local proof separately from native desktop/live checks and report missing dependencies/runtime honestly.

## Risks and rollback
Risks: duplicated sidebar state, lost list context, hiding status, misleading check totals, calendar squeezing navigation, stale data leaking across accounts. Preserve current state owners, explicitly label loaded counts, bound calendar height, and scope calendar cache to the session. Test both embedded and standalone detail. Revert the presentation/calendar diff to roll back; no migration or cache reset is needed. Preserve unrelated work.

## Review decision
Revision 1 returned annotated, not approved. Preserve it as review-rev1.json. This revision incorporates all three comments and the user's profile-style calendar answer. Open plan.html with plannotator annotate --gate --json --require-approval --result-file review.json. Implement only after approval; revisions update both artifacts.
