# app-menu

**Does** — Builds the app menu (Zenshape, File, Edit, View, Window) for each OS, and the Z's right-click menu that carries it off macOS.

**Why it exists** — Windows and Linux draw no menu bar (the window's title bar is hidden so the strip can hold the window controls), so About, Saved Sign-in…, the Update Available item and the View items were out of reach there. One template feeds both the macOS menu bar and the Z's menu, so the two can't drift.

**Talks to** — `main.ts` (builds the context per menu: the window, app state, the update, the saved sign-in; sets the application menu; hands `appMenu` to the window), `tab-views.ts` (`showStripMenu` calls `stripMenuTemplate`). Pure: Electron types only, tested in `test/app-menu.test.ts`.

**Gotchas**
- `appMenuTemplate(ctx, platform)`: off macOS it drops the roles only macOS implements (`services`, `hide`, `hideOthers`, `unhide`, `zoom`) and the ⌃⌘ accelerators (`Command` there is the Windows/Super key), then removes leading, trailing and doubled separators.
- `stripOwnItems(window)`: the Z menu's own Hide Tab Bar, Zen Mode and Hide Tab Bar in Zen Mode, built by the same function as the View menu's checkboxes, so the two can't drift.
- `stripMenuTemplate(own, app, platform)`: on macOS the Z's own three items; elsewhere those, a separator, then the app menu as submenus without Edit (opened from the strip, Edit would act on the strip; the page handles its own Ctrl+C/V/Z).
- The application menu is still set off macOS, with no bar to show it: it's what makes Ctrl+T, Ctrl+W, Ctrl+1–9, Ctrl+Tab, Ctrl+R, Ctrl+[ ] and Ctrl+Alt+I work there. The smoke test's step h checks Ctrl+T on both.
- Quit is Electron's `quit` role, which Windows labels "Exit".
- Both are rebuilt each time (every tab change for the bar, every popup for the Z), so checkboxes, Forget Saved Sign-in's enabled state and the Update Available item read the current state.
