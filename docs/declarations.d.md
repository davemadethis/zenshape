# declarations

**Does** — Declares the `STRIP_VITE_*` globals the Forge Vite plugin injects into the main bundle.

**Why it exists** — TypeScript needs to know they exist.

**Talks to** — `main.ts` (`loadStrip`).

**Gotchas** — Renaming the renderer in `forge.config.mts` renames these globals.
