# Changesets

Every pull request that changes the app needs a changeset. Run:

```sh
bunx changeset
```

Pick `@github-client/desktop`, choose the bump (patch, minor, major), and write one line for the release notes. Commit the generated Markdown file with your change.

`packages/core` and `packages/ui` are internal and not released on their own; describe their changes in a changeset for `@github-client/desktop`.

Pull requests without user-facing changes (CI, docs, refactors) can add an empty changeset with `bunx changeset --empty`.

When changesets reach `main`, the release workflow opens a "Version Packages" pull request. Merging it tags the release, creates the GitHub release, and builds the installers.
