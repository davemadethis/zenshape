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

async function screenshot(t: Target | undefined, name: string) {
  if (!t) return;
  const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
  try {
    const { data } = await cdp.send<{ data: string }>(
      'Page.captureScreenshot',
      {
        format: 'png',
      },
    );
    fs.writeFileSync(
      path.join(outDir, `${name}.png`),
      Buffer.from(data, 'base64'),
    );
  } finally {
    cdp.close();
  }
}

// Whatever state the app is in, a human gets to look at it.
afterAll(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const { page, strip, all } = await pages().catch(() => ({
    page: undefined,
    strip: undefined,
    all: [] as Target[],
  }));
  fs.writeFileSync(
    path.join(outDir, 'targets.json'),
    JSON.stringify(all, null, 2),
  );
  await screenshot(strip, 'strip').catch(() => {});
  await screenshot(page, 'onshape').catch(() => {});
});

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
  it('a. shows an Onshape page and our strip within 60 s', async () => {
    const found = await poll(60_000, async () => {
      const p = await pages();
      return p.page && p.strip ? p : undefined;
    });
    const seen = await pages()
      .then((p) => p.all.map((t) => `${t.type} ${t.url}`))
      .catch((e: Error) => `${e.message} ${String(e.cause ?? '')}`);
    expect(found, `targets: ${JSON.stringify(seen)}`).toBeDefined();
  }, 70_000);

  it('b. the Onshape page is its sign-in page', async () => {
    const url = await poll(30_000, async () => {
      const { page } = await pages();
      return page && isSignIn(page.url) ? page.url : undefined;
    });
    const now = (await pages()).page?.url;
    expect(url, `Onshape page is at ${now}`).toBeDefined();
  }, 40_000);

  it('c. the strip shows the "Sign in" tab', async () => {
    const titles = async () => {
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
    const ok = await poll(
      15_000,
      async () => (await titles()).includes('Sign in') || undefined,
    );
    expect(ok, `tabs: ${JSON.stringify(await titles())}`).toBe(true);
  }, 30_000);

  it('d. laid out: strip on top, the page below it at the same width', async () => {
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
      fs.writeFileSync(path.join(outDir, 'gutter.txt'), `${s.clientHeight}\n`);
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
  });

  it.skipIf(process.platform === 'darwin')(
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

  it.runIf(hidden && process.platform !== 'darwin')(
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

  it('e. the app printed no crash', () => {
    expect(logs.length, 'ZS_SMOKE_LOG names the app output').toBeGreaterThan(0);
    const text = logs
      .filter((f) => fs.existsSync(f))
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');
    const hits = text
      .split(/\r?\n/)
      .filter((line) => CRASH_TEXT.some((c) => line.includes(c)));
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
