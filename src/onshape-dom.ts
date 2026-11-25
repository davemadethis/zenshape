// Every piece of Onshape's page that Zenshape depends on, by name. Zen mode's
// CSS and the UI tests (test/ui) both read this, so when Onshape changes its
// front end there's one place to fix: run `npm run ui:probe` to see which
// landmark stopped matching and where it went. Read from the live pages on
// 2026-10-24.

// Page scopes, so a rule only applies to its kind of page.
export const DOC_PAGE = 'body:has(#model-body)';
export const LIST_PAGE = 'body:has(.os-document-list-page-container)';

export const landmarks = {
  // Both page kinds.
  topBar: 'nav.fixed-top.navbar',
  // Onshape's logo, at the top bar's left end (links to the documents page).
  topBarLogo: 'img.navbar-onshape-logo',
  // Holds everything below the top bar; Onshape fixes it 40px from the top.
  contentContainer: 'osx-row.os-content-container',

  // Document pages.
  docIconRail: 'os-vue-panel-selector-component',
  docTabBar: '#os-tab-bar',
  docToolbar: '#osToolbar',
  // The feature panel: an outer box and an inner container whose sections and
  // dividers are absolutely positioned. Both carry .panel-content-pane.
  docPanel: '.left-content-pane-folder',
  docPanelInner: '.panel-content-pane.os-row-splitter-container',
  docPanelDivider:
    '.panel-content-pane.os-row-splitter-container > .os-splitter',
  docCanvasColumn: '.element-column-container',
  // Box for elements drawn by a frame from another app (drawings, PCB, …);
  // Onshape keeps it 30px off the bottom for the tab list.
  docForeignFrame: '#foreign-data-container',

  // Document list pages.
  listPage: '.os-document-list-page-container',
  listContent: '.os-content',
  // Free plans only.
  listBillingBanner: 'osx-billing-banner',
  listTitleRow: 'osx-document-list-action-bar',
  listDetailPanel: '#documentDetailPanel',
  // Copyright, Terms & Privacy and the version, along the bottom.
  listFooter: '.os-items-footer',
  listSidebar: '.os-document-filters-container',
  // The sidebar's parts: the New button bar, the filter list, and the plan
  // box (Subscription: Free, Try Professional, Plans and pricing).
  listSidebarNew: 'osx-document-list-create-menu',
  listSidebarFilters: 'osx-document-filters-component',
  listSubscription: 'osx-subscription-info',
  listSection: '.os-document-section',
  listMain: '.os-main-content-container',
  listColumnDivider: '.os-main-content-container > .os-splitter',
  listColumnDividerPlaceholder:
    '.os-main-content-container > .os-splitter-placeholder',
  listGrid: '.os-document-list-grid-container',
  // A grid of panes (folders, documents, sometimes welcome/last-opened) with
  // gutters between them; the panes differ per page.
  listSplitter: 'osx-splitter.document-list-view-content-splitter',
  listWelcomePane: 'osx-split-pane:has(osx-welcome-mat-section)',
  listLastOpenedPane: 'osx-split-pane:has(osx-document-list-last-opened)',
  listDocumentsPane: 'osx-split-pane.content-view',
  listFolderCards: 'osx-document-grid-view',
  listTable: '.ag-root-wrapper',
} as const;

export type Landmark = keyof typeof landmarks;

// Classes Onshape puts on a bottom tab while you're using it; they exist only
// then, so the probe can't look for them (test/ui/zen-document checks them).
// Its right-click menu itself is added straight to <body>, where nothing says
// which tab it's for.
export const tabStates = {
  menuOpen: 'tab-list-item.context-menu-active',
  renaming: 'tab-list-item.renaming',
};
