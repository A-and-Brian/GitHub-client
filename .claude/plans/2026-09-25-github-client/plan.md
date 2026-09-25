# GitHub-client — Product and Architecture Plan

Date: 2026-09-25
Status: Draft for review
Source: grilling session (Q1–Q37)

## 1. Goal

A fast, keyboard-first desktop client that replaces day-to-day use of the GitHub website. Later it also replaces the browsing and git parts of WebStorm, and manages local repositories, Git Town stacks, worktrees, and agent sessions (T3 Code, Codex).

Pain points it must fix:

- Page load and navigation latency.
- Large diffs that are slow or collapsed ("Load diff").
- Too many clicks, weak keyboard flow.

Users: the author only for now. Open source later, possibly hosted, possibly mobile.

## 2. Non-goals

- A full IDE (LSP refactors, debugger, run configurations, terminal).
- A full git client (interactive rebase UI, stash manager). Existing tools cover this.
- Embedding agent sessions inside the app. The app launches external agents.
- Multi-tenant hosting in v1.
- GitHub Enterprise Server in v1 (API base URL stays configurable).

## 3. Phases

### v1 — GitHub slice, desktop (Linux and macOS)

1. Auth: classic personal access token, `GITHUB_TOKEN`, or import from `gh auth token`. Stored in the OS keychain.
2. Auto repo groups: organization, team (from team membership), starred.
3. PR list per group: mine, review requested, all open. Filters and keyboard navigation.
4. PR detail: description, conversation, reviews, checks.
5. Diff review from the GitHub API: virtualized rows, syntax highlighting in a web worker, inline comments, suggestions, approve, request changes, comment, merge.
6. Actions: check and run status on PRs and per group; workflow run list per repo with job and step tree; live and completed logs (streamed, searchable, ANSI colors); rerun, rerun failed jobs, cancel, `workflow_dispatch` with inputs.
7. Local SQLite cache with ETag polling.
8. Command palette and global shortcuts.

Out of v1: notifications, issues, user-defined repo groups, saved queries, code browsing, all local repo features.

### v2 — Local repositories and v1 leftovers

- Link local clones to GitHub repositories (pick a folder, verify the remote). Diffs come from local `git diff base...head` when a linked clone exists; API diff stays the fallback.
- Branch tree: ahead/behind vs upstream with pull/push highlights, Git Town stack lineage with "needs sync", linked PR status, worktree membership.
- Git Town: setup and configuration UI per repository; actions hack, append, prepend, sync, propose, ship, switch, continue, undo.
- GitHub stacks mirror: after `propose`, link the stack on GitHub through a small adapter over the REST stacks API (public preview, subject to change).
- Commit graph: one lane renderer written in-house. "Stack" mode (current branch plus Git Town lineage, default in the branch screen) and "all" mode (every local and remote branch, history screen). Filters by author, path, and text follow.
- Conflicts, in order of delivery: Git Town pause awareness ("sync paused, N conflicts", continue or undo), "hand to agent" (open the worktree in T3 Code with a prompt listing conflicting files and Git Town state), then a 3-way merge editor (CodeMirror 6 merge).
- Worktrees and agents: create or reuse a worktree for a branch or PR, then launch an agent. T3 Code via `t3 app <path>` is fully supported. Codex via `codex://` deep links is best effort, because opening a specific path is not documented.
- Notifications inbox, issues, user-defined repo groups, saved queries.

### Phase 2 — Server

- GitHub App with webhooks into Postgres.
- Sync engine to clients (Zero or PowerSync, decided at the start of phase 2).
- User's own features on top of GitHub data (private notes, review ordering, snooze, analytics, AI summaries). Added over time; the schema must leave room for them.
- Hosted web app, multi-tenant, with per-user repository visibility enforced on the server.

### Future

- Mobile app with Expo / React Native and native components, sharing only `packages/core`.
- Code browsing (file tree, highlighting, go to definition, search), then light editing and commit.

## 4. Architecture

### Repository layout (Bun workspace)

```
apps/
  desktop/     Tauri 2 shell (Rust) + React UI entry
  web/         later: hosted web app
  mobile/      later: Expo app
packages/
  core/        GitHub client, sync, domain model, query interface, AuthProvider
  ui/          React components (shadcn on Base UI, ReUI)
```

`packages/core` has no DOM and no native API imports. This keeps it usable from React Native later.

### Frontend

React, TypeScript, Vite, TanStack Router, Tailwind, shadcn on Base UI primitives, ReUI components, cmdk command palette.

### Rust side (Tauri)

- Git: shell out to the `git` CLI with `--porcelain` and `--format` output. This respects hooks, config, worktrees, credential helpers, and Git Town config. Add a git library only if profiling shows reads are slow.
- Git Town: shell out to `git-town` with `--non-interactive`. Read lineage directly from git config keys `git-town-branch.<name>.parent`, because Git Town has no JSON output.
- GitHub stacks: `gh stack` is optional; the adapter calls REST directly.
- Storage: SQLite via `rusqlite`.
- Secrets: OS keychain.

### GitHub API

- REST for polled lists (PRs, check runs, workflow runs, notifications later). Conditional requests with ETags; `304` responses do not count against the rate limit.
- GraphQL for one-shot detail loads (PR with reviews and threads).
- Polling: active view about every 15 s, background views about every 2 min; respect `X-Poll-Interval`.
- Both behind one client in `packages/core`.

### Data seam for phase 2

The UI reads only through a typed query interface in `packages/core`. Phase 1 implements it on SQLite. Phase 2 replaces the implementation with the chosen sync engine. Code above the seam survives; code below it is expected to change.

Engine notes for phase 2:

- Zero: query-driven partial sync, TypeScript mutators, Postgres only, Apache-2.0. Better for large datasets where only viewed data should sync.
- PowerSync: sync rules per user, real SQLite on the client, strong offline support, service under FSL. Better if phase 1 SQLite schema and queries should be reused.

### Auth

- `AuthProvider` interface in `packages/core`.
- v1: token provider (classic PAT with scopes `repo`, `workflow`, `read:org`; add `notifications` for v2).
- Phase 2: GitHub App provider with device flow. Verified: refreshing a device-flow user token does not require the client secret; user tokens last 8 hours, refresh tokens 6 months.
- Verified constraint: the Notifications REST endpoints only support classic personal access tokens. Phase 2 must keep a PAT option or treat notifications differently for GitHub App users. This is an open design item for phase 2.
- GitHub App user tokens only reach repositories where the app is installed. Organization owners may need to approve the app.

## 5. Testing

- Vitest on `packages/core` against recorded GitHub API fixtures.
- Rust integration tests that run git and Git Town operations on throwaway temporary repositories.
- A small number of Playwright smoke tests on the desktop UI.
- No broad UI snapshot tests.

## 6. Risks

- WebKitGTK performance on Linux for very large DOMs. Mitigation: virtualized diff and log views from the start.
- GitHub stacks API is in public preview. Mitigation: isolated adapter.
- API diffs truncate very large PRs in v1. Accepted until local diffs arrive in v2.
- T3 Code and Codex deep links are unstable. Mitigation: launcher adapter with one entry per tool; CLI first.
- Scope growth. Mitigation: phases above; each v2 item ships separately.

## 7. Naming and license

- Working name `GitHub-client`, package scope `@github-client/*`.
- License MIT (existing file).
- Rename before any public release or hosting: GitHub's trademark policy forbids names that imply GitHub endorsement.

## 8. Next step after approval

Break v1 into an ordered implementation plan, starting with the workspace skeleton, Tauri shell, `AuthProvider` with the token provider, and the GitHub client with ETag polling into SQLite.
