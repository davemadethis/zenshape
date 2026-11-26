import type { MenuItemConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Electron in which, as in Electron 45, a view's `webContents` reads
// undefined once its contents is destroyed, already inside 'destroyed'.
const h = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeContents {
    listeners: Record<string, Listener[]> = {};
    destroyed = false;
    closes = 0;
    url = '';
    openHandler?: (d: { url: string }) => {
      action: string;
      createWindow?: (o: { webContents?: unknown }) => unknown;
    };
    on(event: string, fn: Listener) {
      (this.listeners[event] ??= []).push(fn);
      return this;
    }
    once(event: string, fn: Listener) {
      return this.on(event, fn);
    }
    off(event: string, fn: Listener) {
      this.listeners[event] = (this.listeners[event] ?? []).filter(
        (f) => f !== fn,
      );
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of [...(this.listeners[event] ?? [])]) fn(...args);
    }
    setWindowOpenHandler(fn: FakeContents['openHandler']) {
      this.openHandler = fn;
    }
    loadURL(url: string) {
      this.url = url;
      return Promise.resolve();
    }
    // Electron destroys the contents after close() returns.
    close() {
      this.closes++;
      queueMicrotask(() => this.destroy());
    }
    // What a page's window.close() (or its opener's w.close()) ends in.
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('destroyed');
    }
    isDestroyed = () => this.destroyed;
    isLoading = () => false;
    isFocused = () => false;
    focus() {}
    getURL = () => this.url;
    getTitle = () => '';
    navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
    };
    insertCSS = () => Promise.resolve('key');
    removeInsertedCSS = () => Promise.resolve();
    send = vi.fn();
    debugger = {
      attach() {},
      detach() {},
      isAttached: () => false,
      on() {},
      off() {},
      sendCommand: () => Promise.resolve({}),
    };
  }

  class FakeView {
    private readonly contents: FakeContents;
    constructor(opts: { webContents?: FakeContents }) {
      this.contents = opts.webContents ?? new FakeContents();
    }
    get webContents(): FakeContents | undefined {
      return this.contents.destroyed ? undefined : this.contents;
    }
    // The test's own handle, which outlives the destroy.
    get page(): FakeContents {
      return this.contents;
    }
    setBackgroundColor() {}
    setBounds() {}
    setVisible() {}
  }

  // As in Electron 45, the window is destroyed before 'closed' fires: from
  // then on its methods throw, while its pages are destroyed only later.
  class FakeBaseWindow {
    listeners: Record<string, Listener[]> = {};
    children: FakeView[] = [];
    closed = false;
    private readonly view = {
      addChildView: (v: FakeView) => this.children.push(v),
      removeChildView: (v: FakeView) => {
        this.children = this.children.filter((c) => c !== v);
      },
    };
    get contentView() {
      return this.alive(this.view);
    }
    private alive<T>(value: T): T {
      if (this.closed) throw new TypeError('Object has been destroyed');
      return value;
    }
    isDestroyed = () => this.closed;
    on(event: string, fn: Listener) {
      (this.listeners[event] ??= []).push(fn);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      for (const fn of this.listeners.closed ?? []) fn();
    }
    maximize() {}
    setWindowButtonVisibility() {}
    setTitleBarOverlay() {}
    getContentBounds = () =>
      this.alive({ x: 0, y: 0, width: 1200, height: 800 });
    isFullScreen = () => this.alive(false);
    isMinimized = () => this.alive(false);
  }

  const openExternal = vi.fn();
  // What the strip's menus popped up, newest last.
  const popups: Array<{ template: unknown[]; callback?: () => void }> = [];
  const ipc: Listener[] = [];
  return {
    FakeContents,
    FakeView,
    FakeBaseWindow,
    openExternal,
    popups,
    ipc,
  };
});

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0' },
  BaseWindow: h.FakeBaseWindow,
  WebContentsView: h.FakeView,
  Menu: {
    buildFromTemplate: (template: unknown[]) => ({
      popup: (o: { callback?: () => void }) =>
        h.popups.push({ template, callback: o.callback }),
    }),
  },
  clipboard: { writeText: () => {} },
  ipcMain: {
    on: (_channel: string, fn: (...args: unknown[]) => void) => h.ipc.push(fn),
    off: (_channel: string, fn: (...args: unknown[]) => void) => {
      const i = h.ipc.indexOf(fn);
      if (i >= 0) h.ipc.splice(i, 1);
    },
  },
  screen: { on: () => {}, off: () => {}, getCursorScreenPoint: () => ({}) },
  shell: { openExternal: h.openExternal },
}));

import { ZenshapeWindow } from '../src/tab-views';
import { SavedSignIn } from '../src/saved-sign-in';

type View = InstanceType<typeof h.FakeView>;
type Contents = InstanceType<typeof h.FakeContents>;
type Win = InstanceType<typeof h.FakeBaseWindow>;

const URL_A = 'https://cad.onshape.com/documents/a';
const URL_B = 'https://cad.onshape.com/documents/b';
const URL_C = 'https://cad.onshape.com/documents/c';

const APP_MENU: MenuItemConstructorOptions[] = [
  { label: 'Zenshape', submenu: [{ role: 'quit' }] },
];

function open(urls: string[], { collapsed = false } = {}) {
  let stripView: unknown;
  const win = new ZenshapeWindow({
    bounds: { width: 1200, height: 800 },
    maximized: false,
    restore: {
      tabs: urls.map((url) => ({ url, title: url, pinned: false })),
      activeIndex: 0,
    },
    collapsed,
    zen: false,
    hideStripInZen: false,
    preload: '/preload.cjs',
    loadStrip: (contents, mode) => {
      if (mode === 'strip') stripView = contents;
    },
    onChange: () => {},
    savedSignIn: new SavedSignIn('/nonexistent/saved-sign-in.json', {
      isAsyncEncryptionAvailable: () => Promise.resolve(false),
      encryptStringAsync: () => Promise.reject(new Error('unused')),
      decryptStringAsync: () => Promise.reject(new Error('unused')),
    }),
    notify: () => {},
    appMenu: () => APP_MENU,
  });
  const base = win.window as unknown as Win;
  // Our own views (strip, divider, overlay, splash) never get Onshape's
  // navigation handlers.
  const page = (url: string) =>
    base.children.find(
      (v) => v.page.listeners['did-navigate'] && v.page.url === url,
    )!.page;
  const strip = base.children.find(
    (v) => !v.page.listeners['did-navigate'] && v.page.send.mock.calls.length,
  )!.page;
  const state = () =>
    strip.send.mock.calls.at(-1)![1] as {
      tabs: Array<{ id: string; title: string; signIn: boolean }>;
      activeId: string | null;
      split: unknown;
    };
  const idOf = (url: string) => state().tabs.find((t) => t.title === url)!.id;
  // As the strip's own page sends it.
  const command = (cmd: unknown) => h.ipc.at(-1)!({ sender: stripView }, cmd);
  return { win, base, page, strip, state, idOf, command };
}

// An Onshape page opens about:blank (adopted as a tab beside it).
function openPopup(opener: Contents): Contents {
  const guest = new h.FakeContents();
  opener.openHandler!({ url: 'about:blank' }).createWindow!({
    webContents: guest,
  });
  return guest;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('a page closing its own tab', () => {
  let errors: unknown[];
  beforeEach(() => {
    errors = [];
  });
  const safely = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      errors.push(e);
    }
  };

  it('an adopted popup closed by its page leaves the strip and the saved tabs, and nothing throws after', async () => {
    const { win, base, page, state } = open([URL_A, URL_B]);
    const a = page(URL_A);
    const guest = openPopup(a);
    expect(win.snapshot().tabs).toHaveLength(3);
    guest.destroy();
    await flush();
    safely(() => a.emit('did-start-loading'));
    expect(errors.map(String)).toEqual([]);
    expect(win.snapshot().tabs.map((t) => t.url)).toEqual([URL_A, URL_B]);
    expect(state().tabs).toHaveLength(2);
    safely(() => win.closeTab(state().tabs[1].id));
    safely(() => base.close());
    expect(errors.map(String)).toEqual([]);
  });

  it('a popup’s close lands on the tab that opened it', async () => {
    const { win, page, state, idOf } = open([URL_A, URL_B]);
    const guest = openPopup(page(URL_A));
    win.selectTab(idOf(URL_B));
    win.selectTab(
      state().tabs.find((t) => t.title !== URL_A && t.title !== URL_B)!.id,
    );
    guest.destroy();
    expect(state().activeId).toBe(idOf(URL_A));
  });

  it('with its opener gone, it lands where Close Tab would', async () => {
    const { win, page, state, idOf } = open([URL_A, URL_B, URL_C]);
    const guest = openPopup(page(URL_A)); // opens right of A
    const popup = state().activeId!;
    win.closeTab(idOf(URL_A));
    await flush();
    win.selectTab(popup);
    guest.destroy();
    // Close Tab picks the tab now in its place: B.
    expect(state().activeId).toBe(idOf(URL_B));
  });

  it('a tab opened normally is closed when its page closes itself', async () => {
    const { win, page, state, idOf } = open([URL_A, URL_B]);
    win.selectTab(idOf(URL_B));
    page(URL_B).destroy();
    expect(state().tabs.map((t) => t.title)).toEqual([URL_A]);
    expect(state().activeId).toBe(idOf(URL_A));
  });

  it('in a split, the split ends', async () => {
    const { win, page, state, idOf } = open([URL_A, URL_B]);
    win.selectTab(idOf(URL_B));
    win.splitOnto(idOf(URL_B), idOf(URL_A));
    expect(state().split).not.toBeNull();
    page(URL_B).destroy();
    expect(state().split).toBeNull();
    expect(state().tabs).toHaveLength(1);
  });

  it('the sign-in tab closing itself clears the sign-in state', async () => {
    const { win, page, state } = open([URL_A, URL_B]);
    const a = page(URL_A);
    a.url = 'https://cad.onshape.com/signin';
    a.emit('did-navigate');
    expect(state().tabs.some((t) => t.signIn)).toBe(true);
    a.destroy();
    expect(state().tabs.some((t) => t.signIn)).toBe(false);
    expect(win.isSigningIn).toBe(false);
    expect(state().tabs).toHaveLength(2);
  });

  it('the last tab closing itself closes the window, as Close Tab does', () => {
    const { base, page } = open([URL_A]);
    page(URL_A).destroy();
    expect(base.closed).toBe(true);
  });

  it('Close Tab, then the destroyed event, closes exactly one tab and calls close() once', async () => {
    const { win, page, state, idOf } = open([URL_A, URL_B, URL_C]);
    const a = page(URL_A);
    win.closeTab(idOf(URL_A));
    await flush();
    expect(a.destroyed).toBe(true);
    expect(a.closes).toBe(1);
    expect(state().tabs.map((t) => t.title)).toEqual([URL_B, URL_C]);
  });

  it('a sign-in move closes one tab only', async () => {
    const { page, state } = open([URL_A, URL_B]);
    const a = page(URL_A);
    a.url = 'https://cad.onshape.com/signin';
    a.emit('did-navigate');
    a.url = URL_A;
    a.emit('did-navigate'); // signed in: the sign-in tab's view is closed
    await flush();
    expect(a.destroyed).toBe(true);
    expect(a.closes).toBe(1);
    expect(
      state()
        .tabs.map((t) => t.title)
        .sort(),
    ).toEqual([URL_A, URL_B]);
    expect(state().tabs.some((t) => t.signIn)).toBe(false);
  });

  it('zen sheets go with the page', () => {
    const { win, page } = open([URL_A, URL_B]);
    const a = page(URL_A);
    const sheets = (win as unknown as { zenSheets: Map<unknown, unknown> })
      .zenSheets;
    expect(sheets.has(a)).toBe(true);
    a.destroy();
    expect(sheets.has(a)).toBe(false);
  });
});

describe('closing the window', () => {
  // The window is gone before 'closed'; its pages die a task later and keep
  // loading until then (seen in Electron 45 with a busy page).
  for (const event of ['did-start-loading', 'did-stop-loading']) {
    it(`a page's ${event} after the window closed throws nothing and pushes nothing`, () => {
      const { base, page, strip } = open([URL_A, URL_B]);
      const a = page(URL_A);
      base.close();
      const pushes = strip.send.mock.calls.length;
      expect(a.destroyed).toBe(false);
      expect(() => a.emit(event)).not.toThrow();
      expect(strip.send.mock.calls.length).toBe(pushes);
    });
  }

  it("a page's navigation off Onshape after the window closed is stopped, and opens nothing", () => {
    const { base, page } = open([URL_A]);
    const a = page(URL_A);
    base.close();
    h.openExternal.mockClear();
    const event = { url: 'https://example.com/', preventDefault: vi.fn() };
    a.emit('will-navigate', event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  // Electron destroys a contents a task after close(); were it ever at once,
  // 'destroyed' would run inside dispose(), on the dead window.
  it('a page destroyed inside the teardown is not treated as closing its own tab', async () => {
    const { win, base, page, idOf } = open([URL_A, URL_B]);
    win.selectTab(idOf(URL_B));
    const a = page(URL_A);
    const b = page(URL_B);
    a.close = () => {
      a.closes++;
      a.destroy();
    };
    const before = win.snapshot();
    expect(() => base.close()).not.toThrow();
    await flush();
    expect([a.closes, b.closes]).toEqual([1, 1]);
    expect([a.destroyed, b.destroyed]).toEqual([true, true]);
    expect(win.snapshot()).toEqual(before);
  });

  it("a page's window.open after the window closed opens no tab", () => {
    const { base, page } = open([URL_A]);
    const a = page(URL_A);
    base.close();
    expect(a.openHandler!({ url: 'about:blank' }).action).toBe('deny');
  });

  it('the pages are closed once each, and the saved tabs stay as they were', async () => {
    const { win, base, page, idOf } = open([URL_A, URL_B]);
    win.selectTab(idOf(URL_B));
    const a = page(URL_A);
    const b = page(URL_B);
    const before = win.snapshot();
    base.close();
    await flush();
    expect([a.closes, b.closes]).toEqual([1, 1]);
    expect([a.destroyed, b.destroyed]).toEqual([true, true]);
    expect(win.snapshot()).toEqual(before);
  });
});

describe("the strip's menu", () => {
  const platform = process.platform;
  const onPlatform = (p: NodeJS.Platform) =>
    Object.defineProperty(process, 'platform', { value: p });
  afterEach(() => onPlatform(platform));
  const labels = (t: unknown[]) =>
    (t as Array<{ label?: string; type?: string }>).map(
      (m) => m.label ?? m.type,
    );

  it('off macOS ends with the app menu', () => {
    onPlatform('win32');
    const { command } = open([URL_A]);
    command({ type: 'strip-menu' });
    expect(labels(h.popups.at(-1)!.template)).toEqual([
      'Hide Tab Bar',
      'separator',
      'Zen Mode',
      'Hide Tab Bar in Zen Mode',
      'separator',
      'Zenshape',
    ]);
  });

  it('on macOS is its three items', () => {
    onPlatform('darwin');
    const { command } = open([URL_A]);
    command({ type: 'strip-menu' });
    expect(labels(h.popups.at(-1)!.template)).toEqual([
      'Hide Tab Bar',
      'separator',
      'Zen Mode',
      'Hide Tab Bar in Zen Mode',
    ]);
  });

  it('with ZENSHAPE_TRACE_MENUS=1 says what it opened with and when it closed', () => {
    onPlatform('win32');
    vi.stubEnv('ZENSHAPE_TRACE_MENUS', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { command } = open([URL_A]);
      command({ type: 'strip-menu' });
      h.popups.at(-1)!.callback!();
      expect(log.mock.calls.map((c) => c[0])).toEqual([
        'strip menu: opened: Hide Tab Bar | - | Zen Mode | Hide Tab Bar in Zen Mode | - | Zenshape',
        expect.stringMatching(/^strip menu: closed after \d+ ms$/),
      ]);
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('says nothing without it', () => {
    onPlatform('win32');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { command } = open([URL_A]);
      command({ type: 'strip-menu' });
      h.popups.at(-1)!.callback!();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  // Quit from the menu closes the window before the menu's callback runs.
  it('its callback after the window closed throws nothing, with the strip peeked', () => {
    onPlatform('win32');
    const { base, command } = open([URL_A], { collapsed: true });
    command({ type: 'peek' });
    command({ type: 'strip-menu' });
    const { callback } = h.popups.at(-1)!;
    base.close();
    expect(() => callback!()).not.toThrow();
  });
});
