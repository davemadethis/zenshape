import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cdp } from './cdp';
import { Ui, sleep } from './harness';
import { urls } from './targets';

// Zen mode on a drawing: its gutters are the drawing's own colors, not
// zen's dark gray (docs/zen.md, docs/tab-views.md).
let ui: Ui;
let page: Cdp;

beforeAll(async () => {
  ui = await Ui.connect();
  await ui.reset(urls.owned);
  await ui.openTab(urls.drawing);
  page = await ui.page();
  await ui.setZen(true);
  await ui.screenshot(page, 'zen-drawing');
});
afterAll(async () => {
  await ui?.setZen(false);
  page?.close();
  ui?.close();
});

describe('zen mode on a drawing', () => {
  it('runs the drawing to the bottom edge, with no dark band', async () => {
    const { height } = await ui.viewport(page);
    expect(await ui.pixel(page, 700, height - 2)).not.toEqual([51, 51, 51]);
  });

  it('makes a hidden tab bar’s gutter white, like the drawing’s toolbar', async () => {
    await ui.win('w.setCollapsed(true);');
    await sleep(400);
    const strip = await ui.strip();
    try {
      expect(await ui.pixel(strip, 70, 4)).toEqual([255, 255, 255]);
      await ui.setZen(false);
      expect(await ui.pixel(strip, 70, 4)).toEqual([28, 28, 28]);
    } finally {
      strip.close();
      await ui.win('w.setCollapsed(false);');
    }
  });
});
