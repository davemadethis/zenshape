import { beforeAll, describe, expect, it, vi } from 'vitest';

// Probes for the sign-in fill's races, against a fake
// Electron with fake timers to fix each race's order. Each asserts the safe
// outcome, and each failed before its fix. Probes for the click fill and the
// File menu fill went with those fills.
const h = vi.hoisted(() => {
  type Prefs = Record<string, unknown>;
  type Listener = (...args: unknown[]) => void;
  type OpenHandler = (d: { url: string }) => {
    action: string;
    overrideBrowserWindowOptions?: { webPreferences?: Prefs };
    createWindow?: (o: {
      webPreferences?: Prefs;
      webContents?: unknown;
    }) => unknown;
  };

  const views: Array<{
    opts: { webPreferences?: Prefs; webContents?: unknown };
    view: FakeView;
  }> = [];
  const appListeners: Record<string, Listener> = {};
  const windows: FakeBaseWindow[] = [];
  // Plain records, like FakeBaseWindow's buttons: they outlive mock resets.
  const signIn = {
    files: new Map<string, string>(),
    notices: [] as string[],
    crypto: [] as string[],
    commands: [] as Array<(e: unknown, c: unknown) => void>,
    focus: null as unknown,
    // Probe hooks: run during each decrypt, and how long a decrypt takes.
    onDecrypt: null as null | (() => void),
    decryptMs: 0,
    // How long each DevTools-protocol call takes (0 = at once).
    cdpMs: 0,
    // Typing lands in the focused field's value, as in a real page.
    liveValue: false,
    menu: [] as Array<{
      label?: string;
      submenu?: unknown;
      click?: () => void;
    }>,
  };

  class FakeContents {
    listeners: Record<string, Listener[]> = {};
    openHandler?: OpenHandler;
    loaded: string[] = [];
    on(event: string, fn: Listener) {
      (this.listeners[event] ??= []).push(fn);
    }
    off(event: string, fn: Listener) {
      this.listeners[event] = (this.listeners[event] ?? []).filter(
        (f) => f !== fn,
      );
    }
    // Plain records: attach/detach history and every protocol method sent.
    debugger = {
      attached: false,
      history: [] as string[],
      methods: [] as string[],
      attach: () => {
        this.debugger.attached = true;
        this.debugger.history.push('attach');
      },
      detach: () => {
        this.debugger.attached = false;
        this.debugger.history.push('detach');
      },
      isAttached: () => this.debugger.attached,
      on: () => {},
      off: () => {},
      // The page's focused input, as the protocol would report it.
      focused: null as { attrs: string[]; value: string } | null,
      // The live text of the page's email input (node 8), if it has one.
      emailValue: null as string | null,
      sendCommand: (
        method: string,
        params?: { selector?: string; nodeId?: number },
      ): Promise<unknown> => {
        // The page answers as the request arrives; the answer takes cdpMs back.
        if (h.signIn.cdpMs) {
          const answer = this.debugger.answer(method, params);
          return new Promise((r) => setTimeout(r, h.signIn.cdpMs)).then(
            () => answer,
          );
        }
        return this.debugger.answer(method, params);
      },
      answer: (
        method: string,
        params?: { selector?: string; nodeId?: number },
      ): Promise<unknown> => {
        this.debugger.methods.push(method);
        const f = this.debugger.focused;
        switch (method) {
          case 'DOM.getDocument':
            return Promise.resolve({ root: { nodeId: 1 } });
          // As in Chromium: `:focus` matches only in the focused view.
          case 'DOM.querySelector':
            if (params?.selector !== 'input:focus')
              return Promise.resolve({
                nodeId: this.debugger.emailValue === null ? 0 : 8,
              });
            return Promise.resolve({ nodeId: f && this.isFocused() ? 7 : 0 });
          case 'DOM.querySelectorAll':
            return Promise.resolve({
              nodeIds: this.debugger.emailValue === null ? [] : [8],
            });
          case 'DOM.getAttributes':
            return Promise.resolve({ attributes: f!.attrs });
          case 'Accessibility.getPartialAXTree':
            return Promise.resolve({
              nodes: [
                {
                  value: {
                    value:
                      params?.nodeId === 8
                        ? this.debugger.emailValue
                        : f!.value,
                  },
                },
              ],
            });
          default:
            return Promise.reject(new Error(method));
        }
      },
    };
    once(event: string, fn: Listener) {
      this.on(event, fn);
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners[event] ?? []) fn(...args);
    }
    setWindowOpenHandler(fn: OpenHandler) {
      this.openHandler = fn;
    }
    loadURL(url: string) {
      this.loaded.push(url);
      return Promise.resolve();
    }
    loadFile(file: string) {
      this.loaded.push(`file:${file}`);
      return Promise.resolve();
    }
    isDestroyed = () => false;
    isLoading = () => false;
    getURL = () => '';
    getTitle = () => '';
    navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
    };
    send = vi.fn();
    close = vi.fn();
    typed: string[] = [];
    // One view in the app has focus at a time, as in Electron.
    isFocused = () => h.signIn.focus === this;
    focus = () => {
      h.signIn.focus = this;
    };
    insertText = (text: string) => {
      this.typed.push(text);
      if (h.signIn.liveValue && this.debugger.focused)
        this.debugger.focused.value += text;
      return Promise.resolve();
    };
    // Return as a keyboard sends it; a test can make the page react.
    returns = 0;
    onReturn?: () => void;
    keys = 0;
    sendInputEvent = (e: { type: string; keyCode: string }) => {
      this.keys++;
      if (e.type === 'keyDown' && e.keyCode === 'Return') {
        this.returns++;
        this.onReturn?.();
      }
    };
  }

  class FakeView {
    webContents: FakeContents;
    constructor(opts: { webPreferences?: Prefs; webContents?: FakeContents }) {
      this.webContents = opts.webContents ?? new FakeContents();
      views.push({ opts, view: this });
    }
    setBackgroundColor = vi.fn();
    setBounds = vi.fn();
    setVisible = vi.fn();
  }

  class FakeBaseWindow {
    // Plain records: they outlive the per-test mock resets.
    buttons: unknown[] = [];
    constructor(readonly opts: Record<string, unknown>) {
      windows.push(this);
    }
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
    on = vi.fn();
    maximize = vi.fn();
    // macOS only, as in Electron: the release workflow runs these tests on
    // Windows and Linux too, where an unguarded call crashed the window.
    setWindowButtonVisibility =
      process.platform === 'darwin'
        ? (v: boolean) => this.buttons.push(v)
        : undefined;
    // Windows and Linux only, the same way round.
    setTitleBarOverlay =
      process.platform === 'darwin'
        ? undefined
        : (o: object) => this.buttons.push(o);
    getContentBounds = () => ({ x: 0, y: 0, width: 1200, height: 800 });
    isFullScreen = () => false;
  }

  return {
    views,
    appListeners,
    windows,
    signIn,
    FakeContents,
    FakeView,
    FakeBaseWindow,
  };
});

vi.stubGlobal('STRIP_VITE_DEV_SERVER_URL', undefined);
vi.stubGlobal('STRIP_VITE_NAME', 'strip');
vi.mock('electron-squirrel-startup', () => ({ default: false }));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    setPath: vi.fn(),
    requestSingleInstanceLock: () => true,
    userAgentFallback: 'UA zenshape/0.1.0 Chrome/1 Electron/45.0.0',
    getName: () => 'Zenshape',
    name: 'Zenshape',
    getPath: () => '/nonexistent',
    setAsDefaultProtocolClient: vi.fn(),
    on: (event: string, fn: (...args: unknown[]) => void) => {
      h.appListeners[event] = fn;
    },
    whenReady: () => Promise.resolve(),
    isReady: () => true,
    quit: vi.fn(),
  },
  // Async calls only, recorded; the sync ones would read the key a second
  // time, so they throw here.
  safeStorage: {
    isAsyncEncryptionAvailable: () => {
      h.signIn.crypto.push('available');
      return Promise.resolve(true);
    },
    encryptStringAsync: (s: string) => {
      h.signIn.crypto.push('encrypt');
      return Promise.resolve(Buffer.from(`enc:${s}`));
    },
    decryptStringAsync: (b: Buffer) => {
      h.signIn.crypto.push('decrypt');
      h.signIn.onDecrypt?.();
      const out = { result: b.toString().slice(4) };
      return h.signIn.decryptMs
        ? new Promise((r) => setTimeout(() => r(out), h.signIn.decryptMs))
        : Promise.resolve(out);
    },
    isEncryptionAvailable: () => {
      throw new Error('sync safeStorage');
    },
    encryptString: () => {
      throw new Error('sync safeStorage');
    },
    decryptString: () => {
      throw new Error('sync safeStorage');
    },
  },
  BaseWindow: h.FakeBaseWindow,
  WebContentsView: h.FakeView,
  Menu: {
    buildFromTemplate: (template: typeof h.signIn.menu) => {
      h.signIn.menu = template;
      return { popup: vi.fn() };
    },
    setApplicationMenu: vi.fn(),
  },
  ipcMain: {
    on: (channel: string, fn: (e: unknown, c: unknown) => void) => {
      if (channel === 'zenshape:strip-command') h.signIn.commands.push(fn);
    },
    off: vi.fn(),
  },
  screen: { getAllDisplays: () => [], on: vi.fn(), off: vi.fn() },
  session: {
    fromPartition: () => ({
      getUserAgent: () => 'UA',
      setUserAgent: vi.fn(),
      on: vi.fn(),
      cookies: { on: vi.fn(), set: vi.fn(), flushStore: vi.fn() },
    }),
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  dialog: {
    showMessageBox: (_win: unknown, o: { message: string }) => {
      h.signIn.notices.push(o.message);
      return Promise.resolve({ response: 0 });
    },
  },
}));
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  // Keep saves off the real disk; reads of /nonexistent already fail.
  return {
    default: {
      ...real,
      // The saved sign-in lives in memory; everything else is dropped.
      writeFileSync: (f: string, data: string) => {
        if (String(f).includes('saved-sign-in')) h.signIn.files.set(f, data);
      },
      renameSync: (from: string, to: string) => {
        const data = h.signIn.files.get(from);
        if (data === undefined) return;
        h.signIn.files.delete(from);
        h.signIn.files.set(to, data);
      },
      existsSync: (f: string) => h.signIn.files.has(f) || real.existsSync(f),
      readFileSync: ((f: string, ...rest: unknown[]) =>
        h.signIn.files.get(f) ??
        (real.readFileSync as (...a: unknown[]) => unknown)(
          f,
          ...rest,
        )) as typeof real.readFileSync,
      rmSync: (f: string) => void h.signIn.files.delete(f),
      mkdirSync: vi.fn(),
    },
  };
});

const SECURE = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};

const isStrip = (prefs?: Record<string, unknown>) =>
  prefs?.preload !== undefined;

// --- Probes: each asserts the safe outcome, so a
// failure shows what today's code does. Fake timers fix each race's order.
import { TIMING } from '../src/sign-in-sequence';

describe('probes', () => {
  const SIGN_IN = 'https://cad.onshape.com/signin';
  const SSO = 'https://acme.okta.example/login';
  const EMAIL = 'fake-user@example.test';
  const PASSWORD = 'fake-password-1';
  const OTHER = 'someone-else@example.test';
  const EMAIL_FIELD = ['type', 'text', 'name', 'username'];
  const PASSWORD_FIELD = ['type', 'password', 'name', 'password'];
  const enc = (s: string) => Buffer.from(`enc:${s}`).toString('base64');
  const adv = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const ours = () => h.views.filter((v) => isStrip(v.opts.webPreferences));
  const splash = () => ours()[3].view.webContents;
  const send = (sender: unknown, cmd: unknown) => {
    for (const fn of h.signIn.commands) fn({ sender }, cmd);
  };
  const item = (label: string) => {
    for (const top of h.signIn.menu) {
      const found = (top.submenu as typeof h.signIn.menu | undefined)?.find(
        (i) => i.label === label,
      );
      if (found) return found;
    }
    throw new Error(`no menu item ${label}`);
  };
  let page: InstanceType<typeof h.FakeContents>;
  // When the current watch attached: ticks fire every 250 ms from here.
  let t0 = 0;

  // A fresh watch of the sign-in page (off Onshape and back), so each probe
  // starts with nothing filled and a known point in the tick.
  const fresh = async () => {
    page.getURL = () => SSO;
    page.emit('did-navigate');
    page.debugger.focused = null;
    page.debugger.emailValue = null;
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    t0 = Date.now();
    page.focus();
  };
  // Advance to just after the next tick, so a click lands well before the
  // one after it.
  const justAfterTick = async () => {
    const since = (Date.now() - t0) % 250;
    await adv(250 - since + 5);
  };
  const click = () =>
    page.emit('input-event', {}, { type: 'mouseUp', button: 'left' });
  const key = (keyCode: string) => {
    for (const type of ['rawKeyDown', 'keyDown', 'char', 'keyUp'])
      page.emit('input-event', {}, { type, keyCode });
    page.emit('before-input-event', {}, { type: 'keyDown', key: keyCode });
  };

  beforeAll(async () => {
    vi.useFakeTimers();
    h.signIn.files.set(
      '/nonexistent/saved-sign-in.json',
      JSON.stringify({ email: enc(EMAIL), password: enc(PASSWORD) }),
    );
    await import('../src/main');
    await adv(3000);
    item('New Tab').click!();
    page = h.views.at(-1)!.view.webContents;
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    await adv(10);
  });

  it('a stopped run, then another account: no password, no Return', async () => {
    await fresh();
    TIMING.timeoutMs = 500;
    TIMING.pollMs = 50;
    item('Saved Sign-in…').click!();
    await adv(20);
    page.debugger.emailValue = '';
    page.debugger.focused = { attrs: EMAIL_FIELD, value: '' };
    // Continue shows the password step but doesn't focus it: the run times out.
    page.onReturn = () => {
      if (page.returns === 1 + returns0) {
        page.debugger.emailValue = EMAIL;
        page.debugger.focused = null;
      }
    };
    const returns0 = page.returns;
    send(splash(), { type: 'sign-in', email: EMAIL, password: null });
    await adv(800);
    // Stopped list for 2.5 s, then Onshape's page comes forward.
    await adv(3000);
    page.onReturn = undefined;
    // The user goes back in the page and continues with another account.
    page.debugger.emailValue = OTHER;
    await justAfterTick();
    const typed = page.typed.length;
    const returns = page.returns;
    page.debugger.focused = { attrs: PASSWORD_FIELD, value: '' };
    page.focus();
    click();
    await adv(600);
    TIMING.timeoutMs = 10_000;
    TIMING.pollMs = 150;
    expect({
      typed: page.typed.slice(typed),
      returns: page.returns - returns,
    }).toEqual({ typed: [], returns: 0 });
  });

  it('select-all, paste another email, Return within one tick: no password', async () => {
    await fresh();
    page.debugger.emailValue = '';
    page.debugger.focused = { attrs: EMAIL_FIELD, value: '' };
    await adv(260); // tick: types the saved email
    page.debugger.emailValue = EMAIL;
    page.debugger.focused = { attrs: EMAIL_FIELD, value: EMAIL };
    await justAfterTick(); // tick: samples "matches"
    const typed = page.typed.length;
    key('A'); // ⌘A
    key('V'); // ⌘V
    page.debugger.emailValue = OTHER;
    page.debugger.focused = { attrs: EMAIL_FIELD, value: OTHER };
    key('Return'); // Continue: the email step goes
    page.debugger.emailValue = null;
    page.debugger.focused = { attrs: PASSWORD_FIELD, value: '' };
    await adv(500);
    expect(page.typed.slice(typed)).toEqual([]);
  });

  it('source: only one place in src/ types into or presses keys on a page', async () => {
    const fs = (
      await vi.importActual<{ default: typeof import('node:fs') }>('node:fs')
    ).default;
    const typing: string[] = [];
    const protocolInput: string[] = [];
    for (const f of fs.readdirSync('src', { recursive: true }) as string[]) {
      if (!f.endsWith('.ts')) continue;
      const text = fs.readFileSync(`src/${f}`, 'utf8');
      for (const m of text.matchAll(/\.(insertText|sendInputEvent)\(/g))
        typing.push(`${f} ${m[1]}`);
      // Typing or keys through the DevTools protocol would be a second door.
      for (const m of text.matchAll(/['"`]Input\.\w+/g))
        protocolInput.push(`${f} ${m[0]}`);
    }
    // One insertText, in the fill routine; keys only there too.
    expect({
      insertText: typing.filter((t) => t.endsWith('insertText')),
      keysElsewhere: typing.filter(
        (t) => t.endsWith('sendInputEvent') && !t.startsWith('sign-in-fill.ts'),
      ),
      protocolInput,
    }).toEqual({
      insertText: ['sign-in-fill.ts insertText'],
      keysElsewhere: [],
      protocolInput: [],
    });
    // And the page's protocol calls go through sign-in-focus's allowlist.
    const { ALLOWED_METHODS } = await import('../src/sign-in-focus');
    expect(
      [...ALLOWED_METHODS].filter(
        (m) => !m.startsWith('DOM.') && !m.startsWith('Accessibility.'),
      ),
    ).toEqual([]);
    expect(fs.readFileSync('src/tab-views.ts', 'utf8')).toMatch(
      /send: guard\(/,
    );
  });
});
