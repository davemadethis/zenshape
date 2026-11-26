import type { MenuItemConstructorOptions } from 'electron';
import type { ZenshapeWindow } from './tab-views';
import type { Update } from './updates';

type Item = MenuItemConstructorOptions;
type MenuWindow = Pick<
  ZenshapeWindow,
  | 'isZen'
  | 'setZen'
  | 'hidesStripInZen'
  | 'setHideStripInZen'
  | 'isCollapsed'
  | 'setCollapsed'
  | 'activeContents'
  | 'goBack'
  | 'goForward'
  | 'newTab'
  | 'closeTab'
  | 'cycleTab'
  | 'selectNumber'
>;

// What the menu shows and does; main builds a fresh one per menu, so it
// reads the state of that moment.
export interface AppMenuContext {
  appName: string;
  window: () => MenuWindow | null;
  // Opens a window first if there's none (macOS runs without one).
  showSplash: (mode: 'about' | 'saved-sign-in') => void;
  newTab: () => void;
  update: Update | null;
  openUpdate: (url: string) => void;
  signInSaved: boolean;
  forgetSignIn: () => void;
  restoreAllTabs: boolean;
  setRestoreAllTabs: (on: boolean) => void;
  // What the View checkboxes show while no window is open.
  saved: { zen: boolean; hideStripInZen: boolean; stripCollapsed: boolean };
}

// Roles only macOS implements; elsewhere they'd be dead items at best.
const MAC_ONLY_ROLES = new Set<Item['role']>([
  'services',
  'hide',
  'hideOthers',
  'unhide',
  'zoom',
]);

// Off macOS `Command` is the Windows/Super key, which these shortcuts were
// never meant to use; CmdOrCtrl becomes Ctrl and stays.
const MAC_ONLY_ACCELERATOR = /(^|\+)(Command|Cmd)(\+|$)/;

export function appMenuTemplate(
  ctx: AppMenuContext,
  platform: NodeJS.Platform = process.platform,
): Item[] {
  const win = ctx.window();
  const withWindow = (fn: (w: MenuWindow) => void) => () => {
    const w = ctx.window();
    if (w) fn(w);
  };
  const view = viewToggles(
    {
      zen: win?.isZen ?? ctx.saved.zen,
      hideStripInZen: win?.hidesStripInZen ?? ctx.saved.hideStripInZen,
      stripCollapsed: win?.isCollapsed ?? ctx.saved.stripCollapsed,
    },
    withWindow,
  );
  const available = ctx.update;
  const tabNumbers: Item[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    label: n === 9 ? 'Last Tab' : `Tab ${n}`,
    accelerator: `CmdOrCtrl+${n}`,
    click: withWindow((w) => w.selectNumber(n)),
  }));

  const template: Item[] = [
    {
      label: ctx.appName,
      submenu: [
        // Our own view, not the native panel: Windows has none, and this
        // carries the disclaimer with the logo on every OS.
        {
          label: `About ${ctx.appName}`,
          click: () => ctx.showSplash('about'),
        },
        ...(available
          ? [
              {
                label: `Update Available (${available.version})…`,
                click: () => ctx.openUpdate(available.url),
              },
            ]
          : []),
        { type: 'separator' },
        {
          label: 'Saved Sign-in…',
          click: () => ctx.showSplash('saved-sign-in'),
        },
        {
          label: 'Forget Saved Sign-in',
          enabled: ctx.signInSaved,
          click: () => ctx.forgetSignIn(),
        },
        { type: 'separator' },
        {
          label: 'Restore All Tabs on Launch',
          type: 'checkbox',
          checked: ctx.restoreAllTabs,
          click: (item) => ctx.setRestoreAllTabs(item.checked),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => ctx.newTab(),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: withWindow((w) => w.closeTab()),
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        view.zen,
        view.hideInZen,
        view.hide,
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: withWindow((w) => w.activeContents?.reload()),
        },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: withWindow((w) => w.goBack()),
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: withWindow((w) => w.goForward()),
        },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: withWindow((w) => w.activeContents?.toggleDevTools()),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: 'Ctrl+Tab',
          click: withWindow((w) => w.cycleTab(1)),
        },
        {
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          click: withWindow((w) => w.cycleTab(-1)),
        },
        { type: 'separator' },
        ...tabNumbers,
      ],
    },
  ];
  return forPlatform(template, platform);
}

// The View menu's tab-bar and zen checkboxes, which the Z's menu also opens
// with: one definition, so the two can't drift.
function viewToggles(
  checked: AppMenuContext['saved'],
  act: (fn: (w: MenuWindow) => void) => () => void,
): Record<'zen' | 'hideInZen' | 'hide', Item> {
  return {
    zen: {
      label: 'Zen Mode',
      type: 'checkbox',
      checked: checked.zen,
      accelerator: 'Ctrl+Command+Z',
      click: act((w) => void w.setZen(!w.isZen)),
    },
    hideInZen: {
      label: 'Hide Tab Bar in Zen Mode',
      type: 'checkbox',
      checked: checked.hideStripInZen,
      click: act((w) => w.setHideStripInZen(!w.hidesStripInZen)),
    },
    hide: {
      label: 'Hide Tab Bar',
      type: 'checkbox',
      checked: checked.stripCollapsed,
      accelerator: 'Ctrl+Command+B',
      click: act((w) => w.setCollapsed(!w.isCollapsed)),
    },
  };
}

// The Z menu's own items, for the window it was opened in.
export function stripOwnItems(w: MenuWindow): Item[] {
  const t = viewToggles(
    {
      zen: w.isZen,
      hideStripInZen: w.hidesStripInZen,
      stripCollapsed: w.isCollapsed,
    },
    (fn) => () => fn(w),
  );
  return [t.hide, { type: 'separator' }, t.zen, t.hideInZen];
}

// The Z's right-click menu: its own items, then (off macOS, where there's no
// menu bar to reach) the app menu. Edit is left out: opened from the strip,
// its items would act on the strip, and the page handles its own shortcuts.
export function stripMenuTemplate(
  own: Item[],
  app: Item[],
  platform: NodeJS.Platform = process.platform,
): Item[] {
  if (platform === 'darwin') return own;
  return forPlatform(
    [
      ...own,
      { type: 'separator' },
      ...app.filter((m) => m.role !== 'editMenu'),
    ],
    platform,
  );
}

function forPlatform(items: Item[], platform: NodeJS.Platform): Item[] {
  if (platform === 'darwin') return items;
  const kept = items
    .filter((m) => !MAC_ONLY_ROLES.has(m.role))
    .map((m) => {
      const out: Item = { ...m };
      if (out.accelerator && MAC_ONLY_ACCELERATOR.test(out.accelerator)) {
        delete out.accelerator;
      }
      if (Array.isArray(out.submenu)) {
        out.submenu = forPlatform(out.submenu, platform);
      }
      return out;
    });
  return tidySeparators(kept);
}

function tidySeparators(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const m of items) {
    const isSep = m.type === 'separator';
    if (isSep && (out.length === 0 || out.at(-1)!.type === 'separator')) {
      continue;
    }
    out.push(m);
  }
  while (out.at(-1)?.type === 'separator') out.pop();
  return out;
}
