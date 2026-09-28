# Inbox: quiet sections and automatic settlement

## Requested behavior
Hide the Pinned, Snoozed, and Settled headings even when they contain PRs. Reveal those headings as destinations during a valid drag, then hide them on drop or cancellation. Active keeps its heading. A merged or closed PR automatically belongs in Settled.

## UI decisions for approval
- PR rows remain visible at rest, grouped in their existing order. Empty auxiliary sections occupy no space. Keep subtle separators between populated groups.
- Remove collapse controls from Snoozed and Settled because their headings are hidden. Show their rows directly in the existing scrollable archive area, retaining Settled pagination and the selected-row exception. Ignore old stored collapse preferences; retain unrelated inbox view state.
- During dragging, show Pinned, Snoozed, and Settled targets, including empty ones. Preserve the dragged row and detail selection while headings appear. Clear the temporary targets on every existing cancellation path.
- Dropping onto Pinned pins the PR; dropping onto Active restores or unpins it; dropping onto Settled settles it locally. Dropping onto Snoozed opens the existing snooze-time choices for the dragged PR. Commit only after a valid time is chosen; dismissing the picker changes nothing. An already snoozed PR dropped on Snoozed is a no-op.
- Keep row actions for keyboard and touch use. Existing disabled-drag rules in scoped inboxes and the Failures view continue to apply. Only valid global Inbox drags reveal destinations.

## Automatic settlement
- A successful in-app merge marks the known PR as merged and settles it immediately after GitHub confirms success. Do not wait for the next open-PR list refresh, and do not settle a rejected merge.
- A known PR closed or merged on GitHub settles when sync confirms its terminal state. The app currently has no Close PR action; this change covers external closes without adding a new close button.
- Retain confirmed closed and merged PR rows locally so they remain available in Settled after open-PR refreshes and reloads. This covers PRs already known to the inbox; it does not import all historical PRs.
- Closed and merged PRs remain Settled despite head, review-request, or check changes. Hide local Restore, Pin, and Snooze actions for these terminal PRs and guard their core mutation paths. Ordinary manually settled open PRs retain their existing restore, snooze, and reactivation behavior.
- A closed PR observed as reopened returns to Active. Reopening is detected through normal open-PR sync or detail refresh. Merged PRs remain terminal.
- If GitHub succeeds but local persistence fails, show a distinct local-save failure with recovery that never repeats the remote merge. Preserve the confirmed lifecycle in memory and let a subsequent confirmed refresh retry local persistence.

## Evidence and implementation seams
- apps/desktop/src/screens/inbox-sidebar.tsx currently always renders Pinned and Active headings plus collapsible Snoozed and Settled shelves. inbox-parts.tsx registers only Pinned, Active, and Settled drop targets.
- inbox.tsx and inbox-drag.ts already track drag lifecycle and cancellation. Pass that state into section rendering. Extend the existing drop handler with a Snoozed branch that opens the existing row snooze picker; use the existing mutation and Undo path after time selection.
- inbox-model.ts currently gates archived rows on expansion. Make those rows visible independently of heading visibility; retain the archive height limit, pagination, filtering, and selected-row behavior. Remove the now-unused shelf expansion plumbing only.
- packages/core/src/client.ts merge currently performs the GitHub mutation and refreshes details without settling. packages/core/src/inbox.ts owns account-scoped settlement, ordering, and reconciliation.
- The PullRequest list model has no lifecycle state. Group sync searches only open PRs and replaces each group's rows. Detail queries already return OPEN, CLOSED, or MERGED. Add a compatible optional lifecycle field to cached list rows, treating legacy absent values as OPEN.
- Preserve confirmed terminal rows during scoped collection replacement. For previously known open PRs missing from a successful complete group search, verify their state using bounded existing detail reads before pruning. Deduplicate candidates by stable PR ID across group copies. A partial search, failed request, inaccessible PR, or missing search result alone must not settle anything.
- Propagate confirmed lifecycle observations to cached group copies and repository-scoped inbox rows. Use observation ordering so an older in-flight open result cannot overwrite a newer closure; a later authoritative OPEN observation can represent reopening. Keep this within existing collection and sync ownership, without a second archive store or a new polling service.
- Update repository-inbox-data.ts integration for previously known repository-only PRs too. Preserve scoped membership and account isolation when supplementing open REST pages with retained terminal rows.

## Delivery slices
- UI: conditional headings, always-accessible archived rows, Snoozed drop picker, existing row actions and selection preserved.
- Core: lifecycle mapping, confirmed merge settlement, bounded external-state verification, retained terminal rows, account-scoped reconciliation and guarded terminal actions.
- Verification: focused core tests and browser regressions, followed by repository-required checks. Implementation starts only after approval of this plan.

## Acceptance checks
- With populated Pinned, Snoozed, and Settled groups, their headings are hidden at rest and all PR rows remain reachable. Empty groups add no headers, placeholders, or archive border.
- Starting an eligible drag reveals all three destinations. Dropping, Escape, pointer cancellation, lost buttons, blur, resize, navigation, and unmount remove them without accidental mutations.
- Pin, settle, restore-to-Active, and snooze drops work with targets that appear after drag activation. Snooze cancellation changes no state; successful local moves persist and support existing Undo.
- Successful merge settles exactly the selected PR for the current account. Rejected merge leaves it unchanged. Local persistence failure is distinguished from remote failure.
- Confirmed external close and merge remain in Settled after complete refresh and reload, including scoped inboxes. Missing, partial, stale, failed, or inaccessible observations do not infer closure.
- Duplicate group copies and stale open responses do not resurrect terminal PRs. A later confirmed reopening returns a closed PR to Active. Manual settlement of an open PR still behaves as before.
- Update the inbox-order browser helper to activate dragging before measuring newly visible targets. Cover rows and focus during the resulting layout change. Wait for durable persistence before reload assertions.
- Run focused Vitest core suites, inbox-order/inbox-settings browser suites and affected scoped inbox coverage, typecheck, lint, and required build checks. Install the locked dependencies first because this checkout currently lacks node_modules. Report local results and any limits separately.

## Alternatives considered
Hiding only empty headings is smaller but does not meet the clarified request. Hiding whole populated sections would make PRs inaccessible outside dragging. Settling only in the merge button would miss GitHub closes and allow open-only sync to discard completed PRs. The proposed shared lifecycle handling addresses both requested outcomes.
