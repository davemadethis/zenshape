import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  class FakeBaseWindow {
    listeners: Record<string, Listener[]> = {};
    children: FakeView[] = [];
    closed = false;
    contentView = {
      addChildView: (v: FakeView) => this.children.push(v),
      removeChildView: (v: FakeView) => {
        this.children = this.children.filter((c) => c !== v);
      },
    };
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
    getContentBounds = () => ({ x: 0, y: 0, width: 1200, height: 800 });
    isFullScreen = () => false;
    isMinimized = () => false;
  }

  return { FakeContents, FakeView, FakeBaseWindow };
});

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0' },
  BaseWindow: h.FakeBaseWindow,
  WebContentsView: h.FakeView,
  Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
  clipboard: { writeText: () => {} },
  ipcMain: { on: () => {}, off: () => {} },
  screen: { on: () => {}, off: () => {}, getCursorScreenPoint: () => ({}) },
  shell: { openExternal: () => {} },
}));

import { ZenshapeWindow } from '../src/tab-views';
import { SavedSignIn } from '../src/saved-sign-in';

type View = InstanceType<typeof h.FakeView>;
type Contents = InstanceType<typeof h.FakeContents>;
type Win = InstanceType<typeof h.FakeBaseWindow>;

const URL_A = 'https://cad.onshape.com/documents/a';
const URL_B = 'https://cad.onshape.com/documents/b';
const URL_C = 'https://cad.onshape.com/documents/c';

function open(urls: string[]) {
  const win = new ZenshapeWindow({
    bounds: { width: 1200, height: 800 },
    maximized: false,
    restore: {
      tabs: urls.map((url) => ({ url, title: url, pinned: false })),
      activeIndex: 0,
    },
    collapsed: false,
    zen: false,
    hideStripInZen: false,
    preload: '/preload.cjs',
    loadStrip: () => {},
    onChange: () => {},
    savedSignIn: new SavedSignIn('/nonexistent/saved-sign-in.json', {
      isAsyncEncryptionAvailable: () => Promise.resolve(false),
      encryptStringAsync: () => Promise.reject(new Error('unused')),
      decryptStringAsync: () => Promise.reject(new Error('unused')),
    }),
    notify: () => {},
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
  return { win, base, page, state, idOf };
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
