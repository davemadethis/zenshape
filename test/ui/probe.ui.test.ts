import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { landmarks, type Landmark } from '../../src/onshape-dom';
import type { Cdp } from './cdp';
import { Ui } from './harness';
import { urls } from './targets';

// `npm run ui:probe`: after an Onshape update, shows which landmarks in
// src/onshape-dom.ts stopped matching and, for each, the elements now sitting
// where it used to be, so the new selector can be read straight off. Runs
// with zen mode off, so everything is in Onshape's own layout.

// Where each landmark lives on Onshape's page, independent of its markup:
// a point (fractions of the viewport, or px when > 1) or some visible text.
type Hint =
  | { at: [number, number] }
  | { text: string }
  | { thin: 'horizontal' | 'vertical'; near: [number, number] };

const hints: Record<
  Landmark,
  {
    page: 'doc' | 'list' | 'both';
    hint: Hint;
    note: string;
    optional?: boolean;
  }
> = {
  topBar: {
    page: 'both',
    hint: { at: [0.5, 15] },
    note: 'dark bar along the top',
  },
  topBarLogo: {
    page: 'both',
    hint: { at: [60, 20] },
    note: 'Onshape logo at the top bar’s left end',
  },
  contentContainer: {
    page: 'both',
    hint: { at: [0.5, 0.6] },
    note: 'fixed box under the top bar (top: 40px)',
  },
  docIconRail: {
    page: 'doc',
    hint: { at: [15, 0.5] },
    note: 'narrow icon column at the far left',
  },
  docTabBar: {
    page: 'doc',
    hint: { at: [0.5, -12] },
    note: 'Part Studio / Assembly tabs along the bottom',
  },
  docToolbar: {
    page: 'doc',
    hint: { at: [0.5, 58] },
    note: 'Sketch / feature toolbar',
  },
  docPanel: {
    page: 'doc',
    hint: { text: 'Features' },
    note: 'feature panel, outer box',
  },
  docPanelInner: {
    page: 'doc',
    hint: { text: 'Features' },
    note: 'feature panel, inner container of sections',
  },
  docPanelDivider: {
    page: 'doc',
    hint: { thin: 'horizontal', near: [100, 0.3] },
    note: '1px lines between panel sections',
  },
  docCanvasColumn: {
    page: 'doc',
    hint: { at: [0.65, 0.5] },
    note: 'column holding the 3D view',
  },
  docForeignFrame: {
    page: 'doc',
    hint: { at: [0.5, 0.5] },
    note: 'box for a drawing or other embedded app (checked in zen-drawing)',
    // The probe's document is a Part Studio, which has none.
    optional: true,
  },
  listPage: {
    page: 'list',
    hint: { at: [0.5, 0.5] },
    note: 'whole document-list page',
  },
  listContent: {
    page: 'list',
    hint: { at: [0.5, 0.5] },
    note: 'content area below the top bar',
  },
  listBillingBanner: {
    page: 'list',
    hint: { text: 'subscription' },
    note: '"Your Free subscription…" banner',
    optional: true,
  },
  listTitleRow: {
    page: 'list',
    hint: { text: 'Owned by me' },
    note: 'page title row ("Owned by me")',
  },
  listDetailPanel: {
    page: 'list',
    hint: { at: [-15, 0.5] },
    note: 'thin button column at the right edge',
  },
  listFooter: {
    page: 'list',
    hint: { text: 'PTC Inc' },
    note: '© footer at the bottom',
  },
  listSidebar: {
    page: 'list',
    hint: { text: 'Recently opened' },
    note: 'left sidebar (Create … Trash)',
  },
  listSidebarNew: {
    page: 'list',
    hint: { text: 'Create' },
    note: 'the sidebar’s Create button bar',
  },
  listSidebarFilters: {
    page: 'list',
    hint: { text: 'Recently opened' },
    note: 'the sidebar’s filter list',
  },
  listSubscription: {
    page: 'list',
    hint: { text: 'Plans and pricing' },
    note: 'plan box at the sidebar’s foot (Subscription: …)',
    optional: true,
  },
  listSection: {
    page: 'list',
    hint: { at: [0.5, 0.5] },
    note: 'row holding sidebar + list',
  },
  listMain: {
    page: 'list',
    hint: { at: [0.5, 0.5] },
    note: 'list area right of the sidebar',
  },
  listColumnDivider: {
    page: 'list',
    hint: { thin: 'vertical', near: [-42, 0.5] },
    note: 'divider before the detail column',
    optional: true,
  },
  listColumnDividerPlaceholder: {
    page: 'list',
    hint: { thin: 'vertical', near: [-42, 0.5] },
    note: 'its placeholder',
    optional: true,
  },
  listGrid: {
    page: 'list',
    hint: { text: 'Modified by' },
    note: 'container of folders + documents',
  },
  listSplitter: {
    page: 'list',
    hint: { text: 'Folders' },
    note: 'grid of panes (folders, documents…)',
  },
  listWelcomePane: {
    page: 'list',
    hint: { text: 'Getting started' },
    note: '"Getting started" pane (Owned by me only)',
    optional: true,
  },
  listLastOpenedPane: {
    page: 'list',
    hint: { text: 'Last opened by me' },
    note: '"Last opened" pane (Owned by me only)',
    optional: true,
  },
  listDocumentsPane: {
    page: 'list',
    hint: { text: 'Modified by' },
    note: 'pane with the document table',
  },
  listFolderCards: {
    page: 'list',
    hint: { text: 'Folders' },
    note: 'folder card grid',
  },
  listTable: {
    page: 'list',
    hint: { text: 'Modified by' },
    note: 'document table',
  },
};

// Runs in the page: element chains (self → ancestors) at a hint.
const findScript = (hint: Hint) => `(() => {
  const W = innerWidth, H = innerHeight;
  const px = (v, size) => (Math.abs(v) <= 1 ? v * size : v < 0 ? size + v : v);
  const d = (el) => {
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 4).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + ' [' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']';
  };
  const chain = (el) => { const out = []; while (el && el !== document.body && out.length < 12) { out.push(d(el)); el = el.parentElement; } return out; };
  const hint = ${JSON.stringify(hint)};
  if (hint.at) return [chain(document.elementFromPoint(px(hint.at[0], W), px(hint.at[1], H)))];
  if (hint.text) {
    const el = [...document.querySelectorAll('body *')].find((e) => e.childElementCount === 0 && e.textContent.includes(hint.text) && e.getBoundingClientRect().width > 0);
    return el ? [chain(el)] : [['(no visible element containing "' + hint.text + '")']];
  }
  const [nx, ny] = [px(hint.near[0], W), px(hint.near[1], H)];
  return [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect();
    const thin = hint.thin === 'horizontal' ? r.height > 0 && r.height <= 2 && r.width > 50 : r.width > 0 && r.width <= 2 && r.height > 100;
    return thin && Math.abs((hint.thin === 'horizontal' ? r.x : r.x) - nx) < 150;
  }).slice(0, 4).map((e) => chain(e).slice(0, 3));
})()`;

const probing = process.env.ZS_PROBE === '1';
let ui: Ui;

beforeAll(async () => {
  if (!probing) return;
  ui = await Ui.connect();
  await ui.reset(urls.owned);
});
afterAll(() => ui?.close());

describe.runIf(probing)('Onshape landmark probe', () => {
  it('reports every landmark', async () => {
    const lines: string[] = [];
    const run = async (kind: 'doc' | 'list', page: Cdp) => {
      lines.push(
        `\n== ${kind === 'doc' ? 'Document page' : 'Document list'} ==`,
      );
      for (const [name, h] of Object.entries(hints) as [
        Landmark,
        (typeof hints)[Landmark],
      ][]) {
        if (h.page !== kind && h.page !== 'both') continue;
        const sel = landmarks[name];
        const n = await page.eval<number>(
          `document.querySelectorAll(${JSON.stringify(sel)}).length`,
        );
        if (n > 0) {
          lines.push(`  ✓ ${name}  ${sel}`);
          continue;
        }
        if (h.optional) {
          lines.push(
            `  – ${name}  ${sel}  (absent; Onshape only shows it sometimes)`,
          );
          continue;
        }
        lines.push(`  ✗ ${name}  ${sel}  (${h.note}) — candidates:`);
        for (const c of await page.eval<string[][]>(findScript(h.hint))) {
          lines.push(`      ${c.join('\n        ← ')}`);
        }
      }
    };
    await run('list', await ui.page());
    await ui.openTab(urls.document);
    await run('doc', await ui.page());
    const report = lines.join('\n');
    console.log(report);
    fs.writeFileSync(path.join(ui.outDir, 'probe.txt'), report);
  });
});
