import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  appMenuTemplate,
  stripMenuTemplate,
  stripOwnItems,
  type AppMenuContext,
} from '../src/app-menu';

type Item = MenuItemConstructorOptions;

const ctx = (over: Partial<AppMenuContext> = {}): AppMenuContext => ({
  appName: 'Zenshape',
  window: () => null,
  showSplash: vi.fn(),
  newTab: vi.fn(),
  update: null,
  openUpdate: vi.fn(),
  signInSaved: false,
  forgetSignIn: vi.fn(),
  restoreAllTabs: false,
  setRestoreAllTabs: vi.fn(),
  saved: { zen: false, hideStripInZen: false, stripCollapsed: false },
  ...over,
});

const MAC_ROLES = ['services', 'hide', 'hideOthers', 'unhide', 'zoom'];
const TOP = ['Zenshape', 'File', 'Edit', 'View', 'Window'];

const name = (m: Item) => m.label ?? (m.role === 'editMenu' ? 'Edit' : m.role);
const all = (items: Item[]): Item[] =>
  items.flatMap((m) => [
    m,
    ...(Array.isArray(m.submenu) ? all(m.submenu) : []),
  ]);
const roles = (items: Item[]) => all(items).map((m) => m.role);
const sub = (items: Item[], label: string) =>
  items.find((m) => m.label === label)!.submenu as Item[];
const lists = (items: Item[]): Item[][] => [
  items,
  ...items.flatMap((m) => (Array.isArray(m.submenu) ? lists(m.submenu) : [])),
];

const own: Item[] = [
  { label: 'Hide Tab Bar', accelerator: 'Ctrl+Command+B' },
  { type: 'separator' },
  { label: 'Zen Mode', accelerator: 'Ctrl+Command+Z' },
  { label: 'Hide Tab Bar in Zen Mode' },
];

describe('the app menu', () => {
  it('on macOS: Zenshape, File, Edit, View, Window, with the Mac roles', () => {
    const t = appMenuTemplate(ctx(), 'darwin');
    expect(t.map(name)).toEqual(TOP);
    for (const r of MAC_ROLES) expect(roles(t)).toContain(r);
    const view = sub(t, 'View');
    expect(view.find((m) => m.label === 'Zen Mode')!.accelerator).toBe(
      'Ctrl+Command+Z',
    );
  });

  for (const platform of ['win32', 'linux'] as const) {
    it(`on ${platform}: the same menus, no Mac roles or ⌃⌘ shortcuts, tidy separators`, () => {
      const t = appMenuTemplate(ctx(), platform);
      expect(t.map(name)).toEqual(TOP);
      for (const r of MAC_ROLES) expect(roles(t)).not.toContain(r);
      for (const m of all(t)) {
        expect(m.accelerator ?? '').not.toMatch(/Command/);
      }
      expect(
        all(t)
          .map((m) => m.accelerator)
          .filter(Boolean),
      ).toContain('CmdOrCtrl+T');
      for (const list of lists(t)) {
        const seps = list.map((m) => m.type === 'separator');
        expect(seps[0]).not.toBe(true);
        expect(seps.at(-1)).not.toBe(true);
        expect(seps.some((s, i) => s && seps[i + 1])).toBe(false);
      }
    });
  }

  it('Update Available appears only with an update', () => {
    const labels = (c: AppMenuContext) =>
      sub(appMenuTemplate(c, 'win32'), 'Zenshape').map((m) => m.label);
    expect(labels(ctx()).some((l) => l?.startsWith('Update'))).toBe(false);
    const openUpdate = vi.fn();
    const withUpdate = sub(
      appMenuTemplate(
        ctx({ update: { version: '9.9.9', url: 'https://x/' }, openUpdate }),
        'win32',
      ),
      'Zenshape',
    );
    const item = withUpdate.find(
      (m) => m.label === 'Update Available (9.9.9)…',
    )!;
    expect(item).toBeDefined();
    (item.click as () => void)();
    expect(openUpdate).toHaveBeenCalledWith('https://x/');
  });
});

describe('the Z menu', () => {
  it('on macOS is its own three items', () => {
    const app = appMenuTemplate(ctx(), 'darwin');
    expect(stripMenuTemplate(own, app, 'darwin')).toBe(own);
  });

  for (const platform of ['win32', 'linux'] as const) {
    it(`on ${platform} is its own items, a separator, then the app menu without Edit`, () => {
      const app = appMenuTemplate(ctx(), platform);
      const t = stripMenuTemplate(own, app, platform);
      expect(t.map((m) => m.label ?? m.type)).toEqual([
        'Hide Tab Bar',
        'separator',
        'Zen Mode',
        'Hide Tab Bar in Zen Mode',
        'separator',
        'Zenshape',
        'File',
        'View',
        'Window',
      ]);
      // ⌃⌘ is macOS's; here it'd print a Ctrl+Win shortcut.
      expect(t.slice(0, 4).every((m) => !m.accelerator)).toBe(true);
      const zs = sub(t, 'Zenshape').map((m) => m.label);
      expect(zs).toContain('About Zenshape');
      expect(zs).toContain('Saved Sign-in…');
      expect(zs).toContain('Forget Saved Sign-in');
    });
  }

  it('Forget Saved Sign-in is enabled only with a saved sign-in', () => {
    const forget = (signInSaved: boolean) =>
      sub(
        stripMenuTemplate(
          own,
          appMenuTemplate(ctx({ signInSaved }), 'win32'),
          'win32',
        ),
        'Zenshape',
      ).find((m) => m.label === 'Forget Saved Sign-in')!.enabled;
    expect(forget(false)).toBe(false);
    expect(forget(true)).toBe(true);
  });

  it('Saved Sign-in… shows the sign-in page', () => {
    const showSplash = vi.fn();
    const t = stripMenuTemplate(
      own,
      appMenuTemplate(ctx({ showSplash }), 'win32'),
      'win32',
    );
    const item = sub(t, 'Zenshape').find((m) => m.label === 'Saved Sign-in…')!;
    (item.click as () => void)();
    expect(showSplash).toHaveBeenCalledWith('saved-sign-in');
  });
});

describe("the Z menu's own items", () => {
  const win = {
    isZen: true,
    hidesStripInZen: false,
    isCollapsed: true,
    setZen: vi.fn(),
    setHideStripInZen: vi.fn(),
    setCollapsed: vi.fn(),
  };
  const w = win as unknown as Parameters<typeof stripOwnItems>[0];

  it('are the View menu’s checkboxes, read from the window', () => {
    const items = stripOwnItems(w);
    expect(items.map((m) => m.label ?? m.type)).toEqual([
      'Hide Tab Bar',
      'separator',
      'Zen Mode',
      'Hide Tab Bar in Zen Mode',
    ]);
    expect(items.map((m) => m.checked)).toEqual([true, undefined, true, false]);
    const view = sub(
      appMenuTemplate(ctx({ window: () => w }), 'darwin'),
      'View',
    );
    for (const m of items.filter((m) => m.label)) {
      const twin = view.find((v) => v.label === m.label)!;
      expect({ ...m, click: undefined }).toEqual({ ...twin, click: undefined });
    }
  });

  it('act on that window', () => {
    const items = stripOwnItems(w);
    for (const m of items) (m.click as (() => void) | undefined)?.();
    expect(win.setCollapsed).toHaveBeenCalledWith(false);
    expect(win.setZen).toHaveBeenCalledWith(false);
    expect(win.setHideStripInZen).toHaveBeenCalledWith(true);
  });
});
