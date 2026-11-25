import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { inject } from 'vitest';
import { landmarks, type Landmark } from '../../src/onshape-dom';
import { Cdp, listTargets } from './cdp';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface LandmarkInfo {
  found: boolean;
  box: Box;
  style: Record<string, string>;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  pinned: boolean;
  locked: boolean;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Zen fades take 450ms, then the layout step; bars slide 320ms in / linger
// 300ms + 250ms out. These waits leave headroom over those.
export const ZEN_SETTLE_MS = 1400;
export const REVEAL_MS = 700;
export const HIDE_MS = 1000;

// Shared helpers for the UI tests. One per test file; the app is shared.
export class Ui {
  readonly cdpPort: number;
  readonly outDir: string;
  private constructor(
    readonly main: Cdp,
    ports: { cdpPort: number; outDir: string },
  ) {
    this.cdpPort = ports.cdpPort;
    this.outDir = ports.outDir;
  }

  static async connect(): Promise<Ui> {
    const zs = inject('zs');
    const [inspector] = (await (
      await fetch(`http://127.0.0.1:${zs.inspectPort}/json/list`)
    ).json()) as { webSocketDebuggerUrl: string }[];
    const ui = new Ui(await Cdp.connect(inspector.webSocketDebuggerUrl), zs);
    // The launch splash covers the window, and Chromium reports the pages
    // under it as hidden; tests start once it's gone.
    await ui.waitFor(
      'the launch splash to go',
      () => ui.win<boolean>('return !w.splash.getVisible();'),
      10_000,
    );
    return ui;
  }

  // --- main process ------------------------------------------------------

  // Runs `body` in the main process with `w` = the ZenshapeWindow.
  win<T>(body: string): Promise<T> {
    return this.main.eval<T>(
      `(async () => { const w = globalThis.__zenshape.window(); ${body} })()`,
    );
  }

  tabs(): Promise<TabInfo[]> {
    return this.win(
      `return w.list.tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, pinned: t.pinned, locked: !!t.lockedUrl }));`,
    );
  }

  activeId(): Promise<string> {
    return this.win('return w.list.activeId;');
  }

  // Opens a tab, waits for it to load, and returns its id.
  async openTab(url: string): Promise<string> {
    await this.win(`w.newTab(${JSON.stringify(url)});`);
    await this.waitForActiveLoad();
    return this.activeId();
  }

  async select(id: string): Promise<void> {
    await this.win(`w.selectTab(${JSON.stringify(id)});`);
    await this.waitForActiveLoad();
  }

  async waitForActiveLoad(): Promise<void> {
    await this.waitFor('the active tab to load', () =>
      this.win<boolean>(
        `const c = w.activeContents; return !!c && !c.isLoading() && c.getURL().startsWith('https://cad.onshape.com');`,
      ),
    );
    // Onshape keeps rendering after load; give its app a moment.
    await sleep(2500);
  }

  async setZen(on: boolean): Promise<void> {
    await this.win(`await w.setZen(${on});`);
    await sleep(ZEN_SETTLE_MS);
  }

  // Back to one plain tab on Owned by me: zen off, no split, strip expanded.
  async reset(url: string): Promise<string> {
    await this.win(
      `w.unsplit(); w.setCollapsed(false); await w.setZen(false);`,
    );
    const id = await this.openTab(url);
    await this.win(
      `for (const t of [...w.list.tabs]) if (t.id !== ${JSON.stringify(id)}) w.closeTab(t.id);`,
    );
    await this.select(id);
    return id;
  }

  // --- pages ---------------------------------------------------------------

  // Our tab strip page (not the divider or overlay, which share its file).
  async strip(): Promise<Cdp> {
    const t = (await listTargets(this.cdpPort)).find(
      (t) => t.type === 'page' && /strip\/index\.html#?$/.test(t.url),
    );
    if (!t) throw new Error('UI: tab strip page not found');
    return Cdp.connect(t.webSocketDebuggerUrl);
  }

  // The Onshape page currently on screen (the active tab).
  async page(): Promise<Cdp> {
    // Found by the active tab's URL, not by the page reporting itself
    // visible: macOS marks a window's pages hidden whenever other windows
    // cover it, which depends on whatever else is on screen.
    const url = await this.win<string>('return w.activeContents.getURL();');
    const matches = (await listTargets(this.cdpPort)).filter(
      (t) => t.type === 'page' && t.url === url,
    );
    if (!matches.length) throw new Error(`UI: no Onshape page at ${url}`);
    // Two tabs on one URL: the visible one, if the OS says.
    for (const t of matches.slice(0, -1)) {
      const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
      if ((await cdp.eval('document.visibilityState')) === 'visible')
        return cdp;
      cdp.close();
    }
    return Cdp.connect(matches[matches.length - 1].webSocketDebuggerUrl);
  }

  // Box and computed styles of an Onshape landmark. A missing landmark fails
  // with its name, which is what to fix in src/onshape-dom.ts.
  async landmark(
    page: Cdp,
    name: Landmark,
    props: string[] = [],
  ): Promise<LandmarkInfo> {
    const sel = landmarks[name];
    const info = await page.eval<LandmarkInfo>(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return { found: false, box: null, style: {} };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const style = {};
      for (const p of ${JSON.stringify(props)}) style[p] = cs.getPropertyValue(p);
      return { found: true, box: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }, style };
    })()`);
    if (!info.found) {
      throw new Error(
        `Onshape landmark "${name}" (${sel}) not found on this page. Onshape may have changed; run \`npm run ui:probe\` and update src/onshape-dom.ts.`,
      );
    }
    return info;
  }

  // Zen's slim top bar: its height, Onshape's logo in it, and how many other
  // things in it are still visible (should be none).
  topBar(page: Cdp): Promise<{
    height: number;
    logo: Box & { visibility: string };
    othersVisible: number;
  }> {
    return page.eval(`(() => {
      const bar = document.querySelector(${JSON.stringify(landmarks.topBar)});
      const logo = bar.querySelector(${JSON.stringify(landmarks.topBarLogo)});
      const r = logo.getBoundingClientRect();
      const othersVisible = [...bar.querySelectorAll('*')].filter((e) =>
        e !== logo && !e.contains(logo) && getComputedStyle(e).visibility === 'visible' &&
        e.getBoundingClientRect().width > 0).length;
      return {
        height: bar.getBoundingClientRect().height,
        logo: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, visibility: getComputedStyle(logo).visibility },
        othersVisible,
      };
    })()`);
  }

  viewport(page: Cdp): Promise<{ width: number; height: number }> {
    return page.eval('({ width: innerWidth, height: innerHeight })');
  }

  // --- input & evidence ----------------------------------------------------

  async mouse(
    page: Cdp,
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
    x: number,
    y: number,
    button: 'none' | 'left' | 'right' | 'back' | 'forward' = 'none',
    clickCount = 1,
  ): Promise<void> {
    const buttons = { none: 0, left: 1, right: 2, back: 8, forward: 16 }[
      button
    ];
    await page.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button,
      buttons: type === 'mouseReleased' ? 0 : buttons,
      clickCount: type === 'mouseMoved' ? 0 : clickCount,
    });
  }

  async click(page: Cdp, x: number, y: number, clickCount = 1): Promise<void> {
    await this.mouse(page, 'mousePressed', x, y, 'left', clickCount);
    await this.mouse(page, 'mouseReleased', x, y, 'left', clickCount);
  }

  // Saved for a human look; tests don't compare pixels (Onshape's content is
  // live data).
  async screenshot(page: Cdp, name: string): Promise<string> {
    const { data } = await page.send<{ data: string }>(
      'Page.captureScreenshot',
      {
        format: 'png',
      },
    );
    const file = path.join(this.outDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  // RGB of one pixel (CSS px) in a page, from a real screenshot: checks what
  // is painted, which hit-testing can't.
  async pixel(
    page: Cdp,
    x: number,
    y: number,
  ): Promise<[number, number, number]> {
    const { data } = await page.send<{ data: string }>(
      'Page.captureScreenshot',
      {
        format: 'png',
        clip: { x, y, width: 1, height: 1, scale: 1 },
      },
    );
    return decodeFirstPixel(Buffer.from(data, 'base64'));
  }

  async waitFor<T>(
    what: string,
    fn: () => Promise<T>,
    ms = 30_000,
  ): Promise<T> {
    const until = Date.now() + ms;
    let last: unknown;
    while (Date.now() < until) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (e) {
        last = e;
      }
      await sleep(250);
    }
    throw new Error(
      `UI: timed out waiting for ${what}${last ? ` (${String(last)})` : ''}`,
    );
  }

  close(): void {
    this.main.close();
  }
}

// Top-left pixel of a PNG (8-bit RGB/RGBA). Only filter types for row 0 matter.
function decodeFirstPixel(png: Buffer): [number, number, number] {
  let pos = 8;
  let ihdr: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const body = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = body;
    if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  if (!ihdr || ihdr[8] !== 8) throw new Error('UI: unexpected PNG format');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // Row 0, first pixel: with no row above and no pixel to the left, every
  // filter type leaves the bytes as stored.
  return [raw[1], raw[2], raw[3]];
}
