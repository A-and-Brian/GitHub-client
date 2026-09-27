# Integrate native macOS window controls

Remove the separate gray macOS title bar and show the existing native traffic lights over the app’s sidebar header. Keep native window decorations and controls. Scope is window chrome and safe spacing; GitHub behavior remains unchanged.

## Evidence

- `apps/desktop/src-tauri/tauri.conf.json` currently uses standard decorations; window minimum is 900 × 600.
- `src/screens/inbox-geometry.ts` sets the inbox sidebar to 256px by default and allows 208px minimum.
- `src/screens/inbox-header.tsx` puts “PR inbox” and the Inbox chooser on one row. Adding a traffic-light inset to that row would crowd it.
- `src/screens/layout.tsx` owns all authenticated routes. Outside Inbox, its 240px rail starts with the Go to button.
- `src/app/boot.tsx` separately renders loading, setup and startup errors.
- `src/platform/index.ts` already exports `isDesktop`.
- `src-tauri/capabilities/default.json` lacks explicit permission to start dragging.

## Proposed layout

macOS Inbox sidebar, including the 208px minimum:

    ┌──────────────────────────┬─────────────────────────┐
    │ ● ● ●   drag    Inbox ▾  │ Existing PR detail      │
    │ PR inbox                 │ header and content      │
    │ Filter /       Scope     │                         │
    │ Failures  ↻  ⓘ           │                         │
    │ Existing PR rows         │                         │

Dots are illustrative: production uses native macOS controls, never HTML replacements.

Use a 40px top row with an initial 80px left safe area. Keep the Inbox chooser at the right. Place the PR inbox heading immediately below on macOS; filters and actions follow. The row inherits the sidebar background and has no separate title-bar divider. The PR detail stays full height.

For non-Inbox routes, place the same 40px native-control/drag slot at the top of the existing global rail; Go to stays full width directly below it. Other route content stays full height.

During loading, setup and startup failure, reserve the same top space inside a viewport-height Boot wrapper, with a blank drag area. Let setup occupy the remaining height without introducing extra scrolling. Do not add a global replacement title bar to the authenticated app.

## Implementation

1. **Native configuration.** Set the main window’s `titleBarStyle` to `Overlay` and `hiddenTitle` to `true` in `src-tauri/tauri.conf.json`. Preserve decorations, native control positions, dimensions and fullscreen behavior. These options are macOS-specific. Add only `core:window:allow-start-dragging` to the main window capability. Native buttons require no replacement command handlers.
2. **Shared window-chrome helper.** Add a small `src/components/window-chrome.tsx` that gates the inset and drag regions on Tauri plus a macOS platform check, reusing `isDesktop`. Keep the 40px row and 80px safe-area values in this one owner. Browser macOS and Windows/Linux desktop keep existing layout. Avoid a plugin dependency or fullscreen listener.
3. **Integrate existing surfaces.** Update `src/screens/inbox-header.tsx`, `src/screens/layout.tsx` and `src/app/boot.tsx` as described above. Adjust `src/screens/setup.tsx` only if needed to let its existing full-height container fit the Boot wrapper. Keep Inbox resizing limits and saved width unchanged.
4. **Restrict drag ownership.** Use dedicated blank `data-tauri-drag-region` elements beside the native controls. The chooser and every interactive element remain outside those elements. Never mark an entire header, sidebar, content pane, PR row or resize handle as draggable. Reserve native-control space even in fullscreen; macOS owns control visibility and reveal behavior.
5. **Validate and review.** Complete the checks below, inspect the focused diff, and report native evidence separately from browser checks.

All source paths above are relative to `apps/desktop/`. No new dependency, Rust window customization, custom traffic lights, data migration, or global header redesign is planned.

## Acceptance criteria

- macOS has no separate gray title strip or duplicate window title.
- Native close, minimize and fullscreen controls remain visible and usable in normal mode.
- Controls, heading and chooser fit at sidebar widths 208px and 256px and window minimum 900 × 600.
- Blank header space moves the native window; chooser, search, scope, refresh, links and keyboard navigation work normally.
- Sidebar resize and existing PR drag-and-drop retain their behavior.
- Inbox, groups, pull pages, repository settings, Actions list/detail, loading, setup and startup-error views avoid native controls.
- Fullscreen entry, exit and top-edge control reveal are usable; no custom fullscreen state or control emulation is introduced.
- Light/dark themes look continuous at the top edge.
- Browser and non-macOS desktop layouts retain their existing spacing and decorations.

## Validation

- Run `bun run typecheck` and `bun run build`.
- Run Biome against changed source/config files.
- Run relevant existing Playwright navigation and inbox-order checks with their existing fixtures. Add a targeted behavioral check only if existing coverage cannot prove a new interaction boundary.
- Run `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` to validate native configuration/capabilities.
- In a real macOS Tauri window, inspect both themes, 208px/256px sidebar widths, 900 × 600 minimum size, all listed routes and Boot states. Exercise controls, dragging, resizing, PR DnD, and fullscreen entry/exit/top reveal.
- Check browser rendering at desktop and narrow widths. Browser screenshots or mocked Tauri globals do not prove native control behavior.
- Record unavailable platform/native checks explicitly; do not claim equivalent native snapping or title-bar double-click behavior without testing it.

## Risks and mitigations

- **Native control geometry:** 40px/80px are initial layout values. Confirm on the installed macOS/Tauri version and adjust these shared constants if necessary; retain native placement.
- **Crowded sidebar:** separate the title and chooser rows on macOS, preserving the 208px minimum.
- **Pointer interception:** dedicated blank drag elements isolate native dragging from actions, PR DnD and the separator.
- **Missed startup state:** Boot owns non-router spacing, including errors; setup height must remain bounded by the viewport.
- **Fullscreen differences:** keep the safe area stable and verify native reveal/exit. Escalate an actual native limitation before adding Rust customization.

## Approval and rollback

Review `plan.html` through:
`plannotator annotate <plan.html> --gate --json --require-approval --result-file <review.json>`

Implementation starts only after an approved structured decision. Preserve annotations with the artifacts.

Rollback is a coordinated revert of the overlay options, drag permission and scoped frontend chrome changes. No stored data or persisted sidebar width changes, and no migration is needed.


## Approved-scope amendment: persistent outer navigation

The user explicitly requested restoring GlobalGroupRail on Inbox during implementation. This amendment supersedes the original Inbox chrome placement and records direct user authorization.

- GlobalGroupRail stays visible across authenticated desktop routes and owns search, organization/team navigation, and the account/sync footer.
- Native macOS traffic lights and blank drag region belong at the top of this outer rail, with search beneath.
- The T3 PR sidebar stays inside Inbox alongside its detail pane. Remove the inner group chooser and duplicate account footer. Keep contributions inside the PR sidebar.
- Preserve the mobile navigation drawer, navigation button, dismissal and return-to-list behavior.
- Measure available Inbox container width, not viewport width: the outer rail consumes 240px. Preserve 208px minimum list and 640px detail space, and saved preferred sidebar width.
- At native minimum 900px, outer navigation remains visible while Inbox uses single-pane list/detail mode. Wide desktop shows all three columns.
- Recheck container resizing, navigation, selection, PR DnD and native controls. Browser receives no macOS safe area.
- Rollback reverts layout amendment and container measurement together, preserving user data/preferences.
