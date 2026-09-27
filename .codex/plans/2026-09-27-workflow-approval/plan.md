# Approve PR workflow runs

## Outcome and scope
Open a PR check's workflow run, choose Approve workflow, confirm, and see refreshed status and jobs. Approve one run at a time. Environment reviews and bulk approval are outside this change.

## Evidence
The run page supports rerun and cancel only. Core workflow actions and GitHubClient have no approval method. PR checks already link to run pages. WorkflowRun carries event, status and conclusion; no persistence change is needed.

GitHub documents POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve for fork PR workflow approval. Success is 201; documented failures include 403 and 404. Fine-grained tokens require Actions write permission; classic tokens need repo scope.
Source: https://docs.github.com/en/rest/actions/workflow-runs#approve-a-workflow-run-for-a-fork-pull-request

## Proposed behavior
1. Show Approve workflow on the run page for PR events (pull_request or pull_request_target) with conclusion action_required. This is an approval candidate, not proof of eligibility; GitHub remains authoritative. Do not show it for deployment waiting, unrelated failures, or non-PR runs. Hide rerun actions for approval candidates.
2. Reuse ConfirmButton. Identify the workflow and branch, explain that approval allows its PR code to execute, disable submission while pending, and keep existing error feedback on failure. Keep Open on GitHub available.
3. Add approveRun to packages/core/src/actions/workflows.ts and GitHubClient in packages/core/src/client.ts. Use existing REST transport and credentials. Refresh repository runs and run jobs after success.
4. Show Approval requested on success and rely on server status rather than inventing a running state. Explain approval in the empty-jobs message. Existing useRun follows jobs refresh for older runs outside the synced list; verify that path.

## User flow
PR checks → workflow run → Approve workflow → confirmation → Approval requested → refreshed status and jobs.

## Alternatives
Recommended: individual approval on the existing run page; smallest change with clear target and existing refresh ownership.
Direct PR-check approval would reduce clicks but needs run-state discovery there, including PRs with no reported checks. Defer that broader surface.
Open on GitHub is already available, but does not provide in-client approval.

## Verification
Core tests: correct POST target, empty 201 response, refresh after success, failures propagate without success refresh.
Desktop fixture tests: eligibility includes PR action_required; excludes normal completed/running, deployment waiting, and non-PR action_required; confirmation sends one request; 403 shows an error without success; refreshed state removes approval when appropriate. Include older-run fallback refresh.
Run focused core and desktop tests, workspace typecheck, and lint. Report baseline failures separately. Automated tests use mocked responses. No live workflow is approved during verification.

## Uncertainty and boundaries
No actual blocked run was supplied. The action_required signal is an implementation assumption to validate with fixtures and a real read-only run response when available. Unsupported, stale, and unauthorized candidates retain GitHub error feedback and the external link.
No authentication changes, new dependencies, migrations, or schema changes. Expected edits: core action/client, run page, focused tests and fixtures.

## Review gate
Implementation begins after approval of this plan.
