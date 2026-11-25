# split

**Does** — Pure split-view helpers: pairing, pane/divider layout, the 15% minimum, drop math (`edgeZone`, `zoneRect`, `paneAt`, `placeAt`) and `swapped`/`rotated`.

**Why it exists** — Keeps the geometry testable without Electron (`test/split.test.ts`).

**Talks to** — `tab-views.ts`.

**Gotchas** — `a` is left/top, `b` right/bottom; `ratio` is `a`'s share after removing the 6px divider. Panes are rounded to whole pixels and always add up to the area exactly.
