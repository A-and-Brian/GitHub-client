# Starred sync removal — validation

Implemented after Plannotator returned `{"decision":"approved"}` in `review.json`. The user also explicitly confirmed keeping the existing Involving me feed, including participation outside member organizations.

## Result

- Removed automatic starred repository discovery and its recurring PR searches.
- Blocked legacy Starred background registration and direct watch/refresh; legacy Starred search queries return no queries.
- Awaited local cleanup before desktop startup, removing only the old Starred group and its PR copies. Other PR copies, repository metadata, drafts, preferences, and detail/file caches remain intact.
- Added a desktop patch changeset.

## Checks

- `bun run lint`: passed (existing Biome configuration deprecation notice).
- `bun run typecheck`: passed, all 3 tasks.
- `bun run test`: passed, 144 tests across 20 files; all 3 task-graph tasks successful. Includes durable SQLite cleanup, idempotence, preserved overlapping PRs/user data, no Starred requests, retained membership/pagination, and query splitting.
- `bun --cwd apps/desktop test:e2e`: 119 passed, 1 failed. New personal/organization/team startup-and-reload regression passed.
- The unchanged `e2e/contextual-navigation.spec.ts:281` Releases loading assertion fails because `getByText("Loading…", { exact: true })` matches both the Releases loader and Repository files loader. The same failure reproduced in an isolated rerun. No unrelated test or product code was changed; a pristine-baseline run was not performed.
- `npx react-doctor@latest --verbose --scope changed`: completed; no new issues reported, score 85/100.
- `bunx changeset status`: desktop patch detected.
- `git diff --check`: passed.
- CodeRabbit review unavailable: CLI is signed out. Local diff inspection completed.

GitHub API behavior was validated using mocks, without querying the user's live quota. Native Rust checks and remote CI were not run; no native code changed. No commit, PR, or release was created.

Logs: `/tmp/github-client-starred-unit-final.log`, `/tmp/github-client-starred-lint-final.log`, `/tmp/github-client-starred-typecheck-final.log`, `/tmp/github-client-starred-e2e.log`, `/tmp/github-client-starred-e2e-retry.log`, `/tmp/github-client-starred-react-doctor-approved.log`.
