# tabs

**Does** — Pure tab-list model (`TabList`) and `tabsToRestore`: open/close/select/cycle/pin ordering, and which saved tabs come back on launch. Also `move` (drag-to-reorder within a group), `rename`, `setLocked`, and `displayName` (custom name, else page title, else URL).

**Why it exists** — Tab ordering rules are easy to get subtly wrong; keeping them free of Electron lets `test/tabs.test.ts` pin them down.

**Talks to** — Used by `tab-views.ts`; `tabsToRestore` by `main.ts`.

**Gotchas**
- Order is always: sign-in tab, pins, the rest. The sign-in tab can't be pinned; `becomeRegular` moves it to the front of the unpinned tabs.
- Pinned tabs come before unpinned ones. Pinning moves a tab to the end of the pins; unpinning moves it to the start of the unpinned tabs.
- ⌘9 is the last tab, not the ninth.
- Closing the active tab activates the tab to its right, else its left.
- A custom name survives page-title changes; renaming to an empty string goes back to the page title. The sign-in tab can't be renamed.
