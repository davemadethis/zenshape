# zen

**Does** — The CSS that zen mode inserts into Onshape's pages (three sheets: base transitions, fade, collapse) and `ZenSheets`, which tracks what's inserted on one page so it can be removed exactly.

**Why it exists** — Zen mode hides Onshape's own chrome with CSS inserted from the main process (the `WORKAROUND:` comment in `zen.ts`): no JS, no preload.

**Talks to** — `tab-views.ts` (`setZen` runs the fade steps; new pages get `applyAll` on `dom-ready`).

**Gotchas**
- **Never hidden** (`disclaimer.md`): the list-page footer (copyright, Terms & Privacy, version), the Free-plan billing banner, and the sidebar's plan box (Subscription, Try Professional, Plans and pricing). `test/ui/zen-*` check them.
- **Top bar:** hidden only on documents (content starts at 0). Every other page keeps Onshape's whole top bar, and the footer keeps Onshape's own layout.
- **Plan box → billing banner:** on Free plans the sidebar's plan box is pinned (`position: fixed`, 40px down, 50px tall: the top bar's and banner's heights) over the banner's right end, laid out as one row, and the banner's own Plans and pricing button is hidden so it isn't shown twice. Without a banner (paid plans, or the banner selector stopped matching) it's pinned just above the footer instead, on its own background: never hidden either way.
- The list sidebar can't slide as one box: the plan box is inside it, and a faded parent hides its children. So the sidebar box stays put, see-through and click-through, and its two parts (`listSidebarNew`, `listSidebarFilters`) slide together; the reveal rule is `sidebar:has(part:hover)`. The hover strip hangs off the New bar at full window height.
- Selectors live in `onshape-dom.ts` (read from the live pages 2026-10-24); `test/ui` checks the resulting layout. Rules are scoped with `body:has(#model-body)` (documents) or `body:has(.os-document-list-page-container)` (lists). If Onshape renames something, that piece just stays visible.
- The base sheet (transitions) stays on while zen is on and during both fades: a transition only runs if the *after* style has it, so removing the fade sheet alone would snap.
- **Drawings and other embedded apps** (`#foreign-data-container`) run to the bottom edge: Onshape keeps that box 30px up for its tab list, which zen slides away, so it showed as a dark band. Their own background is the bottom gutter, as it already was on the left.
- Edge reveals (left rail, bottom tabs; the list sidebar's parts, see above) are absolutely positioned, fully off-screen, and sit above Onshape's toolbar (z-index 2000 vs its 1004). Each has an invisible `::after` hanging back on-screen over a 12px gutter, so hovering the gutter hovers the bar and slides it in. (A visible 6px sliver of each bar was tried first; it covered content such as the "F" in Features.) Bars slide in over 320ms; after the pointer leaves they linger 300ms, then slide out over 250ms.
- **The bottom tab list stays out while a tab is in use:** while one of its tabs has Onshape's `.context-menu-active` (its right-click menu is open) or `.renaming` class (`tabStates` in `onshape-dom.ts`). Both take the pointer off the bar, so `:hover` alone slid it away mid-rename. The menu itself is added to `<body>`, so the tab's class is the only sign of which menu it is.
- At rest the edge bars are invisible (opacity 0), not just off-screen; otherwise when the collapse sheet lands they reappear at full opacity and visibly slide away (the "flash").
- List page: the detail pane's column splitter (`.os-splitter` and its placeholder) is hidden, and the list container (absolutely positioned with an inline width) is pinned left/right with 12px padding, giving 24px of space at both window edges.
- The document gutter is *inside* things, not beside them, so backgrounds and lines still reach the window edge: the toolbar gets left padding; the feature panel's outer box runs to the left and bottom edges (bottom border removed, bottom padding added); its inner container's absolutely positioned sections are offset 12px while its section dividers (`.os-splitter`) stay full width. Only the 3D view column has a bottom gutter.
- `.panel-content-pane` matches two nested elements (the outer `.left-content-pane-folder` and the inner `.os-row-splitter-container`); target them separately or the gutter doubles.
- That hover strip shrinks only after the slide (220ms delay). Removing it immediately leaves nothing under the pointer mid-slide, and the bar slides straight back out.
- The list page's folder cards live in a virtual scroller with no height of its own; it gets a 64px minimum (one row).
- List pages differ in structure (Owned by me has welcome and last-opened rows; Shared, Trash, Labels, Public and Teams don't), so zen lays the list splitter out as a flex column: folders pane sized to content, document list takes the rest. Never rewrite its `grid-template` with a fixed row count.
- Collapsing Folders makes Onshape write a fixed `36px` folders row into the inline `grid-template` (`minmax(36px, 40fr)` when expanded). Zen follows it via `[style*="36px 16px"]`: the folders pane is held at 36px and loses its 64px card minimum.
- The 3D view resizes via a real 1px bounds nudge from main, not script.
