# Linear-inspired navigation and surfaces

Date: 2026-09-26
Status: Proposed; implementation requires approval.

## Outcome and evidence
Make personal work, organization/team scope and repository context easy to distinguish. Address both navigation hierarchy and visual surfaces while preserving the approved inbox behavior.

Current source already has a persistent desktop sidebar, nested group tree, mobile navigation and hash routes. Inbox stacks a header, explanatory strip, filters, local-action row and PR header. Actions and Settings lack a consistent navigation position. No dev server was listening on port 5173; this is source-based analysis, not runtime validation.

Inspected Linear references through Mobbin:
- Sidebar hierarchy: https://mobbin.com/screens/2679ae03-f852-47c3-a880-480c493c1369
- Breadcrumb, tabs and list: https://mobbin.com/screens/815793b1-5c75-43ac-94c7-93380781e337
- Detail surfaces: https://mobbin.com/screens/cef36326-d8ec-4c6f-acd4-a9f1e1060d33

The HTML mockup uses invented data and is an illustration, not a screenshot.

## Decision
Use focused shell and header restructuring. Cosmetic-only work leaves competing navigation rows; a routing overhaul adds unnecessary scope. Retain all current URLs, hash history, data ownership, permissions, persistence and group-tree semantics. Defer URL-backed inbox selection and new repository routes.

## Navigation
Keep a neutral persistent desktop sidebar. Group Inbox and existing personal/starred destinations under Personal, organizations and nested teams under Organizations. Preserve ordering within sections, counts, disclosure behavior and context-only ancestors. Search stays at the top; account and sync stay at the bottom. Active selection and keyboard focus must be distinct.

Use compact location context: Inbox / owner/repository / PR; organization / nested team for group browsing; owner/repository / Actions / run or Settings for repository screens. Link only to existing destinations. There is no repository overview route to invent.

Place repository Actions and Settings consistently in the context header of PR, Actions and Settings screens, and expose both on existing repository group headings. Keep inbox detail back-to-list behavior and browser history. For a directly loaded standalone PR with no in-app predecessor, provide an explicit Inbox link rather than guessing origin. Do not label a destination Pull requests unless an existing scope-correct route supports it.

## Inbox and detail composition
Keep scope, Active/Snoozed/Settled/Failures state controls and search next to the list they affect. Replace the permanent explanatory strip with a visible Local inbox label and keyboard-accessible help explaining local snooze/settle behavior. Offline, stale, unknown and failed checks remain text-labeled and visible outside help/overflow.

Combine selected PR identity, status and local actions in one coherent detail header. Render owner/repository and PR number once in the identity area. Keep Conversation, Files and Checks directly below. Preserve Undo, Restore, all action availability and separation between settle locally and GitHub merge/close/review. Use a small optional header/action slot in shared PullContent if needed; retain current state owners and tab behavior.

## Visual surfaces and responsive layout
Three levels: muted shell/sidebar; flat list/detail canvas with restrained separators; transient menus/dialogs/popovers with elevation. Use existing theme tokens and primitives, typography and spacing. Avoid nested cards for ordinary content. Preserve code/diff backgrounds, semantic status colors and visible focus. Do not add a permanent properties column that squeezes the split view.

Retain desktop sidebar and inbox list/detail split. Retain mobile drawer and list-to-detail flow with a labeled back control. Headers wrap without hiding status or causing page overflow. Long owner/repository names remain distinguishable; truncation has an accessible full label. HTML illustration stacks only for review readability and does not specify mobile interactions.

## Implementation ownership and sequence
1. apps/desktop/src/screens/layout.tsx: section grouping and active scope; reuse GroupNavNode/buildGroupTree.
2. apps/desktop/src/screens/inbox.tsx and screens/pull/pull-page.tsx: consolidate chrome and shared detail composition; preserve state and mutations.
3. screens/group-pulls.tsx, screens/actions/runs.tsx, screens/actions/run.tsx, screens/repository-settings.tsx (under apps/desktop/src): consistent location and repository links. Extract one small shared context component only where repetition warrants it.
4. apps/desktop/src/styles.css: apply existing surface tokens; touch packages/ui/src/styles/globals.css only if necessary, avoiding broad token changes.
5. Extend existing desktop E2E fixtures for changed behavior. Router remains a compatibility reference; no route migration, core sync/domain/storage or backend changes.

## Acceptance
- Personal and organization scopes are clear; team structure, counts and context-only parents still work.
- Location is readable; every breadcrumb link resolves to an existing destination.
- Repository Actions and Settings occupy a consistent position.
- Inbox filters, scope and selection survive the existing list/detail return flow.
- Active/Snoozed/Settled, Failures, Undo/Restore, expiry/reactivation and account isolation remain unchanged.
- Owner/repository and number distinguish PRs even when repository short names collide.
- Header consolidation removes the explanatory strip and redundant identity without concealing local semantics or freshness.
- Keyboard, desktop split and mobile return work with long labels, loading, empty and error states in light and dark.
- Settings Save/Cancel, permissions and Actions confirmations remain intact.

## Validation
Before editing, capture current relevant behavior using existing deterministic fixtures. After implementation run bun run typecheck, bun run lint, bun run test, bun run build and bun --cwd apps/desktop run test:e2e. Add behavior coverage for disclosure/selection, repository links, inbox return, focus and visible status, not CSS-class snapshots. Reuse existing domain tests.

Visually inspect approximately 1440, 1024 and 390 px in both themes: inbox with selected PR, group, standalone PR, Actions run and Settings. Include offline/stale, long labels and loading/error cases. Use fixtures without live GitHub mutations. Report local results separately from native desktop and live checks. Missing dependencies/runtime are limits, not passes.

## Risks and rollback
Risks: losing inbox context, hiding status, regressions in shared PullContent, shared tokens affecting diffs/settings. Keep state in current owners and test both embedded and standalone detail; prefer existing tokens at screen level. Roll back only this presentation diff. No migration, cache reset or preference conversion. Preserve unrelated work.

## Approval
Run plannotator annotate plan.html --gate --json --require-approval --result-file review.json from this directory. Record its structured decision. Implement only after approval; requested revisions update both plan artifacts and repeat review.
