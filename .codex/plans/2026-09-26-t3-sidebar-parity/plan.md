# T3-style PR sidebar: interaction parity

Date: 2026-09-26 · Status: proposed, approval required

## Outcome
Make the PR sidebar behave like the T3 Code nightly the user runs: stable arranged work, direct row actions, predictable drag destinations, compact parked rows, and remembered sidebar geometry. Keep GitHub PR identity, CI/check summaries, private inbox state and the contribution calendar.

This is a new scope proposal. The previous approved layout excluded pinning and dragging. Approval here authorizes these additions; the prototype itself changes only synthetic browser data.

## Evidence
Reference: T3 Code 0.0.43-nightly.20260926.2282, commit 6530de0339d2ca49957d0039133c49e3a08557f7. Research covered source and unit tests, not live drag gestures or execution of T3's test suite. Current GitHub-client baseline: 4f55439.

- [Pointer threshold and cancellation](https://github.com/pingdotgg/t3code/blob/6530de0339d2ca49957d0039133c49e3a08557f7/apps/web/src/components/Sidebar.pointer.ts#L17-L48)
- [Drop transition rules](https://github.com/pingdotgg/t3code/blob/6530de0339d2ca49957d0039133c49e3a08557f7/apps/web/src/components/Sidebar.logic.ts#L162-L333)
- [Saved ordering and Undo behavior](https://github.com/pingdotgg/t3code/blob/6530de0339d2ca49957d0039133c49e3a08557f7/docs/user/thread-sidebar.md#L28-L81)
- [Row density and surfaces](https://github.com/pingdotgg/t3code/blob/6530de0339d2ca49957d0039133c49e3a08557f7/apps/web/src/components/Sidebar.tsx#L1388-L1417)
- [Sidebar geometry](https://github.com/pingdotgg/t3code/blob/6530de0339d2ca49957d0039133c49e3a08557f7/apps/web/src/components/AppSidebarLayout.tsx#L210-L248)
- [Motion and reduced-motion handling](https://github.com/pingdotgg/t3code/blob/6530de0339d2ca49957d0039133c49e3a08557f7/apps/web/src/components/Sidebar.motion.ts#L1-L100)

## Recommended scope
Deliver stable ordering, pinning, single-item dragging, row actions, keyboard equivalents, exact-state Undo, compact parked rows and resizable/persisted sidebar presentation together. Retain current routes and the existing private inbox state model.

Defer modifier-click multi-selection and bulk mutations to a later slice. They require separate selection, partial-failure and bulk-Undo rules; they are not necessary to make single-PR dragging and row actions coherent. Also defer URL-backed inbox selection, cross-device ordering, auto-settlement policy changes, full GitHub checks pagination, and T3-specific terminal/agent actions. These deliberate differences are visible in the review rather than implied parity.

## Prototype contract
The standalone prototype and its embedded copy use invented PRs. They demonstrate selection, Pinned/Active/parked presentation, single-item state changes, drag feedback, order changes, resizing, Undo, search and the effect of incoming activity. Browser-only UI preferences may persist; mock PR mutations reset with the demo. No GitHub requests, commits, merges, production writes or app-source changes occur.

The contribution calendar and main PR conversation/checks are illustrative fixtures. The prototype does not prove persistence, native drag handling, network rollback or database compatibility; those are implementation acceptance checks. Labels on prototype controls identify any omitted interaction.

## Information hierarchy and surfaces
Use one Inbox sidebar and one detail canvas. The compact fixed header combines search and a scope chooser. Existing personal/starred/org/team destinations remain in the chooser; Involving me / All synced PRs and Failures remain available without adding another full-height header strip.

Pinned and Active rows target about 82px, with repository plus status/time, PR title, then compact branch/number metadata. Allow necessary growth for accessibility rather than clipping enlarged text. Snoozed and Settled rows target 36px, with a repository mark, a truncated title with an accessible full label, and concise wake/settlement information. Hover or keyboard focus reveals actions while preserving PR identity and critical failure indications.

Use distinct treatments for open PR, hover and keyboard focus. Muted shell, flat canvas, quiet dividers and elevated menus define the layers. Keep the contribution calendar above the account footer, collapsible on short/mobile layouts. No nightly artwork is required: that was an optional T3 build-identification feature.

## Interaction rules
### Navigation and actions
Ordinary click or Enter/Space opens the PR. Row buttons stop propagation. Hover/focus reveals Pin or Unpin, Snooze where applicable, and Settle/Restore/Wake. A menu exposes equivalent labeled commands plus Move up and Move down. Touch users always have an accessible menu button; commands do not depend on hover.

Opening a row menu never changes the currently open PR. Moving a background PR leaves detail unchanged. Settling or snoozing the open PR keeps its detail visible, matching our current PR-review workflow; its selected parked row remains discoverable when that shelf is collapsed. This deliberately differs from T3's next-thread/draft navigation.

Preserve j/k navigation and / search. Keyboard navigation reveals the selected row in its scroll region. Escape first closes a menu or cancels drag, then performs existing detail-back behavior only when no overlay/gesture handled it. Mobile Back restores the list's search, scope, disclosures and scroll position.

### Drag destinations
- Pinned: pin an Active PR, or wake/restore a parked PR and pin it, at the indicated position.
- Active: reorder Active PRs; unpin a Pinned PR at the indicated position; wake Snoozed or restore Settled at the indicated position.
- Settled header or shelf: settle the PR locally, clearing pin and active position. A collapsed/empty Settled shelf is a valid target. Already-settled drops are no-ops.
- Snoozed: not a drop destination; choose a wake time through Snooze. Snoozed rows can be dragged out.
- Same-slot or outside drop: no mutation. No multi-row drag in this slice.

Activate after 6px primary-pointer movement, excluding nested controls. Display an insertion gap and a drag badge naming Pin, Unpin, Settle, Restore or Wake. Section targets remain visible without changing layout height. Preview is temporary; only a valid drop commits. Cancel on Escape, pointer cancellation, lost primary button, blur, page hide, resize or unmount; suppress the trailing click.

Desktop pointer dragging is the first supported gesture. Touch users use row menus and Move up/down in this slice; do not hijack vertical scrolling with touch drag. Keep accessible action equivalents even though T3's researched drag sensor is pointer-only.

### Search and scope
Search and scope filter rows without replacing the underlying account-wide order. Reordering relative to visible neighbors preserves hidden entries' relative order: resolve the drop's before/after PR ID in the full section order, then move only the dragged PR. Disable drag and Move up/down while the cross-state Failures view is active because it has no single section order. State actions remain available there and never clear a snooze merely by viewing it.

### Ordering and lifecycle
Pinning is presentation within Active, not a fourth inbox lifecycle state. Pinning keeps the prior Active position so menu Unpin can restore it. An explicit drag into Active chooses a new Active position. Snoozing retains prior pin and Active positions while the PR is shown in the Snoozed shelf; menu Wake returns to that prior pinned or Active placement. An explicit drag to Active clears pinning and chooses a new position; a drag to Pinned chooses its pinned position. Settling clears both pin and Active position; restoring places it at the top of Active. Snooze expiry follows menu Wake and restores the retained pinned or Active placement. Automatic reactivation of a Settled PR retains its existing eligibility rules and returns unpinned at the top.

When first adopting ordering, seed current active PRs in their current displayed order. Newly discovered Active PRs subsequently appear above existing work in a deterministic batch order. Later GitHub updates change badges/time, not arrangement. Pinned remains first; Snoozed sorts by wake time ascending; Settled by local changedAt descending. Do not delete saved preferences just because a PR is absent from a partial sync.

### State transition reference
- Pin: lifecycle Active; retain Active slot; assign chosen Pinned slot.
- Menu Unpin: lifecycle Active; clear Pinned slot; retain prior Active slot.
- Snooze: lifecycle Snoozed; retain both slots; set wake time.
- Menu Wake or expiry: lifecycle Active; clear wake time; retain both slots.
- Drop into Active: lifecycle Active; clear pin/wake; assign chosen Active slot.
- Drop into Pinned: lifecycle Active; clear wake; assign chosen Pinned slot, preserving/creating an Active fallback slot.
- Settle: lifecycle Settled; clear pin/wake and both slots; set settlement time.
- Restore or qualifying settled reactivation: lifecycle Active; clear pin/wake; assign top Active slot.
- Same slot, Settled to Settled, forbidden Snoozed target, canceled/outside drop: no write.

### Undo and failures
Each successful single action produces a five-second Undo notice; Cmd/Ctrl+Z invokes it outside editable fields. Capture the previous rows for every order/state change, including positions of affected neighbors. Undo restores that exact snapshot, not a generic Active state. Only the latest action is undoable; a newer change to any captured row or automatic reactivation invalidates the claim so Undo cannot overwrite fresh work.

Show immediate drag preview, commit through one local preference transaction and await durability. On write failure restore the last committed presentation, retain selection, show a readable error and offer retry; do not report success. Disable duplicate commands for the pending PR. This is local organization only and never merges, closes or resolves a GitHub PR.

## Sidebar geometry and motion
Default width 256px; minimum 208px. Clamp maximum to leave 640px for detail where the viewport permits. Below the combined minimum, use the mobile list/detail pattern rather than horizontal page overflow. Resizing uses pointer capture; double-click the rail resets width. Provide a keyboard-operable separator with Left/Right adjustments and Home reset.

Persist width and shelf expansion under versioned app preference keys, scoped to account for shelf state. Clamp saved dimensions on viewport resize. Preserve scroll when pinning, unpinning or settling; only intentional keyboard navigation scrolls to the selected row. Settled history initially shows 10 rows with Show more adding 25. Keep the currently selected parked item accessible without forcing the whole shelf open.

Use 150ms ease-out layout transitions and respect prefers-reduced-motion. Avoid a second animation when committing a drag preview. No scroll jumps from changing divider heights; source rows and menus retain meaningful accessible labels during motion.

## Data and code design
Extend InboxPreference with optional activeOrder and pinOrder integer fields. Existing records remain valid with absent fields. No hashing, server ordering, fractional-key framework or separate state database. The saved Active sequence includes all non-settled ranked rows, including temporarily Pinned/Snoozed rows; the saved Pinned sequence includes snoozed pinned rows. Renumber the complete affected saved sequence, including those dormant entries, in one batched upsert. Render only the applicable visible state. This preserves reserved placement and avoids rank collisions when parked PRs wake. Missing or inaccessible PRs keep their saved slot; if a predecessor is permanently removed, remaining relative order is preserved. Stable PR node IDs identify rows independently of group copies. Rank-only edits preserve lifecycle changedAt and snapshot; settling/waking/reconciliation alone update lifecycle metadata under their existing contracts.

Do not bump the current collection schemaVersion merely to add optional fields: this repository drops older cached rows on a version bump, which would erase local snoozes and settled state. Add compatibility tests that hydrate the current row shape unchanged. Seed ranks lazily after account preferences hydrate; do not reset the cache.

Update every preference constructor, snooze, settle, restore, expiry/reactivation and Undo path to preserve or intentionally clear the optional fields. Serialize read/compute/write for Inbox preference operations at the client boundary, including reconciliation, so a sync reaction cannot overwrite a newer reorder. Existing collection writes already batch and serialize commits; the mutation boundary must also protect the computation that precedes them.

Reuse restoreInboxPreference semantics for exact-state Undo, extended to one batched captured snapshot where reorder touches multiple rows. Recheck captured rows before applying Undo. Pure functions determine effective section, target insertion and changed preference rows; React handles rendering and gesture previews.

Use @dnd-kit/core and @dnd-kit/sortable with modifiers/utilities only as needed, matching the package family used by the pinned T3 release. Keep the integration local to Inbox, with a small cancellation-aware sensor and pure drop rules; do not port T3's entire Sidebar. Verify React 19 compatibility and lock the dependency changes as part of implementation. The prototype uses a dependency-free pointer simulation and does not substitute for the production sensor tests.

## Delivery and ownership
1. Core behavior: packages/core/src/inbox.ts, client.ts and focused tests. Add backward-compatible rank fields, deterministic seeding/insertion, batched mutation serialization, state transitions and exact Undo. Prove old preferences and account isolation before UI integration.
2. Sidebar interactions: apps/desktop/src/screens/inbox.tsx and small focused sidebar components/helpers. Add row variants, menus, pin/order, drag preview/commit, keyboard alternatives and parked-history paging. Keep current PR selection and existing source queries in their owners.
3. Presentation: layout.tsx and styles.css only where necessary. Persist resize/shelves; add reduced-motion transitions, compact header and focus/scroll behavior. Retain shared detail, check summaries and ContributionCalendar behavior.
4. Proof: extend existing fake GitHub fixtures and browser suite; add core tests, native pointer smoke checks, release changeset and targeted review. No unrelated route, settings, CI or GitOps work.

## Acceptance and validation
- Drag transitions, empty targets, same-slot no-op, six-pixel threshold and cancellation are tested independently of DOM style classes.
- Pin/order survive reload and sync; updates do not reshuffle rows. Old snooze/settle records hydrate unchanged; accounts stay isolated.
- A drop while filtered preserves hidden-item order. Failures view cannot accidentally reorder mixed sections.
- Exact Undo restores prior pin/state/wake/positions; expired or stale claims do nothing. Failed persistence is visible and does not pretend success.
- Mouse click, row menu, keyboard and touch action alternatives remain usable. Nested controls never start dragging or open another PR.
- Shelf disclosures and width persist; selecting/moving rows preserves appropriate focus/scroll. Short windows retain usable Active content and footer access.
- Verify 1440/1024/390px, light/dark, reduced motion, large text, long names, empty sections, many parked rows and offline/error states. Exercise actual desktop webview drag cancellation separately from browser tests.
- Run root typecheck, lint, test and build; run the desktop test:e2e script from apps/desktop. Run the focused React regression check and independent spec/correctness review. Report browser, native and live GitHub evidence separately.

## Risks, rollback and decision
The main risks are lost ordering during reconciliation, accidental click-after-drag, stale Undo overriding new activity and parked rows consuming the viewport. Keep pure transition rules, serialized local writes, snapshot validation and bounded layout regions.

Rollback restores the prior UI while leaving additive optional fields in stored records. No destructive migration or cache reset is allowed. Rolling back the application may stop preserving ordering through later state changes, but must not lose snooze/settle data.

Approve this plan and prototype together before application implementation. The proposed scope includes Pinned/manual order/DnD and explicitly defers bulk selection. Record the structured Plannotator decision in review.json; requested changes update both artifacts and repeat review.
