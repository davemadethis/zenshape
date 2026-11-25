import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cdp } from './cdp';
import { Ui, sleep } from './harness';
import { urls } from './targets';

// Tab behaviour: window.open, locks, mouse back/forward, splits, reordering.
let ui: Ui;

beforeAll(async () => {
  ui = await Ui.connect();
  await ui.reset(urls.owned);
});
afterAll(() => ui?.close());

const stripState = async (strip: Cdp) =>
  strip.eval<string[]>(`[...document.querySelectorAll('#tabs > *')].map((n) =>
    n.classList.contains('group')
      ? 'GROUP[' + (n.querySelector('.split-icon').classList.contains('row') ? 'row' : 'column') + ']'
      : n.textContent.replace('×', '').trim())`);

describe('tabs', () => {
  it('turns an Onshape window.open into a tab', async () => {
    const before = (await ui.tabs()).length;
    const page = await ui.page();
    await page.eval(`window.open(${JSON.stringify(urls.shared)}) !== null`);
    page.close();
    await ui.waitFor(
      'a new tab',
      async () => (await ui.tabs()).length === before + 1,
    );
    await ui.reset(urls.owned);
  });

  it('keeps a locked tab on its folder and opens the other folder beside it', async () => {
    const id = await ui.activeId();
    await ui.win(`w.setLocked(${JSON.stringify(id)}, true);`);
    const page = await ui.page();
    const target = new URL(urls.otherFolder);
    await page.eval(
      `history.pushState({}, '', ${JSON.stringify(target.pathname + target.search)})`,
    );
    page.close();
    await ui.waitFor('a tab for the other folder', async () =>
      (await ui.tabs()).some((t) =>
        t.url.includes(target.searchParams.get('nodeId')!),
      ),
    );
    const locked = (await ui.tabs()).find((t) => t.id === id)!;
    expect(locked.url).toBe(urls.owned);
    await ui.reset(urls.owned);
  });

  it('goes back and forward with the mouse buttons', async () => {
    let page = await ui.page();
    await page.send('Page.navigate', { url: urls.shared });
    page.close();
    await ui.waitForActiveLoad();
    page = await ui.page();
    await ui.mouse(page, 'mousePressed', 400, 400, 'back');
    await ui.mouse(page, 'mouseReleased', 400, 400, 'back');
    await ui.waitFor('back to Owned by me', async () =>
      (await ui.win<string>('return w.activeContents.getURL();')).includes(
        'resourceuserowner',
      ),
    );
    await ui.mouse(page, 'mousePressed', 400, 400, 'forward');
    await ui.mouse(page, 'mouseReleased', 400, 400, 'forward');
    await ui.waitFor('forward to Shared', async () =>
      (await ui.win<string>('return w.activeContents.getURL();')).includes(
        'nodeId=12',
      ),
    );
    page.close();
    await ui.reset(urls.owned);
  });

  it('groups a split into one tab; its icon swaps on click and rotates on double-click', async () => {
    const a = await ui.activeId();
    const b = await ui.openTab(urls.shared);
    await ui.win(`w.splitOnto(${JSON.stringify(b)}, ${JSON.stringify(a)});`);
    await sleep(500);
    const strip = await ui.strip();
    expect(await stripState(strip)).toEqual(['GROUP[row]']);
    const order = () => ui.win<string[]>('return [w.split.a, w.split.b];');
    const before = await order();
    const icon = await strip.eval<{ x: number; y: number }>(`(() => {
      const r = document.querySelector('.split-icon').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await ui.click(strip, icon.x, icon.y);
    await sleep(600);
    expect(await order()).toEqual([before[1], before[0]]);
    await ui.click(strip, icon.x, icon.y, 1);
    await sleep(60);
    await ui.click(strip, icon.x, icon.y, 2);
    await sleep(600);
    expect(await stripState(strip)).toEqual(['GROUP[column]']);
    expect(await order()).toEqual([before[1], before[0]]);
    await ui.screenshot(strip, 'strip-split-group');
    strip.close();
    await ui.reset(urls.owned);
  });

  it('reorders pinned tabs by dragging, and keeps the order', async () => {
    const a = await ui.activeId();
    const b = await ui.openTab(urls.shared);
    await ui.win(
      `w.setPinned(${JSON.stringify(a)}, true); w.setPinned(${JSON.stringify(b)}, true);`,
    );
    await sleep(400);
    const strip = await ui.strip();
    const centers = await strip.eval<
      { x: number; y: number }[]
    >(`[...document.querySelectorAll('.tab.pinned')].map((t) => {
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x };
    })`);
    const [first, second] = centers as unknown as {
      x: number;
      y: number;
      left: number;
    }[];
    // Drag the second pin to just inside the first one's left edge.
    await ui.mouse(strip, 'mousePressed', second.x, second.y, 'left');
    for (let i = 1; i <= 10; i++) {
      await ui.mouse(
        strip,
        'mouseMoved',
        second.x + ((first.left + 4 - second.x) * i) / 10,
        second.y,
        'left',
      );
      await sleep(20);
    }
    await ui.mouse(strip, 'mouseReleased', first.left + 4, second.y, 'left');
    await sleep(600);
    const order = await ui.win<string[]>(
      'return w.snapshot().tabs.filter((t) => t.pinned).map((t) => t.url);',
    );
    expect(order[0]).toContain('nodeId=12');
    strip.close();
    await ui.win(`for (const t of w.list.tabs) w.setPinned(t.id, false);`);
    await ui.reset(urls.owned);
  });
});
