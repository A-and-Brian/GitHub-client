# Dark mode with System as default

## Outcome
Expose System, Light, and Dark choices. New users follow their OS. Explicit saved preferences remain respected and persist across reloads. System responds to OS changes while the app is open.

## Findings
The theme provider already defaults to System, persists preferences, and follows OS changes. Shared UI, diffs, and Actions logs already have dark palettes. The command palette only offers a light/dark toggle; the account menu has no appearance controls.

## Approach
Reuse the existing provider and palettes. Add an Appearance radio group in the account dropdown (System, Light, Dark), with the current preference selected. Replace the palette toggle with three explicit commands showing the selected preference.

A palette-only change is less discoverable. A separate settings screen adds unnecessary structure. Existing menu primitives give accessible mouse and keyboard controls with minimal new code.

## Implementation
1. apps/desktop/src/screens/layout.tsx: add Appearance radio items wired to useTheme.
2. apps/desktop/src/screens/command-palette.tsx: replace the toggle with Use system theme, Use light theme, and Use dark theme commands.
3. packages/ui/src/styles/globals.css: declare light/dark color-scheme so native browser controls follow the resolved theme. Preserve the provider's existing System default and stored choices.
4. apps/desktop/e2e/theme.spec.ts: use existing fake GitHub fixtures to test the user behavior.

## UI sketch
Account menu → Appearance → System (default), Light, Dark.
Command palette → Theme → Use system theme, Use light theme, Use dark theme.
Both controls identify the current preference.

## Acceptance and verification
- Fresh sessions match light and dark OS settings, including the sign-in screen.
- System responds to live OS changes.
- Explicit choices override OS changes and survive reloads.
- Both controls restore System and agree on the selected preference.
- Account menu remains keyboard accessible and reachable in mobile navigation.
- Run focused Playwright tests, workspace typecheck, and lint. Visually inspect both themes when preview is available; report native Tauri checks separately if unavailable.

## Scope
No dependency, authentication, repository settings, native window chrome, or palette redesign changes. Do not reset existing preferences. Reuse the existing provider without adding a new theme abstraction.
