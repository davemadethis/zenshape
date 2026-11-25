import type { WebContents } from 'electron';
import {
  DOC_PAGE as DOC,
  LIST_PAGE as LIST,
  landmarks as L,
  tabStates,
} from './onshape-dom';

// WORKAROUND: zen mode restyles Onshape's own page with inserted CSS (no JS,
// no preload). Selectors live in onshape-dom.ts; if Onshape renames one, that
// piece simply stays visible (and `npm run ui:probe` shows where it went).

// Everything zen mode hides or tucks away. Never Onshape's footer (copyright,
// legal links, version) or its plan and billing prompts, and the logo only
// on documents (where the whole top bar goes): see
// docs/disclaimer.md.
const HIDDEN = [
  `${DOC} ${L.topBar}`,
  L.listTitleRow,
  L.listDetailPanel,
  L.listWelcomePane,
  L.listLastOpenedPane,
];
// Hidden, but slide back in while the pointer is at their edge.
const REVEALED = [`${DOC} ${L.docIconRail}`, `${DOC} ${L.docTabBar}`];
// A tab's menu and its rename box take the pointer off the bar; it stays out
// until they're done.
const TAB_BAR_IN_USE = `${DOC} ${L.docTabBar}:has(${tabStates.menuOpen}, ${tabStates.renaming})`;
// The list sidebar slides as parts rather than one box, because the plan box
// inside it moves into the billing banner and must stay visible there, and a
// hidden parent hides its children.
const SIDEBAR = `${LIST} ${L.listSidebar}`;
const SIDEBAR_NEW = `${SIDEBAR} ${L.listSidebarNew}`;
const SIDEBAR_FILTERS = `${SIDEBAR} ${L.listSidebarFilters}`;
const SIDEBAR_PARTS = [SIDEBAR_NEW, SIDEBAR_FILTERS];
const SIDEBAR_HOVERED = `${SIDEBAR}:has(${L.listSidebarNew}:hover, ${L.listSidebarFilters}:hover)`;
const SIDEBAR_PARTS_HOVERED = SIDEBAR_PARTS.map((s) =>
  s.replace(SIDEBAR, SIDEBAR_HOVERED),
);
// Free plans have the banner, and the plan box sits over its right end.
// Without one (paid plans, or the banner's selector stopped matching) it sits
// just above the footer instead: never hidden either way.
const PLAN = `${LIST} ${L.listSubscription}`;
const BANNER_PAGE = `${LIST}:has(${L.listBillingBanner})`;
const NO_BANNER_PLAN = `${LIST}:not(:has(${L.listBillingBanner})) ${L.listSubscription}`;
const ANIMATED = [...HIDDEN, ...REVEALED, ...SIDEBAR_PARTS];

export const FADE_MS = 450;
// Edge bars slide in a little slower than they slide out.
const SLIDE_IN_MS = 320;
const SLIDE_OUT_MS = 250;
// How long a revealed bar stays after the pointer leaves it.
const LINGER_MS = 300;

// Kept on the page for the whole animation in both directions: a transition
// only runs if the *after* style still has it, so removing the fade sheet
// alone would snap back instead of fading in.
const BASE_CSS = `${ANIMATED.join(',\n')} {
  transition: opacity ${FADE_MS}ms ease, transform ${SLIDE_IN_MS}ms ease !important;
}`;

const FADE_CSS = `${ANIMATED.join(',\n')} {
  opacity: 0 !important;
}`;

// Empty strip kept along the left and bottom of document pages: nothing sits
// against those edges, and mousing into it reveals the hidden bar.
const GUTTER = '12px';
// Onshape's top bar and its billing banner below it, on list pages.
const TOP_BAR = '40px';
const BANNER = '50px';
// Onshape's footer line, along the bottom of list pages.
const FOOTER = '30px';
const SPLITTER = L.listSplitter;
const COLLAPSE_CSS = `
/* Documents get the whole window: no top bar at all. Every other page keeps
   Onshape's top bar as it is. */
${DOC} ${L.contentContainer} { top: 0 !important; }
${HIDDEN.join(',\n')},
${SPLITTER} > .gutter { display: none !important; }

/* List pages: folders shrink to fit, the document list takes the rest. The
   splitter is a grid whose rows differ per page (Owned by me has welcome and
   last-opened rows; Shared, Trash, Teams… don't), so lay it out as a flex
   column instead of rewriting a template that assumes one structure. */
${SPLITTER} {
  display: flex !important;
  flex-direction: column !important;
}
${SPLITTER} > osx-split-pane:not(.content-view) {
  flex: 0 0 auto !important;
}
${SPLITTER} > ${L.listDocumentsPane} {
  flex: 1 1 auto !important;
  min-height: 44px !important;
}
/* Collapsing Folders makes Onshape write a fixed 36px folders row into the
   inline grid-template (expanded, it's minmax(36px, 40fr)); follow it so the
   chevron still works. */
${SPLITTER}[style*="36px 16px"]
  > osx-split-pane:has(${L.listFolderCards}, osx-document-list-folders, .section-header):not(.content-view) {
  height: 36px !important;
  overflow: hidden !important;
}
/* The folder cards' virtual scroller has no height of its own once the row
   is auto-sized; one row of cards is 60px. Not while the section is collapsed. */
${SPLITTER}:not([style*="36px 16px"])
  > osx-split-pane:has(${L.listFolderCards}):not(.content-view)
  cdk-virtual-scroll-viewport { min-height: 64px !important; }
${LIST} ${L.listSection} { position: relative !important; }
/* With the detail pane gone, drop its draggable divider and let the list use
   the full width. The splitter positions it absolutely with an inline width,
   hence !important. 12px
   each side + the list's own 12px inset = 24px from both window edges,
   counting the left hover gutter. */
${LIST} ${L.listColumnDivider},
${LIST} ${L.listColumnDividerPlaceholder} { display: none !important; }
${LIST} ${L.listGrid} {
  left: 0 !important;
  right: 0 !important;
  width: auto !important;
  flex: 1 1 auto !important;
  padding: 0 ${GUTTER} !important;
  box-sizing: border-box !important;
}

/* Edge reveals: out of the layout and fully off-screen. Each keeps an
   invisible ::after hanging back on-screen over the gutter, so hovering the
   empty edge counts as hovering the bar and slides it in. */
${REVEALED.join(',\n')} {
  position: absolute !important;
}
${[...REVEALED, ...SIDEBAR_PARTS].join(',\n')} {
  /* Above Onshape's toolbar (z-index 1004) and the panel's lines. */
  z-index: 2000 !important;
  overflow: visible !important;
  /* Invisible at rest, not just off-screen: otherwise the moment this sheet
     lands, the bar reappears at full opacity before sliding away. */
  opacity: 0 !important;
  transition:
    opacity ${SLIDE_OUT_MS}ms ease ${LINGER_MS}ms,
    transform ${SLIDE_OUT_MS}ms ease ${LINGER_MS}ms !important;
}
${[...REVEALED, SIDEBAR_NEW].map((s) => `${s}::after`).join(',\n')} {
  content: '';
  position: absolute;
}
${DOC} ${L.docIconRail} {
  left: 0 !important; top: 0 !important; bottom: 0 !important;
  transform: translateX(-100%);
}
${DOC} ${L.docIconRail}::after {
  top: 0; bottom: 0; left: 100%; width: ${GUTTER};
}
/* The sidebar box itself stays put, see-through and click-through; its parts
   stack in it as a full-height column and slide off together. */
${SIDEBAR} {
  position: absolute !important;
  left: 0 !important; top: 0 !important; bottom: 0 !important;
  z-index: 2000 !important;
  display: flex !important;
  flex-direction: column !important;
  background: none !important;
  pointer-events: none !important;
}
${SIDEBAR} > * { flex: 0 0 auto !important; }
${SIDEBAR} > :has(${L.listSidebarFilters}) {
  flex: 1 1 auto !important;
  display: flex !important;
  flex-direction: column !important;
}
${SIDEBAR_NEW} { display: block !important; }
${SIDEBAR_FILTERS} { flex: 1 1 auto !important; }
${SIDEBAR_PARTS.join(',\n')} {
  position: relative !important;
  background: #2b2b2b;
  pointer-events: auto !important;
  transform: translateX(-100%);
}
/* The hover strip hangs off the top part but runs the window's full height. */
${SIDEBAR_NEW}::after {
  top: 0; height: 100vh; left: 100%; width: ${GUTTER};
}
/* On Free plans the plan box takes the place of the banner's own Plans and
   pricing button, at the banner's right end, as one row (so that button isn't
   shown twice). */
${BANNER_PAGE} ${L.listBillingBanner} osx-plan-upgrade { display: none !important; }
${PLAN} {
  position: fixed !important;
  right: 20px !important;
  z-index: 2001 !important;
  display: flex !important;
  align-items: center !important;
  pointer-events: auto !important;
}
${BANNER_PAGE} ${L.listSubscription} {
  top: ${TOP_BAR} !important;
  height: ${BANNER} !important;
}
${NO_BANNER_PLAN} {
  bottom: ${FOOTER} !important;
  height: ${BANNER} !important;
  padding: 0 0 0 12px !important;
  background: #2b2b2b !important;
}
${PLAN} :is(div, osx-plan-upgrade) {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 8px !important;
  height: auto !important;
  width: auto !important;
  margin: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
${PLAN} .btn {
  width: auto !important;
  margin: 0 !important;
}
${DOC} ${L.docTabBar} {
  left: 0 !important; right: 0 !important; bottom: 0 !important;
  transform: translateY(100%);
}
${DOC} ${L.docTabBar}::after {
  left: 0; right: 0; bottom: 100%; height: ${GUTTER};
}
/* Once a bar has slid in, its hover strip shrinks away so it doesn't sit
   over content. The delay matters: shrinking it at once would leave nothing
   under the pointer mid-slide, and the bar would slide straight back out. */
${DOC} ${L.docIconRail}:hover::after,
${SIDEBAR_HOVERED} ${L.listSidebarNew}::after {
  width: 0; transition: width 0s ${SLIDE_IN_MS + 40}ms;
}
${DOC} ${L.docTabBar}:hover::after {
  height: 0; transition: height 0s ${SLIDE_IN_MS + 40}ms;
}
/* The gutter is padding inside the panel and the toolbar, not space beside
   them, so their backgrounds and lines still reach the window's edge. The
   panel runs to the bottom edge (no bottom border); only the 3D view column
   keeps a bottom gutter. */
${DOC} ${L.docToolbar} {
  padding-left: ${GUTTER} !important;
  box-sizing: border-box !important;
}
/* The panel's sections are absolutely positioned, so they're inset by offset
   rather than padding. */
${DOC} ${L.docPanelInner} > :not(.os-splitter) {
  left: ${GUTTER} !important;
  right: 0 !important;
  width: auto !important;
}
${DOC} ${L.docPanel} {
  padding-bottom: ${GUTTER} !important;
  border-bottom: none !important;
  box-sizing: border-box !important;
}
/* The section dividers stay full width, running to the window edge. */
${DOC} ${L.docPanelDivider} {
  left: 0 !important;
  right: 0 !important;
  width: auto !important;
}
${DOC} ${L.docCanvasColumn} {
  padding-bottom: ${GUTTER} !important;
  box-sizing: border-box !important;
}
/* Drawings and other embedded apps run to the bottom edge, like the left:
   their own background is the gutter, and the tab list's hover strip still
   sits over it. */
${DOC} ${L.docForeignFrame} {
  bottom: 0 !important;
}
${[
  ...REVEALED.map((s) => `${s}:hover`),
  TAB_BAR_IN_USE,
  ...SIDEBAR_PARTS_HOVERED,
].join(',\n')} {
  transform: none !important;
  opacity: 1 !important;
  transition:
    opacity 160ms ease,
    transform ${SLIDE_IN_MS}ms ease !important;
}
`;

type Sheet = 'base' | 'fade' | 'collapse';
const CSS: Record<Sheet, string> = {
  base: BASE_CSS,
  fade: FADE_CSS,
  collapse: COLLAPSE_CSS,
};

// Tracks which zen sheets are on one page so they can be removed exactly.
export class ZenSheets {
  private keys = new Map<Sheet, string>();

  constructor(private readonly contents: WebContents) {
    // A new document starts with none of our CSS. Cleared on commit, not on
    // start: a navigation can start and then be cancelled (external links,
    // a locked tab's out-of-scope load), leaving the old page and its CSS.
    contents.on('did-navigate', () => this.keys.clear());
  }

  async add(sheet: Sheet): Promise<void> {
    if (this.keys.has(sheet) || this.contents.isDestroyed()) return;
    const key = await this.contents.insertCSS(CSS[sheet]);
    this.keys.set(sheet, key);
  }

  async remove(sheet: Sheet): Promise<void> {
    const key = this.keys.get(sheet);
    this.keys.delete(sheet);
    if (key && !this.contents.isDestroyed()) {
      await this.contents.removeInsertedCSS(key);
    }
  }

  // For a page that loads while zen mode is already on: no animation. The
  // base sheet stays so the edge reveals still slide.
  async applyAll(): Promise<void> {
    await Promise.all([
      this.add('base'),
      this.add('fade'),
      this.add('collapse'),
    ]);
  }
}
