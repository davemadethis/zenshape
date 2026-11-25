import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { landmarks as L, tabStates } from '../../src/onshape-dom';
import type { Cdp } from './cdp';
import { HIDE_MS, REVEAL_MS, Ui, sleep } from './harness';
import { urls } from './targets';

// Zen mode on a document page (Part Studio): what hides, the 12px gutter,
// and the edge reveals.
let ui: Ui;
let page: Cdp;
let vp: { width: number; height: number };
const GUTTER = 12;

beforeAll(async () => {
  ui = await Ui.connect();
  await ui.reset(urls.owned);
  await ui.openTab(urls.document);
  page = await ui.page();
  await ui.setZen(true);
  vp = await ui.viewport(page);
  await ui.screenshot(page, 'zen-document');
});
afterAll(async () => {
  await ui?.setZen(false);
  page?.close();
  ui?.close();
});

describe('zen mode on a document', () => {
  it('hides the top bar, logo included, and moves the content to the top', async () => {
    expect((await ui.landmark(page, 'topBar', ['display'])).style.display).toBe(
      'none',
    );
    expect(
      (await ui.landmark(page, 'contentContainer', ['top'])).style.top,
    ).toBe('0px');
  });

  it('hides the icon rail and bottom tabs fully: invisible and off-screen', async () => {
    const rail = await ui.landmark(page, 'docIconRail', ['opacity']);
    expect(rail.box.right).toBeLessThanOrEqual(0);
    expect(Number(rail.style.opacity)).toBe(0);
    const tabs = await ui.landmark(page, 'docTabBar', ['opacity']);
    expect(tabs.box.y).toBeGreaterThanOrEqual(vp.height);
    expect(Number(tabs.style.opacity)).toBe(0);
  });

  it('keeps a 12px gutter inside the panel, whose lines still reach the edges', async () => {
    const panel = await ui.landmark(page, 'docPanel', ['border-bottom-width']);
    expect(panel.box.x).toBe(0);
    expect(panel.box.bottom).toBe(vp.height);
    expect(panel.style['border-bottom-width']).toBe('0px');
    // Sections inset, dividers full width.
    const geometry = await page.eval<{
      sections: number[];
      dividers: number[];
    }>(`(() => {
      const inner = document.querySelector(${JSON.stringify(L.docPanelInner)});
      const xs = (sel) => [...inner.querySelectorAll(':scope > ' + sel)].map((e) => e.getBoundingClientRect().x);
      return { sections: xs(':not(.os-splitter)'), dividers: xs('.os-splitter') };
    })()`);
    expect(geometry.sections.length).toBeGreaterThan(0);
    for (const x of geometry.sections) expect(x).toBe(GUTTER);
    for (const x of geometry.dividers) expect(x).toBe(0);
  });

  it('starts the toolbar at the edge with 12px padding, and keeps 12px under the 3D view', async () => {
    const toolbar = await ui.landmark(page, 'docToolbar', ['padding-left']);
    expect(toolbar.box.x).toBe(0);
    expect(toolbar.style['padding-left']).toBe(`${GUTTER}px`);
    const canvas = await ui.landmark(page, 'docCanvasColumn', [
      'padding-bottom',
    ]);
    expect(canvas.style['padding-bottom']).toBe(`${GUTTER}px`);
  });

  it('reveals the icon rail from the left gutter, above the toolbar, then hides it', async () => {
    await ui.mouse(page, 'mouseMoved', 5, vp.height / 2);
    await sleep(REVEAL_MS);
    const rail = await ui.landmark(page, 'docIconRail', ['opacity']);
    expect(rail.box.x).toBe(0);
    expect(Number(rail.style.opacity)).toBe(1);
    // Over the toolbar's corner (the undo button, just below the slim top
    // bar), the rail is what's on top.
    const toolbar = await ui.landmark(page, 'docToolbar');
    const onTop = await page.eval<boolean>(
      `!!document.elementFromPoint(20, ${toolbar.box.y + 18})?.closest(${JSON.stringify(L.docIconRail)})`,
    );
    expect(onTop).toBe(true);
    await ui.screenshot(page, 'zen-document-rail');
    await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height / 2);
    await sleep(HIDE_MS);
    expect(
      (await ui.landmark(page, 'docIconRail')).box.right,
    ).toBeLessThanOrEqual(0);
  });

  it('reveals the bottom tabs from the bottom gutter, spanning the full width', async () => {
    await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height - 4);
    await sleep(REVEAL_MS);
    const tabs = await ui.landmark(page, 'docTabBar');
    expect(tabs.box.x).toBe(0);
    expect(tabs.box.width).toBe(vp.width);
    expect(tabs.box.bottom).toBe(vp.height);
    await ui.screenshot(page, 'zen-document-tabs');
    await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height / 2);
    await sleep(HIDE_MS);
    expect((await ui.landmark(page, 'docTabBar')).box.y).toBeGreaterThanOrEqual(
      vp.height,
    );
  });

  it('never flashes the rail back while zen mode turns on', async () => {
    await ui.setZen(false);
    const sampling = page.eval<number[]>(`(async () => {
      const el = document.querySelector(${JSON.stringify(L.docIconRail)});
      const seen = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 2000) {
        seen.push(Number(getComputedStyle(el).opacity));
        await new Promise((r) => setTimeout(r, 30));
      }
      return seen;
    })()`);
    await sleep(100);
    await ui.win('await w.setZen(true);');
    const seen = await sampling;
    // Once it has faded below half, it must not come back above it.
    const faded = seen.findIndex((o) => o < 0.5);
    expect(faded).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen.slice(faded))).toBeLessThan(0.5);
  });

  it('restores Onshape’s layout when zen mode turns off', async () => {
    await ui.setZen(false);
    expect(
      (await ui.landmark(page, 'topBar', ['display'])).style.display,
    ).not.toBe('none');
    expect(
      (await ui.landmark(page, 'contentContainer', ['top'])).style.top,
    ).toBe('40px');
    expect(
      (await ui.landmark(page, 'docIconRail', ['position'])).style.position,
    ).not.toBe('absolute');
    await ui.setZen(true);
  });

  it('gives a hidden tab bar’s gutter zen’s gray, not the hidden top bar’s color', async () => {
    await ui.setZen(true);
    await ui.win('w.setCollapsed(true);');
    await sleep(400);
    const strip = await ui.strip();
    try {
      expect(await ui.pixel(strip, 70, 4)).toEqual([51, 51, 51]);
    } finally {
      strip.close();
      await ui.win('w.setCollapsed(false);');
    }
  });

  it('keeps the bottom tabs out while a tab’s menu is open', async () => {
    await openTabMenu();
    try {
      await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height / 2);
      await sleep(HIDE_MS);
      await expectTabBarOut();
    } finally {
      await key('Escape');
    }
    await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height / 2 + 1);
    await sleep(HIDE_MS);
    await expectTabBarIn();
  });

  it('keeps the bottom tabs out while a tab is being renamed', async () => {
    await openTabMenu();
    const rename = await page.eval<{ x: number; y: number } | null>(`(() => {
      const item = [...document.querySelectorAll('ul.context-menu-list li')]
        .find((li) => li.textContent.trim() === 'Rename');
      if (!item) return null;
      const r = item.getBoundingClientRect();
      return { x: r.x + 20, y: r.y + r.height / 2 };
    })()`);
    expect(rename).not.toBeNull();
    await ui.mouse(page, 'mouseMoved', rename!.x, rename!.y);
    await ui.click(page, rename!.x, rename!.y);
    await sleep(300);
    try {
      // Only the rename holds the bar now, not the menu.
      expect(
        await page.eval(`[
          !!document.querySelector(${JSON.stringify(`${L.docTabBar} ${tabStates.renaming}`)}),
          !!document.querySelector(${JSON.stringify(`${L.docTabBar} ${tabStates.menuOpen}`)}),
        ]`),
      ).toEqual([true, false]);
      await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height / 2);
      await sleep(HIDE_MS);
      await expectTabBarOut();
      await ui.screenshot(page, 'zen-document-renaming');
    } finally {
      // Esc cancels, so nothing is saved to the test document.
      await key('Escape');
    }
    await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height / 2 + 1);
    await sleep(HIDE_MS);
    await expectTabBarIn();
  });
});

// Right-clicks the first tab in Onshape's bottom tab list, revealing the
// list first so the tab is on screen.
async function openTabMenu(): Promise<void> {
  await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height - 4);
  await sleep(REVEAL_MS);
  const at = await page.eval<{ x: number; y: number } | null>(`(() => {
    const tab = document.querySelector(${JSON.stringify(`${L.docTabBar} tab-list-item`)});
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  expect(at).not.toBeNull();
  await ui.mouse(page, 'mouseMoved', at!.x, at!.y);
  await ui.mouse(page, 'mousePressed', at!.x, at!.y, 'right');
  await ui.mouse(page, 'mouseReleased', at!.x, at!.y, 'right');
  await sleep(300);
}

async function key(name: 'Escape'): Promise<void> {
  const code = 27;
  for (const type of ['keyDown', 'keyUp'] as const) {
    await page.send('Input.dispatchKeyEvent', {
      type,
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
    });
  }
}

async function expectTabBarOut(): Promise<void> {
  const tabs = await ui.landmark(page, 'docTabBar', ['opacity']);
  expect(Number(tabs.style.opacity)).toBe(1);
  expect(tabs.box.bottom).toBe(vp.height);
}

async function expectTabBarIn(): Promise<void> {
  const tabs = await ui.landmark(page, 'docTabBar', ['opacity']);
  expect(tabs.box.y).toBeGreaterThanOrEqual(vp.height);
}
