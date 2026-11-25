import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cdp } from './cdp';
import { Ui, sleep } from './harness';
import { urls } from './targets';

// The tab strip: our own page, so these don't depend on Onshape's markup.
let ui: Ui;
let strip: Cdp;

const box = (sel: string) =>
  strip.eval<{
    x: number;
    y: number;
    width: number;
    height: number;
    right: number;
  }>(
    `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; })()`,
  );
const style = (sel: string, prop: string) =>
  strip.eval<string>(
    `getComputedStyle(document.querySelector(${JSON.stringify(sel)})).getPropertyValue(${JSON.stringify(prop)})`,
  );

beforeAll(async () => {
  ui = await Ui.connect();
  await ui.reset(urls.owned);
  strip = await ui.strip();
});
afterAll(() => {
  strip?.close();
  ui?.close();
});

describe('tab strip', () => {
  it('is 36px tall and matches Onshape’s header color', async () => {
    expect(await strip.eval('innerHeight')).toBe(36);
    expect(await style('body', 'background-color')).toBe('rgb(28, 28, 28)');
    await ui.screenshot(strip, 'strip');
  });

  it('leaves ~20px after the traffic lights, then back/forward, then tabs', async () => {
    const back = await box('#back');
    const forward = await box('#forward');
    const firstTab = await box('#tabs .tab');
    expect(back.x).toBe(86);
    expect(forward.x).toBeGreaterThan(back.x);
    expect(firstTab.x).toBeGreaterThan(forward.right);
  });

  it('disables back/forward until there is history, then enables back', async () => {
    const disabled = () =>
      strip.eval<[boolean, boolean]>(
        `[document.getElementById('back').disabled, document.getElementById('forward').disabled]`,
      );
    expect(await disabled()).toEqual([true, true]);
    const page = await ui.page();
    await page.send('Page.navigate', { url: urls.shared });
    await ui.waitForActiveLoad();
    await ui.waitFor(
      'back to enable',
      async () => (await disabled())[0] === false,
    );
    page.close();
    await ui.reset(urls.owned);
  });

  it('hangs tabs from the top edge, with the accent under the active one', async () => {
    const tab = await box('.tab.active');
    expect(tab.y).toBe(0);
    expect(await style('.tab.active', 'border-top-left-radius')).toBe('0px');
    expect(
      parseFloat(await style('.tab.active', 'border-bottom-left-radius')),
    ).toBeGreaterThan(0);
    expect(await style('.tab.active', 'box-shadow')).toContain(
      'rgb(61, 142, 230)',
    );
  });

  it('keeps a ≥48px drag gap however many tabs there are', async () => {
    const gap = await strip.eval<number>(`(() => {
      const tabs = document.getElementById('tabs');
      const one = tabs.querySelector('.tab');
      for (let i = 0; i < 40; i++) tabs.append(one.cloneNode(true));
      return document.getElementById('drag-gap').getBoundingClientRect().width;
    })()`);
    expect(gap).toBeGreaterThanOrEqual(48);
    await ui.win('w.push();'); // re-render the real tabs
  });

  it('puts the Z 14px from the right: white when off, #6aa8ec when on', async () => {
    const width = await strip.eval<number>('innerWidth');
    expect(width - (await box('#zen')).right).toBe(14);
    expect(await style('#zen', 'color')).toBe('rgb(255, 255, 255)');
    await ui.setZen(true);
    expect(await style('#zen', 'color')).toBe('rgb(106, 168, 236)');
    await ui.setZen(false);
  });

  it('shows pinned tabs by name with no close button, and locked tabs with a lock', async () => {
    const home = JSON.stringify(await ui.activeId());
    await ui.win(`w.setPinned(${home}, true); w.setLocked(${home}, true);`);
    await sleep(300);
    const pinned = await strip.eval<{
      close: boolean;
      lock: boolean;
      text: string;
    }>(`(() => {
      const t = document.querySelector('.tab.pinned');
      return { close: !!t.querySelector('.close'), lock: !!t.querySelector('.lock'), text: t.textContent.trim() };
    })()`);
    expect(pinned.close).toBe(false);
    expect(pinned.lock).toBe(true);
    expect(pinned.text.length).toBeGreaterThan(0);
    await ui.win(`w.setLocked(${home}, false); w.setPinned(${home}, false);`);
  });

  it('hides to a 12px gutter that slides the tab bar down on hover', async () => {
    const bounds = () =>
      ui.win<{
        strip: { height: number; width: number };
        page: { y: number };
        peeked: boolean;
      }>(
        `return { strip: w.strip.getBounds(), page: w.views.get(w.list.activeId).getBounds(), peeked: w.peeked };`,
      );
    await ui.win('w.setCollapsed(true);');
    await sleep(400);
    let b = await bounds();
    expect(b.strip.height).toBe(12);
    expect(b.page.y).toBe(12);
    // Hover the gutter: the strip comes down over the page, which doesn't move.
    await ui.mouse(strip, 'mouseMoved', 300, 6);
    await sleep(500);
    b = await bounds();
    expect(b.peeked).toBe(true);
    expect(b.strip.height).toBe(36);
    expect(b.page.y).toBe(12);
    expect(await style('body', 'transform')).toBe('none');
    // Slid in over the gutter, not under it: the strip's own color shows
    // where the gutter would be.
    expect(await ui.pixel(strip, 70, 4)).toEqual([28, 28, 28]);
    await ui.screenshot(strip, 'strip-peek');
    // The real cursor decides whether a pointer-leave is genuine (resizing the
    // strip view fires spurious ones); pin it so the test doesn't depend on
    // where your mouse is. Still over the strip: a leave must not hide it.
    await ui.win('w.cursorOverStrip = () => true;');
    await ui.mouse(strip, 'mouseMoved', 300, 300);
    await sleep(900);
    expect((await bounds()).peeked).toBe(true);
    // Really gone: it slides back up and the view shrinks to the gutter.
    await ui.win('w.cursorOverStrip = () => false;');
    await sleep(900);
    b = await bounds();
    expect(b.peeked).toBe(false);
    expect(b.strip.height).toBe(12);
    // Above Onshape's own top bar (this is a list page), the gutter is that
    // bar's color. (On a document in zen mode it's gray: zen-document test.)
    expect(await ui.pixel(strip, 70, 4)).toEqual([28, 28, 28]);
    await ui.win('delete w.cursorOverStrip;');
    await ui.win('w.setCollapsed(false);');
    await sleep(400);
    expect((await bounds()).strip.height).toBe(36);
  });

  it('hides the tab bar in zen mode when that setting is on, and brings it back after', async () => {
    const stripHeight = () =>
      ui.win<number>('return w.strip.getBounds().height;');
    await ui.win('w.setHideStripInZen(true);');
    await ui.setZen(true);
    expect(await stripHeight()).toBe(12);
    await ui.setZen(false);
    expect(await stripHeight()).toBe(36);
    await ui.win('w.setHideStripInZen(false);');
  });

  it('shows an update notice beside the Z only when a newer release is known', async () => {
    expect(await strip.eval('document.getElementById("update").hidden')).toBe(
      true,
    );
    await ui.win(
      `w.setUpdate({ version: '9.9.9', url: 'https://github.com/davemadethis/zenshape/releases/tag/v9.9.9' });`,
    );
    await sleep(200);
    const update = await box('#update');
    const zen = await box('#zen');
    expect(update.width).toBeGreaterThan(0);
    expect(update.right).toBeLessThanOrEqual(zen.x);
    expect(
      await strip.eval('document.getElementById("update").title'),
    ).toContain('9.9.9');
    await ui.screenshot(strip, 'strip-update');
    await ui.win('w.setUpdate(null);');
    await sleep(200);
    expect(await strip.eval('document.getElementById("update").hidden')).toBe(
      true,
    );
  });
});
