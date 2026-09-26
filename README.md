# GitHub-client

A fast, keyboard-first desktop client for GitHub. It keeps pull requests, reviews, and Actions in a local SQLite cache, so screens open instantly and refresh in the background.

Status: v1 in development. See `.claude/plans/` for the product plan and the v1 implementation plan.

## Features (v1)

- Automatic groups: pull requests involving you, organizations with nested parent/child teams, and starred repositories.
- A PR inbox with a side-by-side detail pane, local snooze/settle/restore controls, and failures across all states. Local state survives restart; settling does not close or merge the GitHub PR.
- Repository settings: edit description, homepage, issues/wiki, merge methods, and automatic branch deletion with GitHub admin permission.
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
| `bun --cwd apps/desktop test:e2e` | Run the Playwright UI tests against a fake GitHub API |
| `bun run lint` | Lint and format check (Biome) |
| `bun run format` | Apply Biome fixes |

## Releases

Versions are managed with [Changesets](https://changesets.dev). See `.changeset/README.md`.

1. Every pull request that changes the app adds a changeset (`bunx changeset`). CI fails without one.
2. When changesets land on `main`, the release workflow opens or updates a **Version Packages** pull request that bumps the version and updates `apps/desktop/CHANGELOG.md`.
3. Merging that pull request tags `@github-client/desktop@<version>`, creates the GitHub release, and attaches installers built on GitHub Actions:
   - Linux: `.deb`, `.rpm`, `.AppImage`
   - Windows: `.msi` and `-setup.exe`
   - macOS: universal `.dmg` (Apple Silicon and Intel)

The workflow needs **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** turned on.

### Installing unsigned builds

The builds are not code signed yet:

- **macOS:** the app has an ad-hoc signature only, so Gatekeeper blocks the first launch. After copying the app to Applications, run:

  ```sh
  xattr -dr com.apple.quarantine /Applications/GitHub-client.app
  ```

- **Windows:** SmartScreen warns about an unknown publisher. Choose **More info → Run anyway**.

### Enabling macOS signing later

Once an Apple Developer account is available:

1. Add the repository secrets `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), and `APPLE_TEAM_ID`.
2. Pass them as `env` to the `tauri-apps/tauri-action` step in `.github/workflows/release.yml`. The Tauri CLI signs and notarizes the app when they are set.
3. Remove `bundle.macOS.signingIdentity: "-"` from `apps/desktop/src-tauri/tauri.conf.json`.

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
