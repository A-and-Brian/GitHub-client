# PR inbox and organization navigation

Date: 2026-09-26 · Approved in chat on 2026-09-26 · No implementation before review approval.

## Purpose

Improve organization/team navigation, make repository context unmistakable, add a T3-like PR thread inbox with snooze, settle and failure visibility, and edit a bounded set of actual GitHub repository settings in the app. PR-only means content type, not author-only PRs. Preserve broad group browsing.

## Provisional v1 coverage

Linear was checked live on 2026-09-26: [GitHub-client, P-SID-100, Side Projects](https://linear.app/abrian/project/github-client-b4abc69a1ab2). The project describes v1 as built and tracks follow-ups. Its recorded backlog still contains 13 issue rows covering 11 distinct concerns; this does not prove the app is unusable or releases never shipped. Completeness remains provisional; statuses may lag working software. No Linear issues were changed.

| Milestone | Recorded outstanding work |
| --- | --- |
| v1 release | SID-68 desktop verification; SID-69 release installers; SID-70 macOS signing; SID-71 Windows signing; SID-72 product name. |
| v1 polish | SID-73/SID-75 paginated-refresh disappearance (apparent duplicate concern); SID-74/SID-77 split diff and horizontal scrolling (apparent duplicate concern); SID-76 outdated draft visibility; SID-78 smaller diff gaps; SID-79 log markers/group/download; SID-80 shortcut help overlay. |

The approved original scope is `.claude/plans/2026-09-25-github-client/plan.md`; implementation commitments are in `.claude/plans/2026-09-25-v1-implementation/plan.md`. All eight original v1 areas have broad source evidence, but source presence is not runtime completion. Dependencies are absent; tests were inspected, not run in this audit.

| Original v1 area | Source evidence and limits |
| --- | --- |
| Authentication | Setup/core/keychain adapters and restore/sign-out tests exist; native behavior unverified. |
| Automatic groups | Organization/team/starred sync exists; orgs and teams stop at first 100, starred at 1,000; hierarchy absent. |
| PR list and filters | Implemented; query cap 4 × 50 PRs, labels/review requests first 10. |
| PR detail | Implemented; timeline last 100, threads first 100, comments first 50, checks first 100; no cursors. |
| Diff review and mutations | Virtualized worker-highlighted diff, drafts, inline reviews and suggestions exist; parser/row tests and review E2E exist. Merge/live mutations unverified. API truncation was accepted in the original plan. |
| Actions and logs | Per-repo latest 50 runs, jobs/steps/logs/rerun/cancel/dispatch exist; partial unit coverage, no Actions E2E; group-wide runs absent. |
| Persistent cache/polling | Persistent collections/restart tests exist; ETags are memory-only versus planned persisted request cache. Restart does a full poll; this alone is not proof of a bug. |
| Palette and shortcuts | Code and smoke E2E exist; shortcut help remains a Linear polish item. |

SID-68 includes native launch, keychain restart, launcher-based gh import, environment token, system-browser links, redirected logs, cache restart and sign-out without automatic reauthentication; working-app feedback alone does not prove that full checklist. SID-76 still needs commit-aware outdated-draft classification; SID-79 still has action log marker gaps. SID-78 suggests hashing, which is not authorized and is outside this proposal. Historical CI claims in project descriptions are not current CI evidence.

Treat limits against actual acceptance criteria. Do not turn this navigation project into an automatic fix for every v1 gap. Reconcile duplicate issues and source/runtime evidence as a separate read-only inventory before implementation scope is finalized.

## Organizations and nested teams

`domain/types.ts` has organization identity but no parent; `sync/groups.ts` flattens team names; `layout.tsx` shows a flat list. Add explicit parent identity, preserve GitHub metadata, paginate org/team discovery, and render expandable organizations with nested child teams. Keep starred accessible. GitHub documents parent metadata in the [Teams REST API](https://docs.github.com/en/rest/teams/teams).

A visible ancestor can provide context without implying membership or repository access. Never infer parentage from names. Missing/inaccessible parents become safe roots within their organization; guard cycles. Preserve keyboard focus, selection, loading and permission states.

## Clear repositories

`group-pulls.tsx` already shows repository/number and a state icon. Strengthen this with repository section headings and persistent owner/repository #number in PR detail. Same short repository names under different owners must stay distinguishable. Keep existing filters and broad group views.

## PR thread inbox

Use a deduplicated union of already-synced PRs. Default to involving-me PRs, including authored and review-requested work; include team requests where membership is known. Offer All synced PRs. Do not claim complete GitHub coverage when permissions or pagination limit the cache.

Use a compact PR list beside its detail pane. Show repository, title, checks/review status, local state and freshness. Failure uses a label/icon as well as color; stale, loading and offline checks must not look successful.

| State | Behavior |
| --- | --- |
| Active | Default actionable PR. Opening it has no GitHub mutation. |
| Snoozed | Presets/custom return time; persist an absolute expiry and display local time. Return to Active at expiry, including after restart. |
| Settled | Handled locally, with Undo/Restore. Never merge, close or resolve a GitHub review thread. |

Proposed reactivation for Settled: a new head commit, new user/team review request or newly observed failure returns it to Active once. Use concrete event/head identifiers and observed state, no hashing. Repeated polls, arbitrary updated timestamps, unchanged failures and the user's own actions must not repeatedly reactivate it. Validate event identity and own-action suppression against actual API payloads before implementing this rule.

Snooze retains deferral until expiry/manual restore. A labeled Failures across all states view includes Snoozed and Settled PRs without changing their state. Viewing a failure never cancels a user's deferral.

Local preferences are separate from GitHub cache. Existing PR rows use groupId plus PR ID; local state must instead use signed-in account identity plus stable PR node ID to avoid duplicates across groups. Persist via existing SQLite/OPFS seams across sync and restart; isolate accounts. Missing preferences mean Active. Use small typed collections and existing UI/core seams, no workflow engine or server.

This brings local snooze forward from Phase 2 and adds a PR inbox before v2 notifications (SID-81). It does not implement GitHub notifications, issues or custom groups (SID-83).

## Actual GitHub repository settings

The user confirmed editing GitHub settings inside the app. Initial scope: description/homepage; issues/wiki where supported; merge methods (squash/rebase/merge); delete branch on merge. Read authoritative settings and repository admin capability, edit a draft, provide explicit Save/Cancel, and send only changed supported fields. A successful save requires server confirmation and authoritative refetch.

Show read-only/disabled controls without admin capability. Handle organization restrictions, 403/422 responses, offline and stale data without claiming success or discarding the draft unexpectedly. GitHub's [repository update API](https://docs.github.com/en/rest/repos/repos#update-a-repository) documents fields and fine-grained Administration write permission. Account/token capability and server responses remain authoritative.

Discussions are excluded because the checked update endpoint does not list that field. No full settings parity: rulesets, branch protections, secrets, collaborators, rename, transfer, archive and delete are deferred. No generalized settings framework or unrelated refactor.

## Mobbin research applied

| Viewed source | Pattern applied |
| --- | --- |
| [Front](https://mobbin.com/screens/4f8adeba-e3e0-436a-9891-0e0abaff91ed) | Open/Later/Done and thread detail → Active/Snoozed/Settled with explicit local semantics. |
| [Proton](https://mobbin.com/screens/f26ff84f-4dbe-425e-ae4c-d197ac4dee17) | Snooze presets and custom time → small chooser with clear return time. |
| [Todoist](https://mobbin.com/screens/4c39b647-967e-49a8-8907-74ab0bf6a75f) | Workspace and nested projects → organization/team hierarchy. |
| [Frame](https://mobbin.com/screens/589f55e4-ac58-407a-8f95-326e35c33e09) | Expandable navigation and breadcrumb → persistent context. |

References inform interactions; no Mobbin previews are embedded. The HTML illustration is synthetic, not a live product screenshot.

## Delivery order after approval

1. Reconcile original v1 commitments and Linear rows with source/tests/runtime evidence; report limits and duplicate concerns without changing issues or silently expanding scope.
2. Implement parent metadata/pagination, organization/team navigation, repository headings and persistent detail context.
3. Implement stable account-scoped inbox preferences, deduplicated queries, snooze/settle/undo/expiry and approved reactivation behavior.
4. Implement the bounded GitHub repository settings editor with capability checks and authoritative saves.

Yi approves scope and the reactivation policy. The implementing agent owns focused code changes and validation. Broad v1 release/signing/polish work remains separately scoped.

## Acceptance checks

- Paginated parent/child teams, inaccessible parents and cycles remain navigable without expanding access.
- Repository name collisions remain clear; one PR in several groups is one inbox entry.
- Snooze/settle survive sync/restart and remain isolated across accounts; defaults are safe.
- Clock-controlled tests prove expiry while open/after restart; qualifying activity reactivates once, unchanged failures and own actions do not repeat.
- Cross-state failure view preserves local state; stale/offline status is explicit.
- Settings save only supported changed fields; no-admin, 403, 422 and offline paths preserve truthful UI; server-confirmed values are refetched.
- Keyboard focus, disclosures, list/detail navigation and actions work at wide/narrow widths.
- Run meaningful existing core tests and focused UI smoke checks after dependencies are installed; distinguish local proof from live GitHub/Linear evidence.

## Approval gate

Review this canonical Markdown and its self-contained HTML together. Run `plannotator annotate plan.html --gate --json --require-approval --result-file review.json`, retain the structured decision, and implement only after approval. Current T3 preview tools are unavailable; static validation is separate from visual review. The reactivation policy and repository settings scope were approved in chat on 2026-09-26; review.json records that decision.
