# Inline PR workflow approval

## Outcome

Show a compact “Workflow approval required” banner immediately above the PR check list. One “Approve and run” action confirms the named workflows, then requests approval for the eligible runs. The shared ChecksContent placement covers the Checks tab, Conversation checks rail, and Files checks rail. The banner also appears when no check jobs exist. Preserve the existing rail widths and run-detail approval action.

## Evidence and boundaries

ChecksContent currently returns early when detail.checks is empty (apps/desktop/src/screens/pull/checks.tsx). Its callers already serve all three PR surfaces. The PR GraphQL query gets only head-commit check contexts; a blocked workflow can have no contexts (packages/core/src/sync/pull-detail.ts:63–80). Repository run sync retains only the latest 50 runs and omits pull_requests associations (packages/core/src/sync/actions.ts:5–50,85–99). The existing run view identifies candidates by conclusion=action_required and event=pull_request or pull_request_target (apps/desktop/src/screens/actions/run.tsx:84–124). client.approveRun already calls GitHub and refreshes runs/jobs, but does not refresh PR details (packages/core/src/client.ts:590–593). Reuse ConfirmButton, existing error/toast handling, REST pagination, and the PR refresh lifecycle. Do not introduce a new persisted run store, general approval system, or environment-deployment approvals.

## Discovery and current-PR scope

Add a focused core read method for pending PR workflow approvals, using the existing REST client and pagination. Query repository Actions runs with status=action_required separately for event=pull_request and event=pull_request_target; follow pages, rather than using the latest-50 collection. For pull_request, scope by the current head SHA and reject an explicitly different PR association; when GitHub omits pull_requests on fork runs, the exact head SHA is the fallback. For pull_request_target, do not filter or match by the run’s top-level head_sha: require an explicit pull_requests entry for this PR whose head.sha matches detail.headOid. A branch name alone never establishes eligibility. If association/head evidence is missing, omit the candidate instead of offering approval for an uncertain run. Keep these response fields local to this read method unless existing types need them; do not enlarge persisted collections merely for the banner. Deduplicate candidates by run ID. Preserve separate eligible runs even when workflow names match. Treat action_required as an approval candidate, not a guaranteed permission grant; GitHub remains authoritative.

## Implementation sequence

1. Add and test the focused discovery method and matching predicate against complete paginated responses, using repo + PR number + headOid as the request scope.
2. Load candidates once at the PR page boundary and pass shared state/actions to existing checks surfaces. Refresh with the existing PR refresh lifecycle. Clear candidates immediately on scope changes and ignore late responses from an earlier PR/head; surface discovery failure without presenting it as “no approvals.”
3. Render the shared banner before the empty-checks return. List the workflow names and count, with “Approve and run” and a confirmation explaining that approval permits workflow code to execute. Reuse ConfirmButton and existing visual primitives; wrap names/buttons inside narrow rails.
4. On confirmation, approve each distinct run once through client.approveRun, settle every selected request, and refresh both discovery and PR details even if some requests fail. Report partial success with the failed workflow names; leave remaining candidates available to retry. Keep the action busy to prevent duplicate submission. Do not optimistically claim jobs have started.
5. Add focused regressions, run affected checks, and add the desktop Changeset required for the visible application change.

## Acceptance and verification

• An eligible workflow appears above checks in all existing PR checks surfaces, including an empty check list and a run beyond the first repository page.
• Unrelated PRs, stale heads, push/workflow_dispatch events, ordinary failures, and completed approvals never produce approval actions. pull_request_target uses its PR association/head, not its base-context top-level SHA; missing target association is excluded.
• Duplicate check contexts or duplicate API entries produce one approval request per run ID. Distinct runs remain distinct.
• Confirmation identifies the selected workflows; cancellation issues no mutation. Busy state prevents duplicate requests. A 403/422 or mixed outcome remains actionable and does not erase successful approvals or imply that refresh failure means execution was denied.
• Switching PR/head while discovery is pending cannot display or approve the previous scope’s runs. Discovery errors are visible and recover through the normal refresh path.
• Core tests verify pagination, matching and deduplication. Extend the existing Actions approval fake/server coverage with PR no-job discovery, exact mutation counts, partial failure plus refresh, and stale-scope behavior. Use stable workflow/status signals instead of timing sleeps. Browser verification covers the Checks tab and compact rail at narrow and wide widths; retain existing rail geometry assertions.
• Run affected core tests, focused desktop browser tests, type/lint checks, and Changeset validation. Record local results separately from CI or release status.

## Review decision

This is a proposed implementation plan. No product code is changed by this review artifact. Approval authorizes only the inline PR workflow approval behavior described here. The parent task will open plan.html through Plannotator and record its structured decision in review.json; implementation starts only after approval. If GitHub response fixtures cannot prove current-head association for a target event, retain the existing run-detail path and exclude that uncertain banner candidate.
