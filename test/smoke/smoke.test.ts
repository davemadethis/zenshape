import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Cdp, listTargets, type Target } from '../ui/cdp';

// The installed app, started by .github/workflows/smoke.yml with no Onshape
// login. Everything here goes through DevTools on the pages, the app's
// output, and screenshots: packaged builds have no inspector for the main
// process, and nothing may run as script in Onshape's page.
const port = Number(process.env.ZS_SMOKE_PORT ?? 9222);
// Several files (Windows writes stdout and stderr apart).
const logs = (process.env.ZS_SMOKE_LOG ?? '')
  .split(path.delimiter)
  .filter(Boolean);
const outDir = path.resolve(process.env.ZS_SMOKE_OUT ?? 'test-results/smoke');
const STRIP_HEIGHT = 36;
// The second launch starts with the tab bar hidden (stripCollapsed seeded
// into a fresh profile): the strip view is just the gutter. Its height
// mirrors src/tab-views.ts: Linux's is fixed; Windows' is its caption
// buttons' own, read at run time (null: anything between 12 and 36).
const hidden = process.env.ZS_SMOKE_HIDDEN === '1';
// Step h runs in two more passes around what the launch script does from
// outside: 'menu' opens the Z's menu, which the script reads, closes, then
// sends Ctrl+T; 'after-menu' checks that tab and the app's output again.
const pass = process.env.ZS_SMOKE_PASS ?? '';
const main = pass === '';
const offMac = process.platform !== 'darwin';
const GUTTER: number | null =
  process.platform === 'win32' ? null : process.platform === 'linux' ? 26 : 12;
const isStripTop = (h: number) =>
  !hidden
    ? h === STRIP_HEIGHT
    : GUTTER === null
      ? h > 12 && h < STRIP_HEIGHT
      : h === GUTTER;
const CRASH_TEXT = [
  'TypeError',
  'is not a function',
  'Uncaught',
  'UnhandledPromiseRejection',
];

// Well below the script's own hold (see check h's trace).
const MENU_MIN_OPEN_MS = 250;

const appOutput = () =>
  logs
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poll<T>(
  ms: number,
  fn: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v !== undefined || Date.now() > until) return v;
    await sleep(500);
  }
}

const isOnshape = (t: Target) =>
  t.type === 'page' &&
  /^https:\/\/([^/]+\.)?onshape\.com(\/|$)/.test(new URL(t.url).origin + '/');
// Not the splash, divider or overlay, which share the strip's file.
const isStrip = (t: Target) =>
  t.type === 'page' && t.url.endsWith('strip/index.html');

// Mirrors isSignInPage in src/navigation.ts.
const isSignIn = (url: string) => {
  const u = new URL(url);
  return u.hostname.startsWith('oauth.') || u.pathname.startsWith('/signin');
};

const pages = async () => {
  const all = await listTargets(port);
  return { page: all.find(isOnshape), strip: all.find(isStrip), all };
};

const viewport = async (t: Target) => {
  const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
  try {
    const m = await cdp.send<{
      cssLayoutViewport: { clientWidth: number; clientHeight: number };
    }>('Page.getLayoutMetrics');
    return m.cssLayoutViewport;
  } finally {
    cdp.close();
  }
};

// A page that isn't shown (a tab behind another) never answers a capture.
const SHOT_MS = 10_000;

async function screenshot(t: Target | undefined, name: string) {
  if (!t) return;
  const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
  let timer: NodeJS.Timeout | undefined;
  try {
    const { data } = await Promise.race([
      cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name}: no capture in ${SHOT_MS} ms`)),
          SHOT_MS,
        );
      }),
    ]);
    fs.writeFileSync(
      path.join(outDir, `${name}.png`),
      Buffer.from(data, 'base64'),
    );
  } finally {
    clearTimeout(timer);
    cdp.close();
  }
}

// Whatever state the app is in, a human gets to look at it (not while the
// menu is open: the script shoots the whole screen then).
afterAll(async () => {
  if (pass === 'menu') return;
  const suffix = pass ? `-${pass}` : '';
  fs.mkdirSync(outDir, { recursive: true });
  const { page, strip, all } = await pages().catch(() => ({
    page: undefined,
    strip: undefined,
    all: [] as Target[],
  }));
  fs.writeFileSync(
    path.join(outDir, `targets${suffix}.json`),
    JSON.stringify(all, null, 2),
  );
  for (const [t, name] of [
    [strip, `strip${suffix}`],
    [page, `onshape${suffix}`],
  ] as const) {
    await screenshot(t, name).catch((e: Error) => console.log(e.message));
  }
}, 3 * SHOT_MS);

const tabTitles = async (): Promise<string[]> => {
  const { strip } = await pages();
  if (!strip) return [];
  const cdp = await Cdp.connect(strip.webSocketDebuggerUrl);
  try {
    return await cdp.eval<string[]>(
      `[...document.querySelectorAll('#tabs .tab .title')].map((n) => n.textContent)`,
    );
  } finally {
    cdp.close();
  }
};

// The window's own controls, as the strip sees them: Electron's title bar
// overlay (Windows, Linux) reports the area left of them to every view.
const controls = async (strip: Target) => {
  const cdp = await Cdp.connect(strip.webSocketDebuggerUrl);
  try {
    return await cdp.eval<{
      visible: boolean | undefined;
      area: { x: number; width: number; height: number } | null;
      zenRight: number;
      lightsWidth: number;
      innerWidth: number;
      innerHeight: number;
    }>(`(() => {
      const o = navigator.windowControlsOverlay;
      const r = o && o.getTitlebarAreaRect();
      return {
        visible: o && o.visible,
        area: r ? { x: r.x, width: r.width, height: r.height } : null,
        zenRight: document.getElementById('zen').getBoundingClientRect().right,
        lightsWidth: document.getElementById('lights').getBoundingClientRect().width,
        innerWidth,
        innerHeight,
      };
    })()`);
  } finally {
    cdp.close();
  }
};

describe(`installed app, signed out${hidden ? ', tab bar hidden' : ''}`, () => {
  it.runIf(main)(
    'a. shows an Onshape page and our strip within 60 s',
    async () => {
      const found = await poll(60_000, async () => {
        const p = await pages();
        return p.page && p.strip ? p : undefined;
      });
      const seen = await pages()
        .then((p) => p.all.map((t) => `${t.type} ${t.url}`))
        .catch((e: Error) => `${e.message} ${String(e.cause ?? '')}`);
      expect(found, `targets: ${JSON.stringify(seen)}`).toBeDefined();
    },
    70_000,
  );

  it.runIf(main)(
    'b. the Onshape page is its sign-in page',
    async () => {
      const url = await poll(30_000, async () => {
        const { page } = await pages();
        return page && isSignIn(page.url) ? page.url : undefined;
      });
      const now = (await pages()).page?.url;
      expect(url, `Onshape page is at ${now}`).toBeDefined();
    },
    40_000,
  );

  it.runIf(main)(
    'c. the strip shows the "Sign in" tab',
    async () => {
      const titles = tabTitles;
      const ok = await poll(
        15_000,
        async () => (await titles()).includes('Sign in') || undefined,
      );
      expect(ok, `tabs: ${JSON.stringify(await titles())}`).toBe(true);
    },
    30_000,
  );

  it.runIf(main)(
    'd. laid out: strip on top, the page below it at the same width',
    async () => {
      const { page, strip } = await pages();
      expect(page && strip, 'both targets').toBeTruthy();
      const s = await viewport(strip!);
      const p = await viewport(page!);
      // The strip is our page, so it may run script: the window's outer size.
      const win = await Cdp.connect(strip!.webSocketDebuggerUrl);
      const [outerWidth, outerHeight] = await win
        .eval<number[]>('[outerWidth, outerHeight]')
        .finally(() => win.close());
      console.log('strip', s, 'page', p, 'window', [outerWidth, outerHeight]);
      expect(isStripTop(s.clientHeight), `strip height ${s.clientHeight}`).toBe(
        true,
      );
      if (hidden)
        fs.writeFileSync(
          path.join(outDir, 'gutter.txt'),
          `${s.clientHeight}\n`,
        );
      expect(s.clientWidth).toBeGreaterThan(0);
      expect(p.clientWidth).toBe(s.clientWidth);
      // A page view still at its zero-size start never got laid out.
      expect(p.clientHeight).toBeGreaterThan(STRIP_HEIGHT);
      // Stacked, the two fill the window's height: no overlap (sum too big),
      // no gap beyond the window frame. Outer sizes include Windows' invisible
      // resize border, so the frame's width bounds what the height may leave.
      const slack = outerHeight - (s.clientHeight + p.clientHeight);
      expect(slack).toBeGreaterThanOrEqual(0);
      expect(slack).toBeLessThanOrEqual(outerWidth - s.clientWidth);
    },
  );

  it.runIf(main && offMac)(
    'f. the window controls sit right of the Z, at the strip’s height (or the gutter’s)',
    async () => {
      const { strip } = await pages();
      const c = await controls(strip!);
      console.log('controls', c);
      expect(c.visible, 'navigator.windowControlsOverlay.visible').toBe(true);
      const left = c.area!.x + c.area!.width;
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThan(c.innerWidth);
      expect(c.zenRight).toBeLessThanOrEqual(left);
      // The controls fill the strip's height exactly: the gutter when hidden.
      expect(isStripTop(c.area!.height), `area ${c.area!.height}`).toBe(true);
      expect(c.area!.height).toBe(c.innerHeight);
      // No traffic lights here: just the small margin.
      expect(c.lightsWidth).toBe(8);
    },
  );

  it.runIf(main && hidden && offMac)(
    'g. peeking brings the strip and the controls back to full height',
    async () => {
      const { strip } = await pages();
      const cdp = await Cdp.connect(strip!.webSocketDebuggerUrl);
      await cdp
        .eval(`window.zenshape.send({ type: 'peek' })`)
        .finally(() => cdp.close());
      const c = await poll(5_000, async () => {
        const c = await controls(strip!);
        return c.innerHeight === STRIP_HEIGHT && c.area?.height === STRIP_HEIGHT
          ? c
          : undefined;
      });
      const now = await controls(strip!);
      console.log('peeked', now);
      expect(c, JSON.stringify(now)).toBeDefined();
      // Left peeked: the workflow's last whole-screen shot shows it.
    },
  );

  // Left open: the launch script reads it, shoots the screen and closes it.
  it.runIf(pass === 'menu' && offMac)(
    "h. the Z's menu opens (strip-menu through the strip's bridge)",
    async () => {
      const { strip } = await pages();
      expect(strip, 'the strip').toBeDefined();
      // Ctrl+T's check counts from here.
      const before = await tabTitles();
      expect(before.length).toBeGreaterThan(0);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'tabs-before-h.json'),
        JSON.stringify(before),
      );
      const cdp = await Cdp.connect(strip!.webSocketDebuggerUrl);
      await cdp
        .eval(`window.zenshape.send({ type: 'strip-menu' })`)
        .finally(() => cdp.close());
    },
  );

  // The script pressed Ctrl+T with no menu bar drawn: only the application
  // menu's accelerator can have opened a tab.
  it.runIf(pass === 'after-menu' && offMac)(
    'h. Ctrl+T opened one more tab, with no menu bar',
    async () => {
      const before = JSON.parse(
        fs.readFileSync(path.join(outDir, 'tabs-before-h.json'), 'utf8'),
      ) as string[];
      const more = await poll(10_000, async () =>
        (await tabTitles()).length === before.length + 1 ? true : undefined,
      );
      const now = await tabTitles();
      expect(
        more,
        `before ${JSON.stringify(before)}, now ${JSON.stringify(now)}`,
      ).toBe(true);
    },
    20_000,
  );

  // The app's own word (ZENSHAPE_TRACE_MENUS) that the menu opened with the
  // app menu in it and stayed open until the script closed it, whatever UI
  // Automation could read of it.
  it.runIf(pass === 'after-menu' && offMac)(
    "h. the app's output shows the Z's menu opened with the app menu and stayed open",
    () => {
      const lines = appOutput()
        .split(/\r?\n/)
        .filter((l) => l.includes('strip menu: '));
      console.log(lines.join('\n'));
      const opened = lines.findLast((l) => l.includes('strip menu: opened: '));
      expect(opened, 'no "strip menu: opened" line').toBeDefined();
      for (const label of [
        'Hide Tab Bar',
        'Zen Mode',
        'Zenshape',
        'File',
        'View',
        'Window',
      ]) {
        expect(opened).toContain(label);
      }
      expect(opened).not.toContain('Edit');
      const closed = lines
        .slice(lines.lastIndexOf(opened!))
        .find((l) => /strip menu: closed after \d+ ms/.test(l));
      expect(closed, 'no "strip menu: closed" line after it').toBeDefined();
      const ms = Number(/closed after (\d+) ms/.exec(closed!)![1]);
      // The menu stays open until the script's Esc, so this time is the
      // script's: on Windows its UI Automation read (which already proves
      // the menu was open while read), on Linux a 2 s wait and a shot. A
      // threshold near that wait fails on a quick read (974 ms seen), so it
      // only rules out a menu that closed by itself at once, as a focus
      // change closes one, a frame or two after it opened.
      expect(ms, closed).toBeGreaterThanOrEqual(MENU_MIN_OPEN_MS);
    },
  );

  it.runIf(pass !== 'menu')('e. the app printed no crash', () => {
    expect(logs.length, 'ZS_SMOKE_LOG names the app output').toBeGreaterThan(0);
    const text = appOutput();
    const hits = text
      .split(/\r?\n/)
      .filter((line) => CRASH_TEXT.some((c) => line.includes(c)));
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
