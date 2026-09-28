# @github-client/desktop

## 0.7.1

### Patch Changes

- [#35](https://github.com/Yis-company/GitHub-client/pull/35) [`7331ba2`](https://github.com/Yis-company/GitHub-client/commit/7331ba29885cbc89e8aefaa4b5b755362c68afd9) Thanks [@ybtam](https://github.com/ybtam)! - Reveal inbox section headings while dragging and automatically settle confirmed closed or merged pull requests.

- [#37](https://github.com/Yis-company/GitHub-client/pull/37) [`a0599c6`](https://github.com/Yis-company/GitHub-client/commit/a0599c62742892985ece692b8088467da01c46cd) Thanks [@ybtam](https://github.com/ybtam)! - Stop automatically fetching starred repositories and their pull requests. Remove old Starred feed entries on startup while preserving personal, organization, and team feeds.

## 0.7.0

### Minor Changes

- [#32](https://github.com/Yis-company/GitHub-client/pull/32) [`81bfbd4`](https://github.com/Yis-company/GitHub-client/commit/81bfbd4d049abaafa251c8a64d732ebdaae8bf3a) Thanks [@ybtam](https://github.com/ybtam)! - Add a repository Releases tab with release notes, asset links, pagination, and refresh support.

- [#34](https://github.com/Yis-company/GitHub-client/pull/34) [`474bd2e`](https://github.com/Yis-company/GitHub-client/commit/474bd2e579988321bb591b7334ebdbf2a274f8e5) Thanks [@ybtam](https://github.com/ybtam)! - Show approval actions for pending pull request workflows in the checks views.

### Patch Changes

- [#31](https://github.com/Yis-company/GitHub-client/pull/31) [`8cf4d1a`](https://github.com/Yis-company/GitHub-client/commit/8cf4d1aabe1434788766252d2f20840af66068e0) Thanks [@ybtam](https://github.com/ybtam)! - Keep repository headers and branch controls fixed while the file tree and content preview fill the available height and scroll independently. Make organization and team headers more compact while keeping their titles prominent.

## 0.6.0

### Minor Changes

- [#27](https://github.com/Yis-company/GitHub-client/pull/27) [`c9a589c`](https://github.com/Yis-company/GitHub-client/commit/c9a589c28038dacf8128732305a2ce52695f42cd) Thanks [@ybtam](https://github.com/ybtam)! - Keep scoped pull request inboxes inside organization, team, and repository tabs. Show workflow logs in contextual dialogs, avoid duplicate wide-screen check tabs, and browse repository files beside their preview.

### Patch Changes

- [#28](https://github.com/Yis-company/GitHub-client/pull/28) [`2a59d8a`](https://github.com/Yis-company/GitHub-client/commit/2a59d8a53e33fca4d13cbe9773cb1ce39fe2b14b) Thanks [@ybtam](https://github.com/ybtam)! - Keep visited team and organization repository lists and repository pages locally, render saved content immediately on return, and retain visited files for offline reading.

## 0.5.0

### Minor Changes

- [#23](https://github.com/Yis-company/GitHub-client/pull/23) [`870ab38`](https://github.com/Yis-company/GitHub-client/commit/870ab386532be4af3e7106cbfefee3625592af0d) Thanks [@ybtam](https://github.com/ybtam)! - Replace the PR-first home with organization and team dashboards, and let you browse repositories, branches, folders, files, and READMEs without relying on pull request activity.

### Patch Changes

- [#25](https://github.com/Yis-company/GitHub-client/pull/25) [`e07d774`](https://github.com/Yis-company/GitHub-client/commit/e07d774d0922db8c884d0ed573a1cb29a9bcc7b6) Thanks [@ybtam](https://github.com/ybtam)! - Size pull request conversation checks to fit their content and let the conversation fill the remaining width.

- [#22](https://github.com/Yis-company/GitHub-client/pull/22) [`4e31059`](https://github.com/Yis-company/GitHub-client/commit/4e31059cf229761c76717578e6c6f0bf6212fb9d) Thanks [@ybtam](https://github.com/ybtam)! - Make pull request numbers more prominent in the inbox, group list, and detail header.

- [#24](https://github.com/Yis-company/GitHub-client/pull/24) [`3aa0c33`](https://github.com/Yis-company/GitHub-client/commit/3aa0c33e46d138a41eac792d325c335328a722e7) Thanks [@ybtam](https://github.com/ybtam)! - Keep desktop SQLite transactions on one stable connection to prevent database lock errors during synchronization.

## 0.4.0

### Minor Changes

- [#18](https://github.com/Yis-company/GitHub-client/pull/18) [`f9078fd`](https://github.com/Yis-company/GitHub-client/commit/f9078fdbbd06059ae0430649f1ee0c74f8bd544a) Thanks [@ybtam](https://github.com/ybtam)! - Allow approving pull request workflow runs from the run page, with confirmation, error feedback, and refreshed run status.

- [#17](https://github.com/Yis-company/GitHub-client/pull/17) [`462debf`](https://github.com/Yis-company/GitHub-client/commit/462debf77cd91a78fcaf84c51c3d9b0c3c9191c1) Thanks [@ybtam](https://github.com/ybtam)! - Show workflow checks beside the pull request conversation in wide detail panes, keeping checks visible while scrolling.

- [#15](https://github.com/Yis-company/GitHub-client/pull/15) [`6c18a42`](https://github.com/Yis-company/GitHub-client/commit/6c18a4249ffa96f9ba089e0808b09b97ef1aea99) Thanks [@ybtam](https://github.com/ybtam)! - Add System, Light, and Dark appearance choices to the account menu and command palette. Follow the system theme by default, preserve saved preferences, and match native controls to the selected theme.

- [#11](https://github.com/Yis-company/GitHub-client/pull/11) [`b68ea2e`](https://github.com/Yis-company/GitHub-client/commit/b68ea2e34397376ea136fbee04edd0628c380071) Thanks [@ybtam](https://github.com/ybtam)! - Add pinned PRs, saved sidebar ordering, drag-and-drop organization with exact Undo, compact parked rows, and a resizable inbox sidebar.
  
  Restore cached rows and subscribed views after failed local database writes.

### Patch Changes

- [#19](https://github.com/Yis-company/GitHub-client/pull/19) [`7eec5c1`](https://github.com/Yis-company/GitHub-client/commit/7eec5c101b76b92e1754feadfd9d1b95a98868d5) Thanks [@ybtam](https://github.com/ybtam)! - Prefetch pull request details and files when hovering a pull request in the list.

- [#11](https://github.com/Yis-company/GitHub-client/pull/11) [`4f55439`](https://github.com/Yis-company/GitHub-client/commit/4f554393830fcef5b98cce851bd710536cdfe49b) Thanks [@ybtam](https://github.com/ybtam)! - Use a single PR inbox sidebar with collapsible snoozed and settled sections, consistent repository navigation, check-result summaries, and a GitHub contribution calendar.

- [#20](https://github.com/Yis-company/GitHub-client/pull/20) [`dcb69b8`](https://github.com/Yis-company/GitHub-client/commit/dcb69b8d57c08d56e6b19c12619b620843e1725c) Thanks [@ybtam](https://github.com/ybtam)! - Run an explicit refresh after an in-flight pull request sync so the view can pick up the latest head revision.

- [#11](https://github.com/Yis-company/GitHub-client/pull/11) [`3d21da9`](https://github.com/Yis-company/GitHub-client/commit/3d21da9f575db8c206cb240783e63232c5e110cd) Thanks [@ybtam](https://github.com/ybtam)! - Restore persistent outer navigation, retain the T3-style PR sidebar inside Inbox, and integrate native macOS window controls into the outer sidebar.

## 0.3.0

### Minor Changes

- [#8](https://github.com/Yis-company/GitHub-client/pull/8) [`31b7683`](https://github.com/Yis-company/GitHub-client/commit/31b768352e00a093a78d419fced85c6721a68d3c) Thanks [@ybtam](https://github.com/ybtam)! - Check for new versions from inside the app, and install the latest release and restart in one click.

### Patch Changes

- [#12](https://github.com/Yis-company/GitHub-client/pull/12) [`05ee294`](https://github.com/Yis-company/GitHub-client/commit/05ee294dde266006736947299e4d25f684170f0b) Thanks [@ybtam](https://github.com/ybtam)! - Show asynchronous request and action failures with contextual Sonner toasts while preserving cached content, drafts, and recovery guidance.

- [#9](https://github.com/Yis-company/GitHub-client/pull/9) [`9a64e52`](https://github.com/Yis-company/GitHub-client/commit/9a64e521e857366d6cb685cd65d68da3786fb3ac) Thanks [@ybtam](https://github.com/ybtam)! - Fix horizontal scrolling in the pull request list caused by longer localized timestamps.

- [#14](https://github.com/Yis-company/GitHub-client/pull/14) [`f6b74f0`](https://github.com/Yis-company/GitHub-client/commit/f6b74f08e893e6ac1a56e692e171ffbd168827c2) Thanks [@ybtam](https://github.com/ybtam)! - Restore synced collection writes after idle cleanup so Actions jobs load when returning to the app.

- [#13](https://github.com/Yis-company/GitHub-client/pull/13) [`e4263ac`](https://github.com/Yis-company/GitHub-client/commit/e4263ac9d65f9c6f9ec56bb885f9ffb5138796b6) Thanks [@ybtam](https://github.com/ybtam)! - Replace browser-native merge confirmation with an inline confirm button that stays in place and shows progress while merging.

## 0.2.0

### Minor Changes

- [#6](https://github.com/Yis-company/GitHub-client/pull/6) [`00a57ce`](https://github.com/Yis-company/GitHub-client/commit/00a57cee6b3f040f08ff91d4a9fc3d1d24798aaa) Thanks [@ybtam](https://github.com/ybtam)! - Group teams by organization and parent team, make repository context clearer, add a persistent PR inbox with snooze and settle controls, and edit supported GitHub repository settings in the app.

## 0.1.1

### Patch Changes

- [#4](https://github.com/Yis-company/GitHub-client/pull/4) [`c2776b4`](https://github.com/Yis-company/GitHub-client/commit/c2776b4d46fe8168fbd7ab9d5813159a0b6f26d3) Thanks [@ybtam](https://github.com/ybtam)! - Handle Tauri SQLite duplicate-column errors during persistence startup.

## 0.1.0

### Minor Changes

- [#1](https://github.com/Yis-company/GitHub-client/pull/1) [`79fdf16`](https://github.com/Yis-company/GitHub-client/commit/79fdf1663079f6031cb986fad5fa3eaf42553f8b) Thanks [@ybtam](https://github.com/ybtam)! - First release: pull request lists per org, team, and starred repos; pull request pages with diff review, comments, reviews, and merge; GitHub Actions runs, logs, re-run, cancel, and manual dispatch.
