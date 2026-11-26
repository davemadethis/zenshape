# main

**Does** — Electron entry point: app lifecycle, menu, persistence, downloads, `zenshape://`, single instance. Creates one `ZenshapeWindow`.

**Why it exists** — Process-wide concerns live here; everything about one window and its tabs lives in `tab-views.ts`. Electron rather than Tauri: system webviews render inconsistently and WebKitGTK's WebGL is unreliable on Linux, and Onshape is a WebGL app (hardware acceleration stays on).

**Talks to** — `tab-views.ts` (the window), `app-menu.ts` (the menu's template), `saved-sign-in.ts` (with `safeStorage`), `app-state.ts` + `window-state.ts` (disk), `tabs.ts` (`tabsToRestore`), `navigation.ts` (UA cleanup), `web-preferences.ts` (`PARTITION`). Built by the Forge Vite plugin into `.vite/build/main.cjs`.

**Gotchas**
- The menu comes from `appMenuTemplate` (`app-menu.ts`), with a context `menuContext()` builds fresh each time; the same is handed to the window as `appMenu`, for the Z's menu off macOS. It's set on every OS: off macOS it shows nowhere, but registers the accelerators. It is rebuilt on every tab change so "Hide/Show Tab Bar" reads right. Accelerators: ⌘T/⌘W/⌘1–9/⌃Tab/⌃⌘B, plus ⌘R, ⌘[ ⌘], ⌥⌘I acting on the active tab; ⌃⌘Z and ⌃⌘B on macOS only.
- `startUpdates` (`updates.ts`) runs once at launch; a newer release becomes an "Update Available (x.y.z)…" item under About and is handed to every window (`setUpdate`).
- Dev runs with `ZENSHAPE_E2E=1` (the UI tests) also get Chromium switches that keep a covered window rendering, so measurements don't depend on what else is on screen.
- About Zenshape opens the window's splash view (creating a window first if none is open) (logo, version, disclaimer), not the native About panel: Windows has none. The same view shows briefly at launch.
- **Saved sign-in:** the App menu has Saved Sign-in… (the splash view's page, to save or change the login; with a sign-in tab open, its Sign in also signs in) and Forget Saved Sign-in (enabled while the file exists). There's no File menu fill. One `SavedSignIn` (`saved-sign-in.ts`) at `userData/saved-sign-in.json`, created with the first window. The sign-in diagnostic log starts at ready, in the logs folder (`sign-in-log.ts`).
- "Restore All Tabs on Launch" lives in the app menu, not a settings window. All tabs are always saved; the setting only filters what comes back.
- Tab changes are written to `app-state.json` 500ms after the last change, and immediately on window close.
- A download started from a tab that never showed a page (an export opened "in a new tab") closes that tab.
- Session is `persist:zenshape`. Packaged builds encrypt cookies via fuses; `npm start` uses a separate `Zenshape Dev` profile so the two don't clobber each other.
- In dev, the Dock name and icon come from `node_modules/electron/dist/Electron.app`. `npm start`'s prestart (`scripts/dev-bundle.sh`) renames it to Zenshape, gives it its own bundle ID (`com.zenshape.app.dev`), copies in `assets/icon.icns` and re-signs it ad hoc. The ID matters: other Electron projects share `com.github.Electron`, and the Dock resolved the name from one of them. The Dock labels apps by folder name (`Electron.app`) unless the bundle declares a localized display name (`LSHasLocalizedDisplayName` + `en.lproj/InfoPlist.strings`), and macOS only honours that while the default `CFBundleDisplayName` still matches the folder name, so the default stays "Electron" and the English localization says "Zenshape". A reinstall undoes it; the next `npm start` reapplies it.
- App ID `com.zenshape.app`, product name `Zenshape`, scheme `zenshape`.
- Google sign-in refuses embedded browsers; Onshape email/password and company SSO are expected to work (Google not tried).
- ⌃⌘B toggles the tab bar: ⌘⇧ combinations collide more with Onshape's own shortcuts.
- `zenshape://` registers at runtime on Windows/Linux and via `packagerConfig.protocols` on macOS. On macOS it only works in the packaged build.
- Closing the last tab closes the window, and its pins with it (that's what closing them means).
