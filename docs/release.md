# release

**Does** — Turns a version tag into installers. A `vX.Y.Z` tag pushed to `davemadethis/zenshape` runs `.github/workflows/release.yml`, which builds macOS arm64 and x64 (`.dmg`, `.zip`), Windows x64 (`Zenshape-Setup.exe` plus `RELEASES`/`.nupkg`) and Linux x64 (`.deb`, `.rpm`) into a **draft** GitHub Release, which is published by hand. `forge.config.mts` holds the makers and the GitHub publisher; `assets/` holds the icons.

**Why it exists** — Installable builds for every OS without a Windows or Linux machine, and one place where a version number comes from: `package.json` `version`, matched by the tag, compared by the app to the release's tag (`updates.ts`).

**Talks to** — `updates.ts` (reads the published releases), GitHub Actions.

**Gotchas**
- **Drafts on purpose:** a broken build never reaches installed copies until it's checked and published. update.electronjs.org and GitHub's latest-release endpoint both skip drafts and prereleases.
- **Public repo only:** update.electronjs.org serves only public repos, and the macOS/Linux notice's latest-release request is unauthenticated, so releases, downloads and the update check all live on the public `davemadethis/zenshape`.
- **Unsigned builds:**
  - macOS can't update itself. Squirrel.Mac only installs updates signed with the running app's Developer ID. That's from Electron's docs; it hasn't been tried with a signed build. With a Developer ID, macOS moves to full self-updates through the same service.
  - Every build has a new ad-hoc signature, so after an update macOS may ask about the "Zenshape Safe Storage" Keychain item, which holds the cookie-encryption key. "Always Allow", or you're signed out.
- **CI layout:**
  - A first job creates the draft so the four builds don't race to create it. Forge's GitHub publisher then uploads into the draft with the matching tag.
  - Both macOS builds run on the Apple Silicon runner (`--arch=x64` cross-builds Intel), because GitHub is retiring its Intel runners.
- **Linux builds on `ubuntu-22.04`**, not latest: rpm 4.20+ breaks electron-installer-redhat's `%install` (the `WORKAROUND:` comment in `release.yml`). The job installs `rpm` for the `.rpm` maker.
- **Windows installer name** is set (`setupExe`) to `Zenshape-Setup.exe`; Forge's default has the version and a space in it. Squirrel can't build on a Mac, so Windows is CI-only.
- **npm 11 blocks install scripts** unless approved: `allowScripts` in `package.json` approves the DMG maker's native modules (`macos-alias`, `fs-xattr`) and `electron-winstaller`. A version bump of any of them needs its entry updated.
- **Icons:** `assets/z-logo.svg` and `assets/icon.svg` (evenodd path, so the cuts are see-through) are the source. `scripts/make-icons.sh` renders `.icns`/`.ico`/`.png` with Electron itself, because Quick Look thumbnails came out with opaque white corners.
