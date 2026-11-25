# updates

**Does** — Finds newer releases on GitHub. Windows installs them itself (`update-electron-app` via update.electronjs.org); macOS and Linux get a notice: `startUpdates` checks GitHub's "latest release" at launch and daily and reports anything newer, which `main.ts` shows in the app menu and the tab bar.

**Why it exists** — Releases live in GitHub Releases (`release.md`); an unsigned macOS app can't self-update (Squirrel.Mac rejects unsigned updates), so only Windows gets the full updater.

**Talks to** — `main.ts` (wires it, menu item), `tab-views.ts` (`setUpdate` → strip state `update`), GitHub's API.

**Gotchas**
- Packaged builds only; dev runs never check.
- `isNewer` takes plain `x.y.z` only, so a prerelease tag is never offered. GitHub's latest-release endpoint already skips drafts and prereleases.
- `pickUpdate` only trusts links into this repo's releases page.
- Both the update service and the unauthenticated API need a public repo: releases live on `davemadethis/zenshape` (`release.md`).
