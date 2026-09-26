# Sonner as the default error display

## Outcome

Use the existing bottom-right Sonner toaster for user-facing request and action failures throughout the desktop app. Keep loaded content and drafts visible. Keep field validation and recovery information inline when users need it after a toast disappears.

This extends the existing uncommitted PR error-toast change. No new dependency, backend change, persistence migration, or change to request retries is needed.

## Evidence and ownership

- The app already mounts one themed Toaster in app/boot.tsx, including during setup and startup failure.
- app/client.tsx exposes useJobStatus as a read-only subscription. Several consumers are per-row badges; adding notifications there would create competing toast owners.
- PR mutations, Actions mutations, inbox actions, and updater failures already call toast.error independently.
- Group PR sync, Actions list and jobs, repository settings, setup, and startup still use inline errors. Log refresh can suppress a failure when old content exists.
- Repository settings retain drafts, rebase conflicts, and block editing while save confirmation is uncertain. These behaviors and their recovery explanations must remain intact.

## Shared implementation

- Add app/errors.ts with a small showError(title, error, options?) function and useErrorToast(error, { id, title }) hook. Normalize Error messages and string failures once; render the readable operation title and details separately.
- State-driven errors use stable source IDs based on existing repository, PR, run, job, or screen identifiers. No hashing or persistent registry.
- The hook depends on the normalized message and source, so unchanged failures do not retrigger on renders or repeated background polls. Dismiss on recovery, source change, or unmount. Recovery resets notification eligibility so a later failure is visible again.
- Each view owns its error notification once. Keep useJobStatus pure; passive row badges retain their current status behavior.
- Event handlers report failures through showError. Repeated explicit user attempts may notify again. Existing success and warning toasts remain unchanged.
- Document this convention beside the helper: new user-facing async failures use Sonner by default; inline messages are reserved for validation and durable recovery context.

## Screen changes

- PR detail: replace the local effect with the shared hook; preserve the existing unavailable state and loaded content.
- Inbox and group PR list: notify once at screen level for sync failure, remove raw error banners, retain stale/offline indicators and refresh controls. Do not toast per inbox row.
- App layout: notify once for the groups sync failure currently represented only by the status dot. Keep the dot.
- Actions list and run detail: notify for list/jobs fetch failures even when cached rows exist. Keep useful unavailable states and refresh controls instead of indefinite loading or misleading empty results.
- Job logs: toast actual fetch failures, including refresh failures with old logs retained. Running-job 404 means logs are pending and stays informational. Expired or absent completed logs retain their explanation and Retry control. Prevent repeated identical polling failures from producing toast storms.
- Repository settings: toast load/save/confirmation failures. Remove generic duplicate error banners; retain specific conflict, permission, draft-retention, and uncertain-save recovery context where needed. Preserve disabled states, stale-request guards, Retry, and confirmation controls. Field validation stays inline.
- Setup and startup: toast sign-in and startup failures; retain startup recovery text and required sign-in guidance. Catch environment/CLI token retrieval failures at their existing UI handlers without changing credential handling.
- Existing PR, Actions, inbox, and updater action failures: adopt the shared helper with meaningful titles. Workflow input-fetch failures use Sonner; field validation remains inline. Background update checks keep their existing quiet policy.
- User-triggered sign-out and external-link opening: report rejected operations using the shared helper at the owning application boundary, without changing authentication or navigation semantics.

## Boundaries

This is the default presentation for handled application failures, not a guarantee that arbitrary runtime crashes become recoverable toasts. Do not install global error/unhandledrejection listeners, suppress programming errors, modify core polling, or turn expected pending states and successful fallbacks into errors. Core remains UI-independent.

## Acceptance and verification

- A failed visible fetch shows one contextual Sonner error while cached content remains usable.
- Re-renders, tab changes, and repeated identical background failures do not stack or continually reopen the same toast. A successful retry clears it; a subsequent failure can notify again. Navigation removes source-owned stale toasts.
- Failed sign-in and settings save show a toast. Settings drafts, conflict recovery, and field validation still work.
- Actions list/jobs/log failures are covered, including pending logs without error toasts and stale logs retained on refresh failure.
- Extend focused Playwright fixtures and regression coverage for these behaviors; preserve the existing PR review test and settings safety assertions. Prefer behavioral checks over helper implementation assertions.
- Run affected Playwright tests, workspace typecheck, formatting/lint for changed files, the production build, and React Doctor for changed React code. Report environmental limitations separately from failures.

## Sequence and approval

1. Approve this plan in Plannotator.
2. Implement the shared helper and integrate screens in bounded groups, preserving the existing working-tree changes.
3. Run focused regression checks, inspect the final diff for duplicate notifications and lost recovery state, and report results.

Implementation has not started for this broader change. The earlier PR-only change remains in the working tree.
