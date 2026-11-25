# window-state

**Does** — Loads and saves the main window's normal bounds and maximized flag as JSON in `userData/window-state.json`.

**Why it exists** — Size, position and maximized state should survive a relaunch, as in any desktop app.

**Talks to** — Called by `main.ts` on create and on `close`.

**Gotchas**
- Saved bounds are discarded if they don't overlap any current display by 100px (unplugged monitor).
- Corrupt or missing files fall back to the 1400×900 default.
