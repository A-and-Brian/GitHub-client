# Inline merge confirmation

## Decision
Replace the merge action's browser-native confirmation with an inline confirmation using the existing shadcn Button. Yi selected changing the button in place rather than opening a dialog. Keep the action's position and dimensions stable across idle, confirming, and submitting states. No native dialog plugin or new component abstraction is needed.

## Evidence and audit
- `apps/desktop/src/screens/pull/conversation.tsx:171` calls `window.confirm` before entering its try/catch or setting busy. A suppressed dialog can therefore exit without feedback. This mechanism matches the report; it has not been reproduced inside the installed desktop app.
- Searches across apps and packages found this as the only browser confirm/alert/prompt call.
- Workflow re-run all, re-run failed, re-run job, and cancel run use the existing shadcn-based `screens/actions/confirm-button.tsx` dialog. PR review and workflow dispatch also use application dialogs. They do not have the same native-dialog dependency and remain unchanged.

## Behavior
1. Initial click changes the same button to “Confirm merge” and shows the repository, PR number, selected method, and target branch in the existing merge panel. It sends no request.
2. Reserve the primary button's dimensions for all labels. Keep the controls row stable; put context below the row. Put Cancel to the left, using the method-selector space during confirmation so the primary button does not shift. Support repositories with just one merge method and narrow layouts.
3. Cancel or Escape restores the initial state without a request and retains keyboard focus on the primary button. The selected method cannot change while confirming or submitting.
4. Confirm changes the label to “Merging…” and prevents duplicate requests. Guard blocked state in the handler as well as disabling the button. Preserve the existing merge method, head-SHA request protection, refresh, and success/error toasts.
5. Failure leaves an explicit retry available via the confirmation state. Success clears confirmation; refreshed PR state removes merge controls. Changing PR identity or head revision invalidates any pending confirmation so it cannot apply to a different PR or new commits.
6. Keep confirmation context accessible through an announced status and an associated description. Do not treat inline content as a modal dialog.

## Scope and validation
Edit `apps/desktop/src/screens/pull/conversation.tsx` and focused E2E coverage, extending `apps/desktop/e2e/fake-github.ts` only if required for merge responses. Add the repository's normal patch changeset if required by its contribution conventions.

Behavior tests must prove initial click/cancel make no merge request; confirmation sends exactly one request with selected method and head SHA; pending state disables repeat submissions; API failure is visible and retryable; success refreshes the PR. Check Escape, focus, disabled draft/conflict states, and unchanged primary-button bounding box at desktop and narrow widths. Exercise with browser confirmation stubbed to fail so native dialogs cannot silently reappear. Run relevant E2E tests, typecheck, and formatting/lint for changed files. Report native desktop verification separately from browser evidence. No live PR merge is part of verification.

## Approval
Implementation begins after Plannotator records approval of this plan.
