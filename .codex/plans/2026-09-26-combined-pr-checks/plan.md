# Conversation with checks alongside

Status: Awaiting visual approval. Applies to full PR pages and inbox detail panes.

## Proposed experience

Shift the conversation left and show workflow checks in a sticky right column when the PR content pane is at least 1152px wide. “Actions” means the existing GitHub Actions/checks in the screenshot. Review, refresh, merge and comment controls keep their current behavior and locations.

Use 16px outer padding, a conversation column up to 768px, a 24px gap and a 320px checks column. Left-align the grid; extra space stays to the right. Below 1152px, retain the centered conversation. Measure the PR pane, not the window: the inbox list consumes another 320/384px.

Keep Conversation, Files and Checks tabs at every width, with existing links and shortcuts 1, 2 and 3. The combined layout appears only on Conversation.

## Layout mockups

Wide PR pane, schematic:

```text
PR heading                                        Review
Conversation    Files (43)    Checks (6)
--------------------------------------------------------
[ Conversation / description ]   [ Checks (6)           ]
[ Timeline                   ]   [ Changeset · skipped  ]
[                            ]   [ Frontend · success   ]
[ Merge and comment controls ]   [ Test · running       ]
  up to 768px                      320px, sticky
```

Narrow PR pane, including a narrow inbox detail pane in a wide window:

```text
PR heading                         Review
Conversation    Files    Checks
-----------------------------------------
    [ Centered conversation ]
    [ Timeline              ]
    [ Merge / comment       ]
Checks remain available in their tab.
```

## Alternatives

- Recommended: sticky checks alongside Conversation, retaining Checks navigation. Uses available space and preserves navigation.
- Remove Checks tab at wide sizes: fewer tabs, but introduces responsive routing and shortcut behavior.
- Checks below conversation: simpler scrolling, but long descriptions still separate checks from discussion.

## Implementation

- `apps/desktop/src/screens/pull/checks.tsx`: extract the existing grouped check list from its scrolling tab wrapper. Reuse it in the sidebar. Preserve workflow/status grouping, status text/icons, internal run/job links, external links and the empty message. Wrap long workflow headings and keep statuses and links visible; retain accessible full check names.
- `apps/desktop/src/screens/pull/conversation.tsx`: make the existing conversation shell support the two columns. Keep one stable conversation instance and one conversation scroll parent. CSS hides the sidebar below the breakpoint; resizing must not remount merge/comment forms. Sticky sidebar starts 16px from the scroll area's top, with its own overflow only when checks exceed available height.
- `apps/desktop/src/screens/pull/pull-page.tsx`: establish the named query container on the bounded, min-height-zero flex body below the header. Use pane width for layout and content-area height for the sidebar height cap, accounting for inbox actions and wrapped headers. If using container height units, put size containment on this already flex-sized body. Prefer Tailwind utilities; touch `apps/desktop/src/styles.css` only for necessary scoped rules.
- `apps/desktop/e2e/pull-layout.spec.ts`: add layout behavior coverage with the existing fake GitHub harness. Extend `apps/desktop/e2e/fake-github.ts` only for necessary fixtures. No backend, schema, dependency, preference or new fetch changes.

## Evidence and risks

- PullContent is shared by standalone PR and inbox; the inbox has its own list and actions row. A viewport breakpoint or viewport-based height cap would be incorrect there.
- Both current tabs own h-full overflow-y-auto wrappers and centered max-w-3xl content. Nesting those wrappers directly would create competing scroll areas. Reuse the list rather than embed the whole ChecksTab.
- Checks already come from the same PullRequestDetail. Keep one source of data and one grouped list implementation.
- Preserve form state when resizing through CSS layout changes. Tab changes retain current behavior; this does not add cross-tab draft persistence.

## Acceptance and verification

- Test standalone PR and inbox at actual pane widths just below and at 1152px. Check simultaneous conversation/checks only at the threshold, narrow centering, and no horizontal overflow.
- Enter a comment draft, resize through the breakpoint both ways, and confirm one composer and unchanged draft. Merge controls remain accessible.
- Scroll a long conversation and verify the checks stay near the content top. With many checks and a short window, reach the final entry without trapping conversation scrolling.
- Cover empty checks, long names, success, skipped, running and failing statuses. Check keyboard access and ensure the hidden narrow sidebar adds no focusable links.
- Exercise Checks tab, 1/2/3 shortcuts, direct Checks links, internal run/job links and external check links. Files has no sidebar. Use fake data; do not submit real comments, reviews or merges.
- Run `bun run lint`, `bun run typecheck`, `bun run test`, and `bun --cwd apps/desktop run test:e2e e2e/pull-layout.spec.ts e2e/review.spec.ts e2e/merge.spec.ts`. Inspect wide/narrow views in light and dark mode. Report baseline failures or unavailable browser verification separately.

## Approval and stop condition

Approve the combined layout, 1152px pane breakpoint and retained Checks tab through Plannotator before implementation. Completion is this scoped layout plus the behavior checks above. No commit, publishing or unrelated UI work is included.
