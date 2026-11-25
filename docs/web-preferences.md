# web-preferences

**Does** — The two `webPreferences` sets in the app: Onshape views (persistent session, sandboxed, no preload) and our strip (sandboxed, our one preload, default session).

**Why it exists** — Security settings in one place, asserted by `test/web-preferences.test.ts`.

**Talks to** — `tab-views.ts`, `main.ts`.

**Gotchas** — Never add a preload to `onshapeWebPreferences()`.
