# Restore Actions jobs after idle collection cleanup

## Outcome
Opening an Actions run after the client has been idle displays the jobs returned by GitHub. Refresh continues updating jobs after leaving and reopening the screen.

## Evidence
- GitHub's jobs endpoint for Yis-company/GitHub-client run 36266350823 (CI #27, commit e4263ac) returns three jobs: changeset (success), web (failure), rust (success).
- The desktop SQLite jobs collection contains zero rows and has row version zero. Inspected read-only; existing data is preserved.
- `packages/core/src/collections/synced.ts` resolves `writerReady` once. Restarting collection sync calls the resolver again, which cannot replace the original writer.
- TanStack DB cleans collections with no subscribers after five minutes. Its persisted writer explicitly ignores begin/write/commit calls once its sync session has been cleaned up.
- This mechanism permits a successful fetch and successful-looking write with no job rows. A focused regression now reproduces this: preload an empty persisted collection, clean it up, then replace jobs. The write resolves, but reading the inserted job returns undefined (1 test failed, 1 passed). The screenshot alone cannot prove which lifecycle events occurred in the running process.

## Implementation
1. In `packages/core/src/collections/synced.ts`, retain the writer for the current sync session, update it on each sync start, and clear it on cleanup. Await collection preload before taking the current writer so a stopped collection restarts before writes. Keep the existing serialized transaction queue and await commit. Fail explicitly if preload completes without an active writer.
2. Add behavioral regression tests in `packages/core/src/collections/synced.test.ts`: initialize and clean up the same persisted collection, then write again and assert both live rows and persisted rows. Cover a previously empty jobs-shaped collection using realistic GitHub IDs and a populated collection's replacement/deletion behavior across restart. Include the non-persisted path where useful.
3. Add a patch changeset for `@github-client/core` describing restored sync after idle cleanup.

## Boundaries and risks
The shared collection wrapper owns this defect, so its fix applies to all synced collections. Preserve collection schemas, keys, polling intervals, API calls, transaction ordering, and existing user data. No cache reset, dependency upgrade, UI redesign, rerun of GitHub jobs, release, or publication is needed.

## Verification
- Establish that cleanup/restart regression fails on the current code and passes with the fix.
- Run the core test suite, workspace typecheck, and lint; distinguish pre-existing failures from regressions.
- Check existing Actions E2E scenarios if the local browser test environment is available.
- Report native desktop validation separately; automated SQLite tests cannot certify the running installed application.

## Approval
Approve this bounded shared-collection repair before implementation. Review notes become implementation constraints.
