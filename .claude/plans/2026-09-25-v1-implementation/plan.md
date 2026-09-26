# GitHub-client v1 — Implementation Plan

Date: 2026-09-25
Status: Draft for review (revision 2)
Parent plan: `.claude/plans/2026-09-25-github-client/plan.md` (approved)

Revision 2 changes, from review feedback:

- Client data layer is now TanStack DB with its SQLite persistence adapters (section 3.1). Drizzle is evaluated and deferred to the phase 2 server.
- Monorepo uses Turborepo (section 4).
- Tauri system libraries are installed; the desktop binary is built and verified on this host.

## 1. Scope

Build v1 as defined in the parent plan: token auth, auto repo groups, PR list, PR detail, diff review with write actions, Actions (status, runs, logs, rerun, cancel, dispatch), local SQLite cache with ETag polling, command palette. Desktop first (Tauri 2).

## 2. Environment findings

- Available: Bun 1.4, Node 26, Rust 1.98 (`~/.cargo/bin`), Git Town 24, `gh` (logged in).
- Tauri Linux system libraries: installed (`webkit2gtk-4.1` 2.52.6, `gtk+-3.0` 3.24.52, `libsoup-3.0` 3.6.6).
- Verified: `api.github.com` allows CORS from any origin, accepts `If-None-Match`, and exposes `ETag`, `Link`, `X-Poll-Interval`, and rate-limit headers. The UI can also run in a plain browser during development.

## 3. Design decisions made in this plan

### 3.1 Client data: TanStack DB with SQLite persistence

The UI reads data from **TanStack DB** collections. TanStack DB (`@tanstack/db` 0.9, `@tanstack/react-db`) is a reactive in-memory store. Live queries (joins, filters, ordering) update incrementally, and mutations apply optimistically and roll back on failure.

Persistence uses the official TanStack SQLite adapters (version 0.2.x). They store collection rows in SQLite and hydrate collections at startup:

- Desktop: `@tanstack/tauri-db-sqlite-persistence` on the official `tauri-plugin-sql`. No custom Rust code.
- Browser development and the later hosted web app: `@tanstack/browser-db-sqlite-persistence` on `wa-sqlite`.
- Tests: `@tanstack/node-db-sqlite-persistence`.
- Future mobile: `@tanstack/expo-db-sqlite-persistence`.

Data flow:

1. At startup, collections hydrate from SQLite. The UI renders the last known state immediately.
2. Sync jobs in `packages/core` poll GitHub with ETags and write changes into the collections. TanStack DB persists them to SQLite.
3. Write actions (comment, review, merge, rerun) run as TanStack DB mutations or actions. Their handlers call the GitHub API; the UI updates optimistically.
4. ETags and sync cursors live in a small local-only persisted collection, keyed by request URL.

v1 collections: `repos`, `groups`, `pullRequests`, `prDetails`, `prFiles`, `reviewThreads`, `checkRuns`, `workflows`, `workflowRuns`, `jobs`, `requestCache`.

**Drizzle: not in v1.** The TanStack DB persistence adapters own their SQLite tables and store rows without a separate schema. Drizzle on the client would add a second schema and query layer over the same data, with no gain. Drizzle fits the phase 2 server, where a relational Postgres schema holds webhook data and custom features.

**Phase 2 seam.** Screens import collections from `packages/core` and never touch SQL. In phase 2 the custom GitHub sync behind each collection is replaced by a server-backed sync. TanStack DB already ships Electric and PowerSync collection types, so those two engines become the natural fit. Zero is a weaker fit.

**Risk.** TanStack DB is pre-1.0 and the persistence packages are at 0.2. Mitigation: all collection definitions live in `packages/core/src/collections`, so a breaking upgrade touches one folder. Milestone 2 starts with a spike that proves persisted collections with custom sync under Tauri and in the browser. Fallback if the spike fails: TanStack DB without persistence, plus a plain SQLite snapshot written by the sync jobs.

### 3.2 Platform services are injected

`packages/core` receives a `Platform` object: `fetch`, `persistence`, `secrets` (get, set, delete token), and optional `ghAuthToken()`.

- Desktop: Tauri HTTP plugin `fetch` (no CORS limits, needed for Actions log redirects), Tauri SQL plugin persistence, OS keychain via the `keyring` crate, `gh auth token` via a Rust command.
- Browser development: `window.fetch`, `wa-sqlite` persistence, token held in `sessionStorage` only (development convenience, clearly labelled), no `gh` import.

### 3.3 Rust side stays small

`apps/desktop/src-tauri` registers the `sql` and `http` plugins and adds two small commands: keychain get, set, and delete, and `gh auth token`. No separate Rust crate is needed.

### 3.4 API usage per feature

| Feature | API | Freshness |
| --- | --- | --- |
| Viewer, orgs, teams, starred repos | REST, ETag | background |
| PR list per group | REST search (`is:pr is:open org:… review-requested:@me …`), ETag | active 15 s, background 2 min |
| PR detail (body HTML, timeline, reviews, threads, checks) | GraphQL, one request | on open, then active polling |
| PR files and patches | REST `pulls/{n}/files`, paginated, ETag | on open |
| Review writes | REST reviews and comments endpoints | on action |
| Merge | REST `pulls/{n}/merge` | on action |
| Workflow runs, jobs, steps | REST, ETag | active 15 s |
| Job logs | REST `jobs/{id}/logs` (redirect to blob storage) | poll while running |
| Rerun, rerun failed, cancel, dispatch | REST | on action |

Rendered Markdown comes from GraphQL `bodyHTML`, so no Markdown renderer is needed for GitHub content.

Search API note: search has a lower rate limit (30 per minute). Polling respects it with a shared request budget in the scheduler.

### 3.5 Known API limitation for live logs

The public API does not stream logs of a step that is still running. v1 shows live job and step status (polled) and fetches the job log when available, refreshing while the job runs. True line-by-line streaming like the website is not possible through the public API.

## 4. Repository layout

A Turborepo monorepo on Bun workspaces. `turbo` runs `build`, `typecheck`, `lint`, and `test` across packages with caching and dependency ordering.

```
package.json              Bun workspaces, root scripts calling turbo
turbo.json                task pipeline
biome.json                lint and format
apps/
  desktop/
    src/                  React app: routes, screens, platform adapters (Tauri, browser)
    src-tauri/            Tauri 2 app: sql and http plugins, keychain and gh commands
packages/
  core/
    src/github/           REST client (ETag, pagination, rate limit), GraphQL client
    src/auth/             AuthProvider, TokenAuthProvider
    src/collections/      TanStack DB collection definitions and persistence wiring
    src/sync/             poll scheduler, per-feature sync jobs
    src/actions/          write actions (reviews, merge, rerun, cancel, dispatch)
    src/domain/           types: Repo, Group, PullRequest, Review, CheckRun, WorkflowRun, Job
    src/diff/             unified diff parser, line mapping for comments
    src/logs/             ANSI parser, log search
  ui/                     shadcn on Base UI, ReUI, shared components
  tsconfig/               shared TypeScript configs
```

## 5. Milestones

Each milestone ends with passing tests and a commit.

1. **Workspace skeleton.** Turborepo on Bun workspaces, TypeScript, Biome, Vitest, Tailwind v4, shadcn on Base UI plus ReUI in `packages/ui`, Vite app in `apps/desktop`. GitHub Actions CI for lint, type check, and tests.
2. **Core foundation.** Spike first: a persisted collection with custom sync, running in Tauri and in the browser. Then `Platform`, REST client with ETags stored in `requestCache`, pagination, rate-limit tracking, GraphQL client, `TokenAuthProvider`, and the poll scheduler (active and background intervals, `X-Poll-Interval`, search budget).
3. **Native side.** `src-tauri` with SQL and HTTP plugins, keychain and `gh` commands, capabilities; desktop platform adapter in TypeScript; `bun run desktop:dev` launches the app.
4. **Auth and shell UI.** Token setup screen (paste token, import from `gh`, `GITHUB_TOKEN`), scope check via `X-OAuth-Scopes`, app layout, router, command palette, global shortcuts.
5. **Repo groups and PR list.** Org, team, and starred groups; PR list with mine, review requested, all open; filters; keyboard navigation; instant render from persisted collections, refresh behind.
6. **PR detail.** GraphQL load; description, conversation, reviews, checks summary.
7. **Diff review.** Diff parser, virtualized file and line list, Shiki highlighting in a web worker, existing review threads inline, pending review with line comments and suggestions, submit (approve, request changes, comment), merge with method choice.
8. **Actions.** Check runs on PRs and groups, workflow run list per repo, job and step tree, logs viewer (virtualized, ANSI colors, search), rerun, rerun failed, cancel, `workflow_dispatch` with inputs read from the workflow YAML.
9. **Finish.** README with setup and development instructions, Tauri bundle configuration, final pass on tests.

## 6. Verification

- `packages/core`: Vitest against recorded GitHub API fixtures (sanitized JSON), with collections persisted through the Node SQLite adapter. Covers ETag handling, pagination, sync into collections, hydration after restart, diff parsing and comment line mapping, ANSI parsing.
- Rust: `cargo check` and `cargo clippy`. The Rust code is too thin to need its own tests.
- UI: run the Vite app in a browser preview and the Tauri app on this host, with your `gh` token, read-only, to check each screen against real data.
- Write actions (comment, review, merge, rerun, cancel, dispatch): tested against fixtures only. No writes to real repositories unless you name a scratch repository for it.

## 7. Working method

- Main session builds milestones 1 to 4 (foundation, shared conventions).
- Milestones 7 and 8 are large and mostly independent; they may be delegated to Opus subagents one at a time on this branch, with the main session reviewing each result.
- Commits per milestone on the current branch. No push or PR unless you ask.

## 8. Out of scope for v1

Notifications, issues, user-defined groups, saved queries, code browsing, local repositories, Git Town, agents, server, mobile, GitHub App auth.
