# GitHub-client

A fast, keyboard-first desktop client for GitHub. It keeps pull requests, reviews, and Actions in a local SQLite cache, so screens open instantly and refresh in the background.

Status: v1 in development. See `.claude/plans/` for the product plan and the v1 implementation plan.

## Features (v1)

- Automatic groups: pull requests involving you, each organization, each of your teams, and starred repositories.
- Pull request lists per group with CI state, review decision, labels, and filters (all open, review requested, mine).
- Pull request page: conversation, checks, merge, comments, and reviews.
- Diff review with inline threads, draft comments, and suggestions.
- GitHub Actions: workflow runs, jobs and steps, logs with ANSI colors and search, re-run, cancel, and manual dispatch.
- Command palette (`Ctrl+K`) and keyboard shortcuts.

## Requirements

- [Bun](https://bun.sh) 1.4 or newer
- Rust (stable) for the desktop app
- On Linux, the Tauri system libraries:

  ```sh
  sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev
  ```

## Getting started

```sh
bun install
bun run desktop:dev      # desktop app (Tauri)
```

Sign in with a classic personal access token that has the scopes `repo`, `workflow`, and `read:org`. The app stores it in the system keychain. Alternatives:

- **Use GitHub CLI token** on the sign-in screen imports the token of `gh auth login`.
- Start the app with `GITHUB_TOKEN` set in the environment.

### Browser development mode

```sh
bun --cwd apps/desktop dev   # http://localhost:5173
```

The same UI runs in a normal browser for fast iteration. The token is kept in `sessionStorage` for that tab only, and data is cached in the browser's private file system (OPFS). Actions logs may fail to load in this mode because the log storage does not allow cross-origin requests; the desktop app has no such limit.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run desktop:dev` | Run the desktop app with hot reload |
| `bun run desktop:build` | Build the desktop app bundle |
| `bun run typecheck` | Type-check all packages |
| `bun run test` | Run the unit tests |
| `bun run lint` | Lint and format check (Biome) |
| `bun run format` | Apply Biome fixes |

## Layout

```
apps/desktop/          React app and Tauri shell (src-tauri)
packages/core/         GitHub API clients, sync, collections, domain types, parsers
packages/ui/           shadcn components on Base UI, plus ReUI components
```

`packages/core` has no DOM or native dependencies. Platform services (HTTP, SQLite, keychain) are passed in by the app, so the same core can back a web or mobile app later.

## How data stays fresh

- Screens read TanStack DB collections that are persisted to SQLite and loaded at startup.
- Sync jobs poll GitHub. The view you are looking at refreshes about every 15 seconds; background groups refresh about every 2 minutes.
- REST lists use ETags, and unchanged responses (`304`) do not count against the rate limit.
- The remaining GraphQL budget is shown at the bottom of the sidebar.

## License

MIT
