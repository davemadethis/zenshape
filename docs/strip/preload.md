# strip/preload

**Does** — Exposes `window.zenshape` (`onState`, `send`) to our strip page via `contextBridge`.

**Why it exists** — The strip needs to send tab clicks to the main process; nothing else in the app gets a bridge.

**Talks to** — `strip-api.ts`; main side is `ZenshapeWindow.onCommand`.

**Gotchas** — Built by the Vite plugin to `.vite/build/preload.cjs`. Runs sandboxed, so only `electron`'s renderer-safe modules are available.
