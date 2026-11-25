import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { landmarks as L } from '../../src/onshape-dom';
import type { Cdp } from './cdp';
import { HIDE_MS, REVEAL_MS, Ui, sleep } from './harness';
import { urls } from './targets';

// Zen mode on document lists: what hides, balanced spacing, folders, and that
// every kind of list page still shows its documents.
let ui: Ui;
let page: Cdp;
let vp: { width: number; height: number };

beforeAll(async () => {
  ui = await Ui.connect();
  await ui.reset(urls.owned);
  page = await ui.page();
  await ui.setZen(true);
  vp = await ui.viewport(page);
  await ui.screenshot(page, 'zen-list');
});
afterAll(async () => {
  await ui?.setZen(false);
  page?.close();
  ui?.close();
});

const hidden = ['listTitleRow', 'listDetailPanel'] as const;

describe('zen mode on a document list', () => {
  it.each(hidden)('hides %s', async (name) => {
    expect((await ui.landmark(page, name, ['display'])).style.display).toBe(
      'none',
    );
  });

  // Never hidden: Onshape's notices and plan prompts
  // (docs/disclaimer.md).
  const present = (sel: string) =>
    page.eval<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`);
  const shown = async (name: Parameters<Ui['landmark']>[1]) => {
    const at = await ui.landmark(page, name, ['opacity', 'display']);
    expect(at.style.display).not.toBe('none');
    expect(Number(at.style.opacity)).toBe(1);
    expect(at.box.x).toBeGreaterThanOrEqual(0);
    expect(at.box.right).toBeLessThanOrEqual(vp.width);
    expect(at.box.bottom).toBeLessThanOrEqual(vp.height);
    return at;
  };

  it('keeps Onshape’s whole top bar as it is', async () => {
    const bar = await ui.topBar(page);
    expect(bar.height).toBe(40);
    expect(bar.logo.visibility).toBe('visible');
    expect(bar.logo.height).toBe(28);
    expect(bar.othersVisible).toBeGreaterThan(0);
    expect(
      (await ui.landmark(page, 'contentContainer', ['top'])).style.top,
    ).toBe('40px');
  });

  it('keeps the footer line (copyright, Terms & Privacy, version) along the bottom', async () => {
    const footer = await shown('listFooter');
    expect(footer.box.bottom).toBe(vp.height);
    const text = await page.eval<string>(
      `document.querySelector(${JSON.stringify(L.listFooter)}).innerText`,
    );
    expect(text).toMatch(/©.*PTC/);
    expect(text).toMatch(/Terms/);
    // Nothing from the list sits over it.
    const list = await ui.landmark(page, 'listContent');
    expect(list.box.bottom).toBeLessThanOrEqual(footer.box.y);
  });

  it('moves the plan box into the billing banner’s right end, with one Plans and pricing button', async () => {
    if (!(await present(L.listBillingBanner))) return; // Free plans only
    const plan = await shown('listSubscription');
    const banner = await ui.landmark(page, 'listBillingBanner');
    expect(plan.box.y).toBeGreaterThanOrEqual(banner.box.y - 1);
    expect(plan.box.bottom).toBeLessThanOrEqual(banner.box.bottom + 1);
    expect(vp.width - plan.box.right).toBeLessThan(40);
    const plansButtons = await page.eval<number>(
      `[...document.querySelectorAll('button')].filter((b) => /plans and pricing/i.test(b.innerText) && b.getBoundingClientRect().width > 0).length`,
    );
    expect(plansButtons).toBe(1);
    // Painted on top of the banner, and clickable.
    const hit = await page.eval<boolean>(`(() => {
      const r = document.querySelector(${JSON.stringify(L.listSubscription)}).getBoundingClientRect();
      const e = document.elementFromPoint(r.right - 20, r.y + r.height / 2);
      return !!e?.closest(${JSON.stringify(L.listSubscription)});
    })()`);
    expect(hit).toBe(true);
  });

  // Only Free plans show the billing banner, so it may be absent.
  it('keeps the billing banner when there is one', async () => {
    if (!(await present(L.listBillingBanner))) return;
    const banner = await shown('listBillingBanner');
    expect(banner.box.height).toBeGreaterThan(0);
  });

  // Onshape only renders this divider in some states, so it may be absent.
  it('never shows the detail pane’s divider line', async () => {
    const visible = await page.eval<number>(
      `[...document.querySelectorAll(${JSON.stringify(L.listColumnDivider)})].filter((e) => e.getBoundingClientRect().width > 0).length`,
    );
    expect(visible).toBe(0);
  });

  it('hides the welcome and last-opened rows when the page has them', async () => {
    const shown = await page.eval<
      string[]
    >(`[${JSON.stringify(L.listWelcomePane)}, ${JSON.stringify(L.listLastOpenedPane)}]
      .flatMap((s) => [...document.querySelectorAll(s)])
      .filter((e) => e.getBoundingClientRect().height > 0)
      .map((e) => e.innerText.slice(0, 30))`);
    expect(shown).toEqual([]);
  });

  it('hides the left sidebar fully and slides it in from the left edge', async () => {
    const parts = ['listSidebarNew', 'listSidebarFilters'] as const;
    for (const part of parts) {
      const at = await ui.landmark(page, part, ['opacity']);
      expect(at.box.right, part).toBeLessThanOrEqual(0);
      expect(Number(at.style.opacity), part).toBe(0);
    }
    await ui.mouse(page, 'mouseMoved', 5, vp.height / 2);
    await sleep(REVEAL_MS);
    for (const part of parts) {
      expect((await ui.landmark(page, part)).box.x, part).toBe(0);
    }
    await ui.screenshot(page, 'zen-list-sidebar');
    await ui.mouse(page, 'mouseMoved', vp.width / 2, vp.height / 2);
    await sleep(HIDE_MS);
    for (const part of parts) {
      expect(
        (await ui.landmark(page, part)).box.right,
        part,
      ).toBeLessThanOrEqual(0);
    }
  });

  it('balances the content: 24px from both window edges', async () => {
    const table = await ui.landmark(page, 'listTable');
    expect(table.box.x).toBe(24);
    expect(vp.width - table.box.right).toBe(24);
  });

  it('keeps folder cards visible, and the Folders chevron still collapses them', async () => {
    const folders = () =>
      page.eval<number>(`(() => {
        const sp = document.querySelector(${JSON.stringify(L.listSplitter)});
        const pane = [...sp.querySelectorAll(':scope > osx-split-pane')].find((p) => p.innerText.trim().startsWith('Folders'));
        return pane ? Math.round(pane.getBoundingClientRect().height) : -1;
      })()`);
    const open = await folders();
    expect(open).toBeGreaterThan(36 + 50); // header + a row of cards
    const toggle = () =>
      page.eval(`(() => {
        const sp = document.querySelector(${JSON.stringify(L.listSplitter)});
        const pane = [...sp.querySelectorAll(':scope > osx-split-pane')].find((p) => p.innerText.trim().startsWith('Folders'));
        pane.querySelector('.d-inline-flex').click();
      })()`);
    await toggle();
    await sleep(700);
    expect(await folders()).toBe(36);
    await toggle();
    await sleep(700);
    expect(await folders()).toBe(open);
  });

  it.each([
    ['Shared with me', urls.shared],
    ['another filter page', urls.otherFilter],
    ['a Teams page', urls.team],
  ])('shows the document list on %s', async (_name, url) => {
    if (!url) return;
    await page.send('Page.navigate', { url });
    await ui.waitForActiveLoad();
    const docs = await ui.landmark(page, 'listDocumentsPane');
    expect(docs.box.height).toBeGreaterThan(vp.height / 2);
    await ui.screenshot(page, `zen-list-${_name.replace(/\W+/g, '-')}`);
  });

  // Last: it removes the banner from the page to stand in for a paid plan
  // (or a banner selector that stopped matching).
  it('keeps the plan box visible above the footer when there’s no billing banner', async () => {
    if (!(await present(L.listSubscription))) return;
    await page.eval(
      `document.querySelectorAll(${JSON.stringify(L.listBillingBanner)}).forEach((e) => e.remove())`,
    );
    await sleep(300);
    const plan = await shown('listSubscription');
    const footer = await ui.landmark(page, 'listFooter');
    expect(plan.box.bottom).toBe(footer.box.y);
    const hit = await page.eval<boolean>(`(() => {
      const r = document.querySelector(${JSON.stringify(L.listSubscription)}).getBoundingClientRect();
      const e = document.elementFromPoint(r.right - 20, r.y + r.height / 2);
      return !!e?.closest(${JSON.stringify(L.listSubscription)});
    })()`);
    expect(hit).toBe(true);
    await ui.screenshot(page, 'zen-list-no-banner');
  });
});
