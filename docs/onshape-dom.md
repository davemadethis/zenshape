# onshape-dom

**Does** — Names every element of Onshape's page that Zenshape relies on (`landmarks`) plus the two page scopes (`DOC_PAGE`, `LIST_PAGE`).

**Why it exists** — Onshape can change its front end at any time. Zen mode's CSS (`zen.ts`) and the UI tests (`test/ui`) both read selectors from here, so a change is fixed in one place.

**Talks to** — `zen.ts`; `test/ui/harness.ts` (`ui.landmark(page, name)`); `test/ui/probe.ui.test.ts`.

**Gotchas**
- When Onshape changes: `npm run ui:probe` lists each landmark as ✓, ✗ (with the elements now sitting where it lived), or – (optional and absent). Update the selector here, rerun `npm run test:ui`.
- Some landmarks only exist sometimes (billing banner and plan box on Free plans; welcome/last-opened panes on Owned by me; the detail-pane divider; `docForeignFrame` only on drawings and other embedded-app elements). Tests check them only when present.
- `tabStates` are classes Onshape puts on a bottom tab (`tab-list-item`) only while it's in use (menu open, renaming), so the probe can't look for them; `test/ui/zen-document` checks them.
- `.panel-content-pane` matches two nested elements; that's why `docPanel` and `docPanelInner` are separate.
