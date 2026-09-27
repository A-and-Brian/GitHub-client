# Preserve SQLite transaction affinity

27 September 2026 · Implementation review

## Evidence and outcome

Keep each transaction on one native SQLite connection. TanStack 0.2.23 already queues transactions, but sends BEGIN IMMEDIATE, statements, and COMMIT separately. SQL plugin 2.4.1 acquires an arbitrary connection per call from its default pool (up to ten). A queue cannot provide connection affinity.

A temporary Python SQLite experiment reproduced a lock when BEGIN and INSERT used different connections; one connection succeeded. This illustrates the mechanism, not a native app or original host reproduction. Current core tests use one better-sqlite3 connection and miss pooling.

## Proposed implementation

Register an app-owned Rust sqlx pool in the plugin’s public DbInstances state as DbPool::Sqlite. Open the existing github-client.sqlite under app_config_dir with max_connections(1); disable idle timeout and maximum lifetime recycling. Preserve the database path, schema, SQL bridge, TanStack queue, and existing dependency patch.

Make initialization idempotent. Await it before persistence creation, then use Database.get with the same sqlite:github-client.sqlite key so Database.load cannot replace the pool. Add direct sqlx aligned with locked 0.8.6 and minimal required features. Verify public API compatibility and startup ordering before integrating.

## Sequence and acceptance

1. Prove separate native pooled BEGIN/write/read/COMMIT calls persist data. Prove rollback removes failed writes and the next transaction succeeds without a leaked lock.
2. Implement initialization and frontend handle acquisition. Verify repeated initialization preserves the pool and committed data survives close/reopen.
3. Exercise concurrent collections through the actual TanStack adapter and configured native boundary. Assert both collections persist without transaction interleaving. JavaScript mocks alone do not satisfy this check.
4. Run focused persistence/desktop tests, typechecking, cargo check and focused cargo test. Record baseline failures or unavailable native integration explicitly. Retest the reported host behavior when that runtime is available.

## Assumptions and limits

boot.tsx caches clientPromise outside React; tauri.ts is the only production SQL consumer found. All SQL must continue through that one adapter queue. A future bypass could interleave transactions despite one connection. Connection loss and independent application processes remain separate concerns.

Queue changes, retries, or longer busy_timeout do not fix affinity; sqlx already defaults to five seconds. If native proof or public plugin integration fails, revise this plan before considering a broader transaction bridge. No database reset, migration, unrelated UI change, or cache deletion is proposed.

## Sources

apps/desktop/src/platform/tauri.ts — database and adapter creation.
apps/desktop/src/app/boot.tsx:16–20 — shared client promise.
apps/desktop/src-tauri/src/lib.rs and Cargo.toml — startup and dependencies.
packages/core/src/collections/tauri-persistence.test.ts — existing test boundary.
Installed @tanstack/tauri-db-sqlite-persistence@0.2.23/src/tauri-sql-driver.ts — queue and SQL calls.
Installed tauri-plugin-sql-2.4.1/src/wrapper.rs — pool acquisition.

## Review decision

Pending approval. No implementation or host fix is claimed. Begin implementation only after Plannotator approval; record the structured decision in review.json alongside this plan.
