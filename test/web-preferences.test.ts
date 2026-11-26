import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Boots src/main.ts against a fake Electron and records every view it creates.
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
    // The sign-in log's events, and the call stack of each typing or key.
    logs: [] as Array<[string, Record<string, unknown>]>,
    stacks: [] as string[],
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
      ) => {
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
      h.signIn.stacks.push(`insertText ${new Error().stack}`);
      this.typed.push(text);
      // As in a page: text typed into the email input is its value now.
      if (this.debugger.focused?.attrs.includes('username'))
        this.debugger.emailValue = text;
      return Promise.resolve();
    };
    // Return as a keyboard sends it; a test can make the page react.
    returns = 0;
    onReturn?: () => void;
    keys = 0;
    sendInputEvent = (e: { type: string; keyCode: string }) => {
      h.signIn.stacks.push(`key ${new Error().stack}`);
      this.keys++;
      // As in Electron 45: before-input-event fires synchronously for a
      // sent keyDown, before the page has the key.
      if (e.type === 'keyDown' || e.type === 'keyUp')
        this.emit('before-input-event', {}, { type: e.type, key: e.keyCode });
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
    userData: '/nonexistent',
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
vi.mock('../src/sign-in-log', async (orig) => ({
  ...(await orig<typeof import('../src/sign-in-log')>()),
  signInLog: (event: string, details: Record<string, unknown> = {}) => {
    h.signIn.logs.push([event, details]);
  },
}));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.0.0',
    setPath: vi.fn(),
    requestSingleInstanceLock: () => true,
    userAgentFallback: 'UA zenshape/0.1.0 Chrome/1 Electron/45.0.0',
    getName: () => 'Zenshape',
    name: 'Zenshape',
    getPath: () => h.userData,
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
      return Promise.resolve({ result: b.toString().slice(4) });
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

describe('every view is locked down', () => {
  beforeAll(async () => {
    await import('../src/main');
    await new Promise((r) => setTimeout(r, 0));
  });

  it('creates exactly our four views (strip, divider, drop overlay, splash) and at least one Onshape view', () => {
    expect(h.views.filter((v) => isStrip(v.opts.webPreferences))).toHaveLength(
      4,
    );
    expect(
      h.views.filter((v) => !isStrip(v.opts.webPreferences)).length,
    ).toBeGreaterThan(0);
  });

  it('gives every view the secure flags', () => {
    for (const { opts } of h.views)
      expect(opts.webPreferences).toMatchObject(SECURE);
  });

  it('gives Onshape views no preload and the persistent session', () => {
    for (const { opts } of h.views.filter(
      (v) => !isStrip(v.opts.webPreferences),
    )) {
      expect(opts.webPreferences).not.toHaveProperty('preload');
      expect(opts.webPreferences).toMatchObject({
        partition: 'persist:zenshape',
      });
    }
  });

  it('only ever loads our bundled page in our views, and never navigates them', () => {
    for (const { view } of h.views.filter((v) =>
      isStrip(v.opts.webPreferences),
    )) {
      const ours = view.webContents;
      expect(ours.loaded).toEqual([
        // Either separator: CI also runs this on Windows.
        expect.stringMatching(/^file:.*renderer[\\/]strip[\\/]index\.html$/),
      ]);
      const event = { url: 'https://evil.example', preventDefault: vi.fn() };
      ours.emit('will-navigate', event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(
        ours.openHandler?.({ url: 'https://cad.onshape.com' }).action,
      ).toBe('deny');
    }
  });

  it('adopts Onshape window.open pages into tabs with the same lockdown', () => {
    const onshape = h.views.find((v) => !isStrip(v.opts.webPreferences))!.view
      .webContents;
    for (const url of [
      'https://cad.onshape.com/documents/abc',
      'about:blank',
    ]) {
      const res = onshape.openHandler!({ url });
      expect(res.action).toBe('allow');
      expect(res.overrideBrowserWindowOptions?.webPreferences).toMatchObject(
        SECURE,
      );
      expect(
        res.overrideBrowserWindowOptions?.webPreferences,
      ).not.toHaveProperty('preload');

      // Even if Electron hands over options carrying a preload, the tab drops it.
      const guest = new h.FakeContents();
      const before = h.views.length;
      const returned = res.createWindow!({
        webPreferences: { preload: '/evil.js', sandbox: false },
        webContents: guest,
      });
      expect(returned).toBe(guest);
      const adopted = h.views[before];
      expect(adopted.opts.webPreferences).toMatchObject(SECURE);
      expect(adopted.opts.webPreferences?.preload).toBeUndefined();
    }
  });

  it('never opens a tab for other hosts or schemes', () => {
    const onshape = h.views.find((v) => !isStrip(v.opts.webPreferences))!.view
      .webContents;
    for (const url of [
      'https://example.com',
      'https://onshape.com.evil.com',
      'http://cad.onshape.com',
      'file:///etc/passwd',
    ]) {
      expect(onshape.openHandler!({ url }).action).toBe('deny');
    }
  });
});

describe('window controls', () => {
  beforeAll(async () => {
    await import('../src/main');
    await new Promise((r) => setTimeout(r, 0));
  });

  it('macOS: traffic lights, no title bar overlay', async () => {
    const { windowControls } = await import('../src/tab-views');
    const opts = windowControls('darwin');
    expect(opts).not.toHaveProperty('titleBarOverlay');
    expect(opts).toHaveProperty('trafficLightPosition');
  });

  it.each(['win32', 'linux'] as const)(
    '%s: an overlay the strip’s color and height',
    async (platform) => {
      const { windowControls } = await import('../src/tab-views');
      expect(windowControls(platform)).toEqual({
        titleBarOverlay: {
          color: '#1c1c1c',
          symbolColor: '#ffffff',
          height: 36,
        },
      });
    },
  );

  it('the window gets this platform’s controls, shown at full height', () => {
    const win = h.windows[0];
    expect(win).toBeDefined();
    if (process.platform === 'darwin') {
      expect(win.opts).not.toHaveProperty('titleBarOverlay');
      expect(win.buttons.at(-1)).toBe(true);
    } else {
      expect(win.opts).toMatchObject({
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#1c1c1c', height: 36 },
      });
      expect(win.buttons.at(-1)).toEqual({
        height: 36,
        color: '#1c1c1c',
        symbolColor: '#ffffff',
      });
    }
  });
});

describe('saved sign-in', () => {
  const SIGN_IN = 'https://cad.onshape.com/signin';
  const EMAIL = 'fake-user@example.test';
  const PASSWORD = 'fake-password-1';
  // Onshape's own fields, as read from its live sign-in page.
  const EMAIL_FIELD = ['type', 'text', 'name', 'username'];
  const PASSWORD_FIELD = ['type', 'password', 'name', 'password'];

  beforeAll(async () => {
    await import('../src/main');
    await new Promise((r) => setTimeout(r, 0));
  });

  const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  const item = (label: string) => {
    for (const top of h.signIn.menu) {
      const found = (top.submenu as typeof h.signIn.menu | undefined)?.find(
        (i) => i.label === label,
      );
      if (found) return found;
    }
    throw new Error(`no menu item ${label}`);
  };
  const ours = () => h.views.filter((v) => isStrip(v.opts.webPreferences));
  const strip = () => ours()[2].view.webContents;
  const splash = () => ours()[3].view.webContents;
  const splashState = () =>
    (
      splash().send as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)?.[1] as {
      splash: string | null;
      savedSignIn: { email: string | null } | null;
      savedSignInError: string | null;
      signInRun: unknown;
    };
  const send = (sender: unknown, cmd: unknown) => {
    for (const fn of h.signIn.commands) fn({ sender }, cmd);
  };
  const pages = () =>
    h.views
      .filter(
        (v) =>
          !isStrip(v.opts.webPreferences) &&
          v.view.webContents.listeners['did-navigate'],
      )
      .map((v) => v.view.webContents);
  const click = async (
    contents: InstanceType<typeof h.FakeContents>,
    focused: { attrs: string[]; value: string } | null,
    button = 'left',
  ) => {
    contents.debugger.focused = focused;
    // A click into the page gives it focus.
    contents.focus();
    contents.emit('input-event', {}, { type: 'mouseUp', button });
    await settle();
  };
  let page: InstanceType<typeof h.FakeContents>;

  it('nothing saved: the sign-in tab brings Zenshape’s page first, with no key store call', async () => {
    page = pages().at(-1)!;
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    expect(splashState()).toMatchObject({
      splash: 'saved-sign-in',
      savedSignIn: null,
    });
    await click(page, { attrs: EMAIL_FIELD, value: '' });
    expect(page.typed).toEqual([]);
    expect(h.signIn.crypto).toEqual([]);
  });

  it('the debugger is on the sign-in page only, and reads without Runtime', () => {
    expect(page.debugger.attached).toBe(true);
    for (const c of pages())
      if (c !== page) expect(c.debugger.history).toEqual([]);
    expect(page.debugger.methods.some((m) => m.startsWith('Runtime'))).toBe(
      false,
    );
  });

  it('Sign in is accepted only from the splash view; Esc shows Onshape’s page', async () => {
    send(strip(), { type: 'sign-in', email: EMAIL, password: PASSWORD });
    await settle();
    expect(h.signIn.files.size).toBe(0);
    send(splash(), { type: 'dismiss-splash' });
    expect(splashState().splash).toBeNull();
    // A login saved earlier (the fake's ciphertext), for the click fill.
    const enc = (s: string) => Buffer.from(`enc:${s}`).toString('base64');
    h.signIn.files.set(
      // As main.ts's userFile joins it: with \ on Windows.
      path.join(h.userData, 'saved-sign-in.json'),
      JSON.stringify({ email: enc(EMAIL), password: enc(PASSWORD) }),
    );
  });

  // With a login saved and Onshape's page showing, the fill happens as each
  // field takes focus: `focusOn` puts focus there, as Onshape or a click would.
  const focusOn = async (
    contents: InstanceType<typeof h.FakeContents>,
    focused: { attrs: string[]; value: string } | null,
  ) => {
    contents.debugger.focused = focused;
    contents.focus();
    await settle(400);
  };

  it('Onshape’s page: the empty email field taking focus gets the email, once', async () => {
    await focusOn(page, { attrs: EMAIL_FIELD, value: '' });
    expect(page.typed).toEqual([EMAIL]);
    await focusOn(page, { attrs: EMAIL_FIELD, value: '' });
    expect(page.typed).toEqual([EMAIL]);
  });

  it('types nothing into a field with text, another field, or no field', async () => {
    await focusOn(page, { attrs: PASSWORD_FIELD, value: '•••' });
    await focusOn(page, {
      attrs: ['type', 'text', 'name', 'company'],
      value: '',
    });
    await focusOn(page, null);
    expect(page.typed).toEqual([EMAIL]);
  });

  it('off Onshape (a redirect to an SSO provider) the debugger detaches and nothing is typed', async () => {
    page.getURL = () => 'https://acme.okta.example/login';
    page.emit('did-navigate');
    expect(page.debugger.history).toEqual(['attach', 'detach']);
    page.debugger.emailValue = EMAIL;
    await focusOn(page, { attrs: PASSWORD_FIELD, value: '' });
    expect(page.typed).toEqual([EMAIL]);
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    expect(page.debugger.history).toEqual(['attach', 'detach', 'attach']);
  });

  it('a URL change with no navigate event types nothing', async () => {
    page.getURL = () => 'https://acme.okta.example/login';
    await focusOn(page, { attrs: EMAIL_FIELD, value: '' });
    page.getURL = () => SIGN_IN;
    expect(page.typed).toEqual([EMAIL]);
  });

  it('the empty password field, with the saved email on the page, gets the password; nothing reaches other views', async () => {
    page.debugger.emailValue = EMAIL;
    await focusOn(page, { attrs: EMAIL_FIELD, value: EMAIL });
    await focusOn(page, { attrs: PASSWORD_FIELD, value: '' });
    expect(page.typed.slice(-1)).toEqual([PASSWORD]);
    for (const v of h.views)
      if (v.view.webContents !== page)
        expect(v.view.webContents.typed).toEqual([]);
  });

  it('never shows the login in a notice, and never uses the sync key reads', () => {
    for (const n of h.signIn.notices) {
      expect(n).not.toContain(EMAIL);
      expect(n).not.toContain(PASSWORD);
    }
    expect(h.signIn.crypto.length).toBeGreaterThan(0);
  });

  it('no File menu fill and no click fill', async () => {
    expect(() => item('Fill Saved Email')).toThrow();
    expect(() => item('Fill Saved Password')).toThrow();
    const typed = page.typed.length;
    page.getURL = () => 'https://acme.okta.example/login';
    page.emit('did-navigate');
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    // A click with the automatic fill held off by an unreadable account
    // types nothing: a click is no trigger.
    page.debugger.emailValue = null;
    page.debugger.focused = { attrs: PASSWORD_FIELD, value: '' };
    page.focus();
    page.emit('input-event', {}, { type: 'mouseUp', button: 'left' });
    await settle(400);
    expect(page.typed.length).toBe(typed);
  });

  it('signed in: the debugger detaches', () => {
    const before = page.debugger.history.length;
    page.getURL = () => 'https://cad.onshape.com/documents';
    page.emit('did-navigate');
    expect(page.debugger.history.slice(before)).toEqual(['detach']);
  });

  it('Forget deletes the file', async () => {
    item('Forget Saved Sign-in').click!();
    expect(h.signIn.files.size).toBe(0);
  });
});

describe('the Sign in button', () => {
  const SIGN_IN = 'https://cad.onshape.com/signin';
  const EMAIL = 'fake-user@example.test';
  const PASSWORD = 'fake-password-1';
  const EMAIL_FIELD = ['type', 'text', 'name', 'username'];
  const PASSWORD_FIELD = ['type', 'password', 'name', 'password'];
  const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  const ours = () => h.views.filter((v) => isStrip(v.opts.webPreferences));
  const splash = () => ours()[3].view.webContents;
  const splashState = () =>
    (
      splash().send as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)?.[1] as {
      splash: string | null;
      savedSignIn: { email: string | null } | null;
      savedSignInError: string | null;
      signInRun: unknown;
    };
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
  const stripTabs = () =>
    (
      (
        ours()[2].view.webContents.send as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls.at(-1)?.[1] as
        | { tabs: Array<{ signIn: boolean }> }
        | undefined
    )?.tabs ?? [];
  let page: InstanceType<typeof h.FakeContents>;

  it('a new sign-in shows Zenshape’s page; nothing saved, no password: refused, no key-store call', async () => {
    item('New Tab').click!();
    page = h.views.at(-1)!.view.webContents;
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    expect(splashState()).toMatchObject({
      splash: 'saved-sign-in',
      savedSignIn: null,
    });
    h.signIn.crypto.length = 0;
    send(splash(), { type: 'sign-in', email: EMAIL, password: null });
    await settle();
    expect(splashState().savedSignInError).toMatch(/password/);
    expect(h.signIn.crypto).toEqual([]);
    expect(page.typed).toEqual([]);
  });

  it('saves, then keeps Zenshape’s page in front, ticking off each step, and shows the signed-in page', async () => {
    page.debugger.focused = { attrs: EMAIL_FIELD, value: '' };
    const runs: unknown[] = [];
    // Onshape: Continue focuses the password field; Return signs in.
    page.onReturn = () => {
      runs.push(splashState().signInRun);
      if (page.returns === 1)
        page.debugger.focused = { attrs: PASSWORD_FIELD, value: '' };
      if (page.returns === 2) {
        page.getURL = () => 'https://cad.onshape.com/documents';
        page.emit('did-navigate');
      }
    };
    // Zenshape's page holds focus as the user presses Sign in, twice in a
    // row while the save is still going.
    splash().focus();
    h.signIn.crypto.length = 0;
    send(splash(), { type: 'sign-in', email: EMAIL, password: PASSWORD });
    send(splash(), { type: 'sign-in', email: EMAIL, password: PASSWORD });
    await settle(300);
    expect(h.signIn.files.size).toBe(1);
    expect(h.signIn.crypto.filter((c) => c === 'encrypt')).toHaveLength(2);
    expect(page.typed).toEqual([EMAIL, PASSWORD]);
    expect(page.returns).toBe(2);
    // Zenshape's page was in front at each Return, the steps ticking off.
    expect(runs).toEqual([
      { done: ['save'], stopped: null },
      { done: ['save', 'email'], stopped: null },
    ]);
    expect(splashState()).toMatchObject({
      splash: 'saved-sign-in',
      signInRun: { done: ['save', 'email', 'password', 'done'], stopped: null },
    });
    await settle(700);
    expect(splashState().splash).toBeNull();
    for (const n of h.signIn.notices) {
      expect(n).not.toContain(EMAIL);
      expect(n).not.toContain(PASSWORD);
    }
    // The password never reached the strip page, in any of its views.
    for (const v of ours())
      for (const call of (
        v.view.webContents.send as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls)
        expect(JSON.stringify(call)).not.toContain(PASSWORD);
  });

  it('signed out soon after signing in: held a moment by the loop breaker, then a sign-in tab after all', async () => {
    const back = h.views.at(-1)!.view.webContents;
    back.getURL = () => SIGN_IN;
    back.emit('did-navigate');
    expect(stripTabs().some((t) => t.signIn)).toBe(false);
    await settle(2200);
    // A login is saved: Onshape's own page, in a sign-in tab, no Zenshape page.
    expect(stripTabs().some((t) => t.signIn)).toBe(true);
    expect(splashState()?.splash ?? null).toBeNull();
    page = back;
  }, 10_000);

  it('Onshape asks for a code: handed over, every step done as a success, then Onshape’s page comes forward', async () => {
    // The sign-in tab from the sign-out above, on Zenshape's page again.
    item('Saved Sign-in…').click!();
    await settle();
    expect(splashState().savedSignIn).toEqual({ email: EMAIL });
    h.signIn.crypto.length = 0;
    page.debugger.focused = { attrs: EMAIL_FIELD, value: '' };
    page.onReturn = () => {
      page.debugger.focused =
        page.returns === 1
          ? { attrs: PASSWORD_FIELD, value: '' }
          : { attrs: ['type', 'text', 'name', 'code'], value: '' };
    };
    // Unchanged login: nothing saved again, no key-store call but the reads.
    send(splash(), { type: 'sign-in', email: EMAIL, password: null });
    await settle(400);
    // Nothing saved again: decrypts only (the fills and account readings).
    expect(h.signIn.crypto.filter((c) => c !== 'decrypt')).toEqual([]);
    expect(page.typed).toEqual([EMAIL, PASSWORD]);
    expect(splashState()).toMatchObject({
      splash: 'saved-sign-in',
      signInRun: {
        done: ['save', 'email', 'password', 'done'],
        stopped: null,
      },
    });
    await settle(800);
    expect(splashState().splash).toBeNull();
  }, 10_000);

  it('Saved Sign-in… reopened while a stopped list is up stays open', async () => {
    item('Saved Sign-in…').click!();
    await settle();
    // Another account's email in Onshape's field: the run leaves it alone.
    const OTHER = 'someone-else@example.test';
    page.debugger.focused = { attrs: EMAIL_FIELD, value: OTHER };
    page.debugger.emailValue = OTHER;
    send(splash(), { type: 'sign-in', email: EMAIL, password: null });
    await settle(300);
    expect(splashState().signInRun).toMatchObject({
      stopped: { step: 'email' },
    });
    page.debugger.emailValue = null;
    item('Saved Sign-in…').click!();
    await settle(2700);
    expect(splashState().splash).toBe('saved-sign-in');
    send(splash(), { type: 'dismiss-splash' });
    await settle(400);
  }, 10_000);

  it('a failure mid-run still ends the run, so Sign in works again', async () => {
    item('Saved Sign-in…').click!();
    await settle();
    page.debugger.focused = { attrs: EMAIL_FIELD, value: '' };
    const insert = page.insertText;
    page.insertText = () => Promise.reject(new Error('page gone'));
    send(splash(), { type: 'sign-in', email: EMAIL, password: null });
    await settle(300);
    page.insertText = insert;
    expect(splashState().signInRun).toMatchObject({ stopped: {} });
    await settle(2700);
    expect(splashState().splash).toBeNull();
    // Not stuck busy: the page opens with no run on it.
    item('Saved Sign-in…').click!();
    await settle();
    expect(splashState().signInRun).toBeNull();
    send(splash(), { type: 'dismiss-splash' });
    await settle(400);
  }, 10_000);

  it('the saved-login path: Onshape’s page fills the email as its field has focus, with no click and no key', async () => {
    // Back to a fresh sign-in page (off Onshape and back resets its fills).
    page.getURL = () => 'https://acme.okta.example/login';
    page.emit('did-navigate');
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    const typed = page.typed.length;
    const keys = page.keys;
    page.debugger.emailValue = '';
    page.debugger.focused = { attrs: EMAIL_FIELD, value: '' };
    page.focus();
    await settle(600);
    expect(page.typed.slice(typed)).toEqual([EMAIL]);
    expect(page.keys).toBe(keys);
  });

  it('after the user continues with the saved email, the password, still with no key', async () => {
    const typed = page.typed.length;
    const keys = page.keys;
    page.debugger.emailValue = EMAIL;
    page.debugger.focused = { attrs: EMAIL_FIELD, value: EMAIL };
    await settle(400);
    // The user pressed Continue themselves: Onshape focuses the password.
    page.debugger.focused = { attrs: PASSWORD_FIELD, value: '' };
    await settle(600);
    expect(page.typed.slice(typed)).toEqual([PASSWORD]);
    expect(page.keys).toBe(keys);
  });

  it('a different account is left alone: no password, and neither email in a notice', async () => {
    page.getURL = () => 'https://acme.okta.example/login';
    page.emit('did-navigate');
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    const OTHER = 'someone-else@example.test';
    const typed = page.typed.length;
    page.debugger.emailValue = OTHER;
    page.debugger.focused = { attrs: EMAIL_FIELD, value: OTHER };
    page.focus();
    await settle(400);
    page.debugger.focused = { attrs: PASSWORD_FIELD, value: '' };
    await settle(800);
    expect(page.typed.slice(typed)).toEqual([]);
    for (const n of h.signIn.notices) {
      expect(n).not.toContain(OTHER);
      expect(n).not.toContain(EMAIL);
    }
  });

  // Back to a fresh sign-in page (off Onshape and back resets its fills).
  const freshPage = () => {
    page.getURL = () => 'https://acme.okta.example/login';
    page.emit('did-navigate');
    page.getURL = () => SIGN_IN;
    page.emit('did-navigate');
    page.onReturn = undefined;
  };

  it('the autofill doesn’t type while Zenshape’s page is up', async () => {
    freshPage();
    item('Saved Sign-in…').click!();
    await settle();
    const typed = page.typed.length;
    page.debugger.emailValue = '';
    page.debugger.focused = { attrs: EMAIL_FIELD, value: '' };
    page.focus();
    await settle(600);
    expect(page.typed.length).toBe(typed);
    send(splash(), { type: 'dismiss-splash' });
    await settle(700);
    // Gone: Onshape's page fills as before.
    expect(page.typed.slice(typed)).toEqual([EMAIL]);
  });

  it('the email already typed behind the page, then Sign in ticks every step with no red', async () => {
    // On its own: the saved email typed behind the page (by the autofill,
    // before Saved Sign-in… was opened).
    freshPage();
    page.debugger.emailValue = EMAIL;
    page.debugger.focused = { attrs: EMAIL_FIELD, value: EMAIL };
    page.focus();
    item('Saved Sign-in…').click!();
    await settle();
    const typed = page.typed.length;
    const runs: unknown[] = [];
    page.onReturn = () => {
      runs.push(splashState().signInRun);
      if (page.returns === returns0 + 1)
        page.debugger.focused = { attrs: PASSWORD_FIELD, value: '' };
      if (page.returns === returns0 + 2) {
        page.getURL = () => 'https://cad.onshape.com/documents';
        page.emit('did-navigate');
      }
    };
    const returns0 = page.returns;
    send(splash(), { type: 'sign-in', email: EMAIL, password: null });
    await settle(400);
    // The email wasn't typed again; the password was; both Returns pressed.
    expect(page.typed.slice(typed)).toEqual([PASSWORD]);
    expect(page.returns - returns0).toBe(2);
    expect(splashState()).toMatchObject({
      signInRun: { done: ['save', 'email', 'password', 'done'], stopped: null },
      savedSignInError: null,
    });
    await settle(700);
  });
});

describe('one door', () => {
  it('every typing and key on a page came from inside fillField or its pressReturn, from both triggers', () => {
    expect(h.signIn.stacks.length).toBeGreaterThan(0);
    for (const stack of h.signIn.stacks)
      expect(stack).toMatch(
        stack.startsWith('key') ? /at pressReturn/ : /at fillField/,
      );
    const triggers = new Set(
      h.signIn.logs.filter(([e]) => e === 'fill').map(([, d]) => d.trigger),
    );
    expect([...triggers].sort()).toEqual(['focus', 'run']);
  });

  it('the log never carries an email or the password', () => {
    const all = JSON.stringify(h.signIn.logs);
    for (const value of [
      'fake-user@example.test',
      'fake-password-1',
      'someone-else@example.test',
    ])
      expect(all).not.toContain(value);
    expect(h.signIn.logs.some(([e]) => e === 'account')).toBe(true);
  });
});
