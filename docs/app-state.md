# app-state

**Does** — Loads/saves `userData/app-state.json`: saved tabs (url, title, pinned, custom name, locked URL) in strip order, active index, the "restore all tabs" setting, whether the strip is collapsed, and Hide Tab Bar in Zen Mode. `isStripHidden` is the rule for when the tab bar is actually hidden.

**Why it exists** — One place for everything that should survive a relaunch besides window bounds (which stay in `window-state.ts`).

**Talks to** — `main.ts`.

**Gotchas**
- Writes go to a `.tmp` file then rename, so a crash mid-write can't wipe pins.
- Malformed tab entries are dropped individually; a broken file falls back to defaults (pins only, strip expanded).
