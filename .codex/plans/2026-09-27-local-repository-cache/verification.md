# Local repository cache verification

Plan approved through Plannotator: `review.json` contains `{"decision":"approved"}`. Implementation remains uncommitted in this worktree.

## Result

Team and organization repository catalogs and repository summary, loaded branches, visited directories/text files, README, and loaded PR pages use a shared SQLite-backed cache. Fresh revisits reuse local data for 60 seconds; stale data stays visible during refresh and after transient failures. Visited content survives reload offline. Unvisited offline paths have an explicit unavailable state. The new cache has a 100 MiB serialized-payload budget per account with LRU eviction and active-resource protection. It does not download entire repositories or remote images.

Exact account/host/repository/ref/path/resource identities prevent cross-scope reuse. Sign-out and permission denial invalidate relevant work before late responses or queued writes can restore it. Pagination retains loaded ranges, refreshes atomically, and retries the failed page. Saved empty lists remain resolved on failure. Status feedback does not displace rows; browser tests assert focus and geometry during successful and failed refreshes.

A cached-viewer startup limits a stalled account check to three seconds before existing offline fallback. A returned 401 still requires sign-in.

## Validation

- `bun run test`: 129 tests passed across 19 core test files; workspace command passed.
- `bun --cwd apps/desktop test:e2e`: 100 tests passed on final implementation, including 17 dashboard/repository tests.
- `bun run typecheck`: all three workspace packages passed.
- `bun run lint`: passed; existing Biome configuration deprecation is informational.
- `bun run build`: passed; final full E2E also rebuilt the desktop frontend successfully. Existing bundle-size warning remains.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `cargo test --lib`: 3 passed.
- `bunx changeset status --since=origin/main`: passed using a temporary index/object directory to include the new untracked patch changeset without staging the user's index.
- `git diff --check`: passed.
- React Doctor checked the six changed/new React files: 83/100, two control-flow-complexity warnings. Both warnings also occur in the original screens; a temporary baseline source scan verified that. New hook dependency warnings were fixed without suppression.

Focused cache/REST tests include real temporary SQLite reopen, resolved empty/null values, freshness/deduplication, failed and atomic paginated refreshes, sign-out late success/failure and immediate same-account return, queued writes and permission invalidation, primary/secondary rate limits, between-page rate-limit waits, LRU/active-resource protection, oversized payloads, and failed persistence.

Browser persistence checks wait for completed persistence before reloading with GitHub requests unavailable. They exercise actual browser OPFS persistence, not merely retained component memory. The original team revisit regression was first reproduced failing before implementation.

## Review and limits

Independent spec review: approved, no remaining blockers. Independent code-quality review: approved, no blocking findings. CodeRabbit CLI was installed but signed out; its remote review was not run.

No remote CI, commit, push, PR, release, installed-app rebuild, or installed native UI validation was performed. Native Rust regression tests and temporary SQLite persistence tests passed; these are distinct from exercising the installed application. Existing installed app data was not reset or changed. Development test servers were owned by the test runner.

Turbo emitted shared-worktree cache I/O warnings under the sandbox; commands and checks still completed successfully.
