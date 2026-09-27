# Organization and team dashboard

## Decision to review
Replace the PR-first start screen with Home and dedicated organization and team dashboards. Each dashboard brings together its identity, repositories, and recent synced open pull request activity; organizations also show your visible member teams. Keep the PR inbox one click away. A repository must be discoverable even when it has no pull requests.

**Confirmed scope:** include native read-only branch, directory, file, and README browsing inside the app. Repository Code is the default landing view; existing PR, Actions, and authorized settings stay accessible. Issues remain a link to GitHub. No repository mutation, local clone, or terminal workflow is included.

Implementation has not started. This Markdown is the canonical plan; the HTML adds an illustrative navigation storyboard. Review approval is required before application changes.

## Current evidence
- The current `/` route redirects to `/inbox`; `/g/$groupId` opens GroupPulls. Existing `/pr`, `/actions`, and `/settings` routes provide features to preserve.
- `apps/desktop/src/screens/command-palette.tsx` derives repository choices from PRs. That cannot supply a complete repository catalog.
- `packages/core/src/sync/groups.ts` fetches organizations, member teams, starred repositories, and team repositories. It deliberately does not enumerate organization repositories. Cached team/starred repository metadata is not a complete catalog.
- `packages/core/src/domain/types.ts` already carries group parent metadata. Reuse it to associate teams with organizations. Show member teams supplied by the existing sync, not an implied directory of every team.
- `packages/core/src/github/rest.ts` has reusable REST requests. Its `pollAll` default cap of 30 pages can return success without a completeness flag; do not use that result as proof that a catalog is exhaustive.
- `packages/ui/src/styles/globals.css` defines the app's neutral light/dark theme and Geist typography. Reuse this language and existing UI primitives.

## User journey
| Destination | Behavior |
| --- | --- |
| Home `/` | Organizations and your visible member teams; persistent Inbox and Settings navigation. |
| Organization dashboard | Organization identity, visible member teams, repository preview, and recent synced open PR activity; clear links to the repository catalog and existing group PR view. |
| Team dashboard | Parent organization breadcrumb, team identity, repository preview, and recent synced open PR activity; clear links to the team catalog and existing group PR view. |
| Repository overview | Code tab with branch selector, directory breadcrumbs, text file viewer and safe README; repository metadata and existing PR/Actions/authorized settings links; issues and fallbacks on GitHub. |
| Existing inbox and deep links | Continue to work directly; group PR views remain reachable from overview pages. |

Use dedicated overview routes, such as `/org/$login`, `/team/$org/$slug`, and `/repo/$owner/$name`, after checking route conventions. Do not repurpose existing group PR URLs. Home navigation should remain obvious from every overview. Personal repository browsing is deferred from this organization/team slice; existing starred access remains intact.

## Organization and team dashboards
Home organization and team cards open their respective dashboards, not a repository list alone. Use Overview, Repositories, and Pull requests navigation: Overview is the dashboard, Repositories opens the paginated catalog, and Pull requests reuses the existing scoped group PR route.

The organization overview starts with organization identity, then a visible-member-teams section linking to each team dashboard. A repository section shows a small preview from the on-demand catalog with descriptions and visibility, plus a link to the full catalog. A recent synced pull requests section shows a short list ordered by available update time, with repository, title, and existing status. Each item opens existing PR details.

The team overview has an organization breadcrumb and team identity, then the same repository and scoped recent synced open PR sections. Keep its data limited to the selected team. Do not add a full member directory, member totals, organization-wide team totals, or invented analytics. These are useful navigation and activity overviews rather than metric cards.

Activity lists open PRs from the existing synced group snapshot, ordered by updated time. Reuse GroupPulls’ watchGroup lifecycle and existing group job status. Activity uses the existing group subscription mechanism only for the selected organization or team, released when leaving or changing scope. Reuse its current snapshot and available sync state; do not introduce a dashboard polling service or subscribe to all groups or newly discovered repositories. Label the section “Recent synced open pull requests.” Show last-sync time only when supplied by the existing mechanism, otherwise label freshness as unavailable. A cached snapshot remains labeled while refreshing; loading, no synced activity, and failed refresh are distinct states. No synced activity does not mean no GitHub activity. Repository previews also distinguish loading, empty, and failed requests. Any counts must say loaded repositories or synced PRs and must not imply complete GitHub totals; omit summary counts in this slice.

## Data and loading contract
Fetch catalogs on demand for the selected organization or team using GitHub's list-organization-repositories and list-team-repositories endpoints. Do not derive repository membership from PRs or start background PR polling for every discovered repository.

Use explicit pages through the existing REST client, with up to 100 repositories per request and a Load more action. A full page means another page may exist; an eventual short or empty page establishes completion. Deduplicate appended rows by stable repository identity. Keep a failed next-page request retryable without discarding earlier rows. Do not label the loaded count as the total while more pages may remain.

Partition request state by authenticated account, host if supported, scope, and page. Discard late responses after account/scope changes. Clear inaccessible cached content on authorization failure or account removal. Reuse existing authentication and error handling; no token-scope migration is part of this change. An unavailable or forbidden catalog is not an empty catalog.

Show loading, empty, partial-with-more, and retryable failure states distinctly. Any cached team catalog is provisional until refreshed against the selected scope. Avoid new persisted catalog machinery unless the existing lifecycle demonstrably preserves account/scope isolation. PR counts, if shown, must explicitly refer to synced PRs; absence of a synced PR is not evidence that a repository has no open PRs. Prefer omitting counts in the first slice.

## Native repository browser
Use GitHub branches and Contents APIs for a read-only Code tab. Paginate branches explicitly. Encode branch refs and paths correctly, including branch names containing slashes. Preserve branch selection while traversing directories and resolve README links/images against that repository, path and ref.

Contents directory listings cap at 1,000 entries: clearly disclose that limit and offer GitHub fallback rather than presenting a truncated folder as complete. Render supported text files only up to 1 MB; use clear external/open or download fallbacks for binary, larger, and unsupported content. Respect symlink and submodule response types rather than pretending they are ordinary files. Empty repositories and inaccessible files have distinct states.

Use GitHub-rendered README with an explicit sanitization/allowlist boundary and safe URL resolution. The existing `github-html.tsx` renders trusted GitHub bodyHTML; it does not establish safety for arbitrary local Markdown. Do not inject arbitrary raw HTML. Isolate file/README responses by account, repository, branch and path so fast navigation cannot replace current content with stale results.

## Implementation sequence
1. Add small typed organization/team repository page loaders using existing REST/auth infrastructure. Test pagination boundaries, errors, and response isolation before wiring views.
2. Add distinct organization/team dashboards, catalog views, and repository Code screens using existing primitives. Reuse the selected group subscription and PR routes for scoped activity; show snapshot freshness and separate activity loading/error states. Add branch/directory/file loaders and the safe README boundary. Reuse group relationships and existing feature links; repository browsing must work without a cached PR.
3. Change `/` into Home, add Home navigation, and connect org → team → repo journeys. Preserve `/inbox`, group PR routes, PR details, Actions, settings, and existing starred behavior.
4. Verify real user journeys with the existing fake GitHub fixtures and focused browser tests. Run affected unit tests, type checks, lint, and the relevant navigation suite. Inspect light/dark and narrow layouts.

## Acceptance checks
- A signed-in launch opens Home. Inbox remains directly reachable and its saved behavior is preserved.
- A user can move Home → organization dashboard → team dashboard → repository Code and back using keyboard and browser history. Overview, Repositories, and Pull requests remain reachable for each group.
- Organization and team dashboards show their own identity, repository preview, and scoped recent synced open PR activity; the organization also links to visible member teams. Selecting another group releases the previous subscription and cannot leak its activity into the new dashboard.
- Cached, loading, empty, and failed activity states are distinct; freshness is shown only when known. No snapshot or loaded count claims GitHub-wide completeness. Opening Home does not subscribe to every group.
- An accessible repository with zero PR fixtures appears and opens its overview. A repository absent from the current PR cache is equally accessible.
- Multiple repository pages load without duplicates; a later-page error supports retry; a full page never falsely claims completion.
- No organizations, no member teams, and no repositories have distinct helpful empty states. Permission/network failures show errors rather than empty results.
- Switching accounts or scopes during an in-flight request cannot display the previous account's repository data.
- Existing PR, group PR, Actions, settings, and starred routes still work. Merely viewing the catalog does not schedule PR synchronization for its repositories.
- Repository actions use existing capabilities; settings do not imply permissions the user lacks. Branches, files and README open in-app; issues and unsupported file fallbacks open the matching GitHub destination.
- Slash-containing branch names and nested paths resolve correctly; stale branch/path responses cannot overwrite the current view. Empty repositories, binary and large files, symlinks/submodules, and the directory cap have explicit behavior.
- A malicious README fixture cannot execute scripts or unsafe URLs. Relative README links/images resolve to the selected repository/ref; branch pagination remains usable beyond the first page.
- The dashboard works in light/dark themes, at narrow widths, and with keyboard focus.

## Boundaries and review
No organization/team administration, membership editing, repository creation, analytics charts, new notification system, or write operations in this slice. No publication or remote changes are needed to implement it.

The user confirmed native branches, files and README. The latest review asks for actual organization and team dashboards; the unrelated Linear/Boards/Backlog feedback was withdrawn. This revision includes those dashboards and awaits renewed approval. Review the proposed read-only limits, fallback behavior, and navigation before implementation begins. The storyboard uses synthetic names and demonstrates navigation only; it is not connected to GitHub and contains no live account data.

## API references
- [GitHub: list organization repositories](https://docs.github.com/en/rest/repos/repos#list-organization-repositories)
- [GitHub: list team repositories](https://docs.github.com/en/rest/teams/teams#list-team-repositories)
- [GitHub: repository contents](https://docs.github.com/en/rest/repos/contents)
- [GitHub: branches](https://docs.github.com/en/rest/branches/branches)
