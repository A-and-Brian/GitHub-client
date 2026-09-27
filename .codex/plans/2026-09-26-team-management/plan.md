# Manage existing GitHub teams

Proposed · 26 September 2026 · Author: Astra

## Recommended scope

Add a Manage team page for existing teams, covering members, repository access, and basic details. The user clarified that projects means repositories.

A minimal add/remove-only version leaves roles and team edits incomplete. Recommend including those daily administration tasks. A full GitHub clone adds creation, deletion, hierarchy, invitations and Projects boards; defer those, along with custom role administration and identity-provider configuration.

## User experience

Add **Manage team** to the existing team pull-request page. Route `/teams/$org/$slug` has Members, Repositories, and Settings tabs, a return link, and Open on GitHub. Existing PR navigation stays intact.

- Members: paginated list, direct/inherited badges, member/maintainer roles, organization-member picker, add, role change, and confirmed removal. Edit direct memberships only. Verify existing organization membership immediately before adding; do not invite outsiders. Removal may leave inherited membership.
- Repositories: paginated effective-access list, organization-repository picker, Add repository with explicit role, Change access, and confirmed Remove team access. Read/Triage/Write/Maintain/Admin map to pull/triage/push/maintain/admin. Display unknown/custom roles without silently converting them.
- Settings: name, description, visible/secret privacy, changed-field Save, Cancel, retained drafts and validation. Show parent team without editing it; respect nested-team privacy restrictions.

## Architecture and API contract

Use on-demand management snapshots and screen-local drafts, existing REST/GraphQL clients and shared UI components. No database collection, migration, dependency, or administration background poller. Group remains derived viewer navigation, not editable remote team state.

Flow: load GitHub → edit → fresh permission/baseline check → minimal write → authoritative readback → refresh group navigation.

Use REST `/orgs/{org}/teams/{slug}` for details, its `/memberships/{username}` for member PUT/DELETE, and `/repos/{owner}/{repo}` for repository PUT/DELETE. Keep the pinned 2022-11-28 API version; do not assume newer member role/inherited REST fields exist.

Use GraphQL Team.members with IMMEDIATE and ALL membership filters, paginating both and reading edge roles. Compare stable user IDs for inherited-only membership. Team.viewerCanAdminister informs eligibility. Paginate repository/picker results; failed or incomplete pages never prove absence or authorize removal.

Repository rows show effective access. PUT explicitly sets this team's grant; DELETE removes its grant. After accepted deletion, refresh and report if inherited access remains. Do not equate a stronger effective permission with the requested direct role. Require explicit role selection; opening a custom role must not replace it automatically.

Detect changes to edited settings against a fresh baseline; retain drafts on conflict. Refresh member role before changing it. Serialize writes per team and invalidate stale responses on navigation, account changes and unmount. Preflight cannot prevent all subsequent races; GitHub has no transaction across these requests.

Accepted writes with failed readback show Accepted; confirmation pending, with read-only retry and no automatic write replay. Distinguish successful writes from failed navigation refresh. After rename use the returned slug; refresh existing groups after edits. Self-removal can make a team inaccessible; return safely to navigation.

## Permissions and errors

Keep existing read-only login compatible; do not globally require extra scopes. Provide optional token guidance: classic admin:org covers team administration, write:org membership. Fine-grained requirements vary by operation: Members organization write for membership/details, repository Administration write plus Members/Metadata read for assignments.

GitHub authorization is authoritative. Handle permission denial, SSO, inaccessible teams, rate limits, validation, IdP-managed membership, and unknown capabilities. Unresolved capability is read-only; retain readable content. Never log tokens or automatically request broader credentials.

## Implementation milestones

1. Core: add packages/core/src/actions/team-settings.ts and tests; export through src/index.ts. Typed snapshots, pagination, minimal writes, conflicts and confirmation outcomes.
2. Desktop: add apps/desktop/src/screens/team-settings.tsx, route in src/app/router.tsx, entry in src/screens/group-pulls.tsx. Reuse session, components and request-generation guards.
3. Integration: use packages/core/src/client.ts refresh API and groups job. Modify sync/groups.ts only where rename reconciliation requires it; preserve derived Group semantics.
4. Verification: extend apps/desktop/e2e/fake-github.ts, add team-settings.spec.ts, update README permissions guidance and add required desktop changeset.

## Acceptance and validation

- Authorized users add/remove direct members, change roles, attach/detach repositories, change access and save basic details.
- Read-only users browse; existing login, normal groups and PR workflows remain unchanged.
- Pagination, inherited access, same slugs across organizations, rename, self-removal, custom roles and IdP rejection behave explicitly.
- Errors/conflicts preserve drafts; unconfirmed writes never show confirmed success.
- Unit tests verify request bodies, permission rechecks, inheritance, pagination, concurrent edits and readback failures.
- Mocked Playwright covers all tabs, denied writes, confirmation retry, rename and stale navigation responses.
- Run bun run typecheck, bun run test, bun run lint and focused desktop Playwright tests. Report baseline failures separately.
- Check keyboard use, narrow layouts and light/dark themes. Verification requires no real organization mutations.

## Approval and rollback

Approval accepts this scope and boundaries. Record Plannotator's structured decision in review.json before implementation. Reverting feature code needs no schema rollback but does not undo already accepted GitHub changes.

## Evidence

Existing navigation model: packages/core/src/domain/types.ts:18. Team discovery: packages/core/src/sync/groups.ts:32. Mutation precedent: packages/core/src/actions/repository-settings.ts:90. UI precedent: apps/desktop/src/screens/repository-settings.tsx:21. Token requirements: packages/core/src/auth/auth.ts:63.

- [Team REST API](https://docs.github.com/en/rest/teams/teams)
- [Membership REST API](https://docs.github.com/en/rest/teams/members)
- [GraphQL teams](https://docs.github.com/en/graphql/reference/teams)
- [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)


## Revision 2 — Mobbin research and storyboard

Review feedback: “use mobbin to research how this should look + give me story board style prototype”. This revision changes the review surface and interaction specification; it does not authorize application implementation.

### Research inspected

- [Exa: updating a member role](https://mobbin.com/flows/2fb3b980-3b0a-43de-975c-d1a63454eff7): a compact member table, row-level role control, descriptions within the role menu, and prominent add-member action. Adapt the pattern to GitHub member/maintainer roles and existing organization members; do not copy Exa invitation semantics.
- [GitHub: manage access](https://mobbin.com/screens/dab3882a-8627-4382-97ec-70eafb9d5353): access summary above a searchable list, Add people aligned right, and row removal action. Adapt to team repository grants and show effective permissions honestly.
- [GitHub: access feedback](https://mobbin.com/screens/d8d241d2-eb61-45f8-b1e0-ebf7fe023c64): visible result banner while preserving the access list. Adapt to confirmed saves and distinguish pending confirmation.

The search did not provide a matching GitHub team-removal flow. Removal/inheritance states in this storyboard are our proposed design, based on the plan's behavior contract, rather than a claim of observed GitHub team UI.

### Storyboard contract

The HTML review begins with a numbered, clickable storyboard with scene overview and Previous/Next controls. Every scene includes intent, action, and outcome outside the app frame. In-screen controls also move through the relevant flow. Fictional Acme data only; all edits are simulated in browser memory and never call GitHub.

The app frame preserves the existing neutral sidebar and compact controls. Team management has Members, Repositories, and Settings tabs. The review demonstrates entry from team PRs; selecting an existing organization member and role; success; role change; removal with inherited membership remaining; repository selection with explicit access; repository removal with inherited access remaining; editing details; and a denied/pending-confirmation state with recovery. Removal dialogs name the member or repository and distinguish removing the team's grant from deleting an account or repository.

Use compact tables, searchable pickers, explicit role descriptions, named actions, destructive confirmation, readable inline feedback, and accessible focus states. The prototype supports light/dark themes and narrow layouts. References are linked and downloaded reference images are embedded in the self-contained HTML. The original implementation plan remains available below the storyboard.

### Prototype acceptance

Verify numbered scene navigation, Members/Repositories/Settings transitions, add and cancel, role selection, removal and inherited result, settings save, confirmation retry, theme toggle, and narrow-screen layout. Verify there are no external resources or GitHub mutation calls. Prototype verification is separate from future application testing.
