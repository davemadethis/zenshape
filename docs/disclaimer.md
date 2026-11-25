# disclaimer

**Does** — The disclaimer text (title, points, trademark line) shown on the launch splash and in About.

**Why it exists** — One copy, so the splash and About can't drift apart (`src/disclaimer.ts` says where else the text is repeated); and a place that says every claim must stay true of the code: it says plainly what Zenshape doesn't do.

**Talks to** — `strip/strip.ts` (splash mode) and `test/ui/splash`.

**Gotchas**
- Each claim is a promise about the code (no scripts in Onshape pages, zen never hides notices or billing, no API/scraping/automation). Changing behaviour that touches one means changing the text in `src/disclaimer.ts`, and everywhere its comment says it's repeated.
- **Zen never hides** Onshape's copyright footer, the Free-plan billing banner, or the plan box. `zen.ts` says how; `test/ui/zen-list` checks it.
- **Never Onshape's logo** in our own UI (tab strip, splash, icons).
