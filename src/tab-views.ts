import {
  BaseWindow,
  Menu,
  clipboard,
  WebContentsView,
  app,
  ipcMain,
  screen,
  shell,
  type BaseWindowConstructorOptions,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { stripMenuTemplate, stripOwnItems } from './app-menu';
import { randomUUID } from 'node:crypto';
import type { CanSave, Field, SavedSignIn } from './saved-sign-in';
import {
  FillState,
  pressed,
  fillField,
  pressReturn,
  readField,
  takeReading,
  type FillPage,
} from './sign-in-fill';
import { guard } from './sign-in-focus';
import { TIMING, signIn, type SignInStep } from './sign-in-sequence';
import { signInLog, where } from './sign-in-log';
import {
  ONSHAPE_HOME,
  decideWindowOpen,
  inLockScope,
  isDocumentUrl,
  isDrawingFrameFor,
  isHttpUrl,
  isOnshapeUrl,
  isSignInPage,
} from './navigation';
import {
  clampRatio,
  edgeZone,
  inSplit,
  paneAt,
  partner,
  placeAt,
  rotated,
  splitLayout,
  swapped,
  zoneRect,
  type Rect,
  type Split,
  type Zone,
} from './split';
import {
  STRIP_COMMAND_CHANNEL,
  STRIP_STATE_CHANNEL,
  type StripCommand,
  type StripState,
} from './strip-api';
import { isStripHidden } from './app-state';
import { TabList, displayName, type PersistedTabs } from './tabs';
import { onshapeWebPreferences, stripWebPreferences } from './web-preferences';
import { FADE_MS, ZenSheets } from './zen';

export const STRIP_HEIGHT = 36;
const TRAFFIC_LIGHTS = { x: 12, y: 11 };
const STRIP_COLOR = '#1c1c1c';
// A hidden tab bar leaves this much empty space along the top; hovering it
// slides the tab bar back down (like zen mode's hidden bars).
const STRIP_GUTTER = 12;
// In macOS full screen, pushing on the screen's top edge brings down macOS's
// own bar (the window controls); a 12px gutter left too little room to stop
// short of it, so bringing the tab bar down took slow, careful movement.
const FULLSCREEN_GUTTER = 24;
// Linux's overlay buttons are never under 20px: at 12px they hung off the
// gutter onto the page, and at 20px they touched both edges (0px above and
// below). At 36px they're 24px with 6px above and below, so centered; at 26px
// they're 24px with 1px above and below (smoke screenshots, docs/tab-views.md).
const LINUX_GUTTER = 26;
// What's at the top of the page under a hidden tab bar (StripState.gutter).
const GUTTER_COLORS: Record<StripState['gutter'], string> = {
  bar: STRIP_COLOR,
  drawing: '#ffffff',
  zen: '#333333',
};
const PEEK_OUT_MS = 250;
const SPLASH_MS = 2500;
// Matches the splash page's fade-out (strip.css).
const SPLASH_FADE_MS = 300;
const SIGN_IN_TITLE = 'Sign in';
// A tab bounced to sign-in again this soon after coming back is passing
// through an auto-continuing sign-in page, not being asked to log in.
const SIGN_IN_LOOP_MS = 10_000;
// How long a tab held by the loop breaker may sit on a sign-in page before
// it counts as a real sign-in after all.
const SIGN_IN_SETTLE_MS = 2_000;
// Titles Onshape shows while loading or signing in; they say nothing about the tab.
const PLACEHOLDER_TITLES = new Set(['', 'Onshape', SIGN_IN_TITLE]);

export interface ZenshapeWindowOptions {
  bounds: BaseWindowConstructorOptions;
  maximized: boolean;
  restore: PersistedTabs;
  collapsed: boolean;
  zen: boolean;
  hideStripInZen: boolean;
  preload: string;
  // `mode` picks what our page renders: the strip, or the split divider.
  loadStrip: (contents: WebContents, mode: OurViewMode) => void;
  onChange: () => void;
  savedSignIn: SavedSignIn;
  // A short message for the user, shown by main.
  notify: (message: string) => void;
  // The menu bar's menus, as of now; off macOS the Z's menu carries them.
  appMenu: () => MenuItemConstructorOptions[];
}

// Our page renders one of: the tab strip, the split divider, or the drop
// preview shown while a tab is dragged over the pages.
export type OurViewMode = 'strip' | 'divider' | 'overlay' | 'splash';

// macOS draws its traffic lights over our strip; Windows and Linux get
// Electron's overlay of their own minimize/maximize/close, painted like it.
export function windowControls(
  platform: NodeJS.Platform = process.platform,
): BaseWindowConstructorOptions {
  if (platform === 'darwin') return { trafficLightPosition: TRAFFIC_LIGHTS };
  return {
    titleBarOverlay: {
      color: STRIP_COLOR,
      symbolColor: '#ffffff',
      height: STRIP_HEIGHT,
    },
  };
}

// The smoke test can't always read a native menu from outside (UI
// Automation on Windows), so with ZENSHAPE_TRACE_MENUS=1 the Z's menu says
// on stdout what it opened with and how long it stayed open.
function traceMenu(message: string): void {
  if (process.env.ZENSHAPE_TRACE_MENUS === '1')
    console.log(`strip menu: ${message}`);
}

// Input events that aren't a press on the page: moves, wheels, and keys
// (counted from before-input-event instead).
const NOT_A_PRESS = new Set([
  'mouseMove',
  'mouseEnter',
  'mouseLeave',
  'mouseWheel',
  'mouseUp',
  'touchMove',
  'touchEnd',
  'touchCancel',
  'rawKeyDown',
  'keyDown',
  'keyUp',
  'char',
  'gestureScrollBegin',
  'gestureScrollUpdate',
  'gestureScrollEnd',
  'gestureFlingStart',
  'gestureFlingCancel',
  'gesturePinchBegin',
  'gesturePinchUpdate',
  'gesturePinchEnd',
]);

// The saved-login path reads the sign-in page's focus this often.
const AUTOFILL_MS = 250;
// How long the step list stays up after a run: long enough to see the check,
// or which step stopped and why.
const SIGNED_IN_SHOWN_MS = 600;
const STOPPED_SHOWN_MS = 2500;

const STEP_ORDER: SignInStep[] = ['save', 'email', 'password', 'done'];
const next = (step: SignInStep): SignInStep =>
  STEP_ORDER[Math.min(STEP_ORDER.indexOf(step) + 1, STEP_ORDER.length - 1)];

function openExternal(url: string): void {
  if (isHttpUrl(url)) void shell.openExternal(url);
}

function isStripCommand(cmd: unknown): cmd is StripCommand {
  const c = cmd as StripCommand;
  switch (c?.type) {
    case 'new-tab':
    case 'peek':
    case 'unpeek':
    case 'strip-menu':
    case 'toggle-zen':
    case 'go-back':
    case 'go-forward':
    case 'divider-start':
    case 'divider-end':
    case 'drag-page-end':
    case 'split-swap':
    case 'split-rotate':
    case 'dismiss-splash':
    case 'open-update':
      return true;
    case 'drag-page':
    case 'drop-page':
      return (
        typeof c.id === 'string' && Number.isFinite(c.x) && Number.isFinite(c.y)
      );
    case 'split-onto':
      return typeof c.id === 'string' && typeof c.target === 'string';
    case 'divider-move':
      return Number.isFinite(c.ratio);
    case 'sign-in':
      return (
        typeof c.email === 'string' &&
        c.email.length <= 1024 &&
        (c.password === null ||
          (typeof c.password === 'string' &&
            c.password.length > 0 &&
            c.password.length <= 1024))
      );
    case 'controls-height':
      return Number.isFinite(c.height);
    case 'select':
    case 'close':
    case 'context-menu':
      return typeof c.id === 'string';
    case 'move':
      return (
        typeof c.id === 'string' &&
        (c.before === null || typeof c.before === 'string')
      );
    case 'rename':
      return (
        typeof c.id === 'string' &&
        (c.name === null || typeof c.name === 'string')
      );
    default:
      return false;
  }
}

export class ZenshapeWindow {
  readonly window: BaseWindow;
  private readonly strip: WebContentsView;
  private readonly divider: WebContentsView;
  private readonly overlay: WebContentsView;
  private readonly splash: WebContentsView;
  private splashMode: StripState['splash'] = null;
  private savedSignInError: string | null = null;
  // The saved email as shown on the Saved Sign-in page (decrypted for that
  // page only; the password never is), and whether a login is saved.
  private shownEmail: string | null = null;
  // The Sign in button's run, as the page's step list shows it.
  private signInRun: StripState['signInRun'] = null;
  // From the Sign in button's press until its run ends: a second press, or
  // the page reopening, can't start another (the save may wait on the
  // keychain). Not cleared by showSplash.
  private signInBusy = false;
  private endRunTimer: NodeJS.Timeout | undefined;
  // The last sign-in tab finishSignIn completed: a run that sees its tab go
  // was signed in only if it went this way.
  private signedInTab: string | null = null;
  // Tabs held on a sign-in page by the loop breaker, rechecked shortly.
  private readonly recheck = new Map<string, NodeJS.Timeout>();
  // The sign-in page's view while the debugger is attached to it, to read
  // which field a click focused.
  private watched: {
    contents: WebContents;
    // The fill routine's view of the page, and its per-page state (what's
    // filled, the one-fill lock, the account verdict).
    page: FillPage;
    fills: FillState;
    off: () => void;
  } | null = null;
  private splashTimer: NodeJS.Timeout | undefined;
  private update: StripState['update'] = null;
  // Where a tab dragged over the pages would land (overlay coordinates).
  private dropPreview: Rect | null = null;
  private readonly list = new TabList(randomUUID);
  private readonly views = new Map<string, WebContentsView>();
  // An adopted popup's tab → the tab whose page opened it, so a popup that
  // closes itself lands back there.
  private readonly openers = new Map<string, string>();
  private collapsed: boolean;
  private hideStripInZen: boolean;
  // Hidden tab bar currently slid down by hovering the gutter, and whether
  // it's still sliding back up (the view stays full height until it has).
  private peeked = false;
  private peekClosing = false;
  private peekTimer: NodeJS.Timeout | undefined;
  // Windows: how tall its caption buttons really are under a hidden tab bar
  // (read by the strip; null until it has, or after anything that may change
  // it). Windows won't shrink them below its caption height, so the gutter
  // grows to hold them instead.
  private hiddenControls: number | null = null;
  private overlayGutter: StripState['gutter'] | null = null;
  private menuOpen = false;
  // The sign-in tab, and the tab to go back to once signed in.
  private signInId: string | null = null;
  private returnTo: string | null = null;
  private renamingId: string | null = null;
  private readonly returnedAt = new Map<string, number>();
  private lastLeave: { url: string; at: number } | null = null;
  private split: Split | null = null;
  // While the divider is dragged, its view covers the page area so the
  // pointer never leaves it.
  private draggingDivider = false;
  private zen: boolean;
  private readonly zenSheets = new Map<WebContents, ZenSheets>();
  // Bumped on every toggle so a stale animation step stops early.
  private zenRun = 0;
  // Electron destroys the window before 'closed', and its pages die a task
  // later and keep sending events until then; the window itself can't be
  // asked, and the strip outlives it, so teardown keeps its own state.
  private closed = false;

  constructor(private readonly opts: ZenshapeWindowOptions) {
    this.collapsed = opts.collapsed;
    this.hideStripInZen = opts.hideStripInZen;
    this.zen = opts.zen;
    this.window = new BaseWindow({
      ...opts.bounds,
      title: 'Zenshape',
      titleBarStyle: 'hidden',
      ...windowControls(),
      backgroundColor: STRIP_COLOR,
      minWidth: 480,
      minHeight: 320,
    });
    if (opts.maximized) this.window.maximize();

    this.divider = this.ourView('divider');
    this.divider.setVisible(false);
    this.overlay = this.ourView('overlay');
    this.overlay.setVisible(false);
    this.strip = this.ourView('strip');
    // Last, so it's above everything.
    this.splash = this.ourView('splash');
    this.splash.setVisible(false);

    ipcMain.on(STRIP_COMMAND_CHANNEL, this.onCommand);
    this.window.on('resize', () => this.layout());
    this.window.on('enter-full-screen', () => this.fullScreenChanged());
    this.window.on('leave-full-screen', () => this.fullScreenChanged());
    this.window.on('maximize', () => this.remeasureControls());
    this.window.on('unmaximize', () => this.remeasureControls());
    screen.on('display-metrics-changed', this.remeasureControls);
    this.window.on('closed', () => this.dispose());

    this.restore(opts.restore);
    this.showWindowButtons(!this.stripHidden);
    this.layout();
  }

  // --- tabs ----------------------------------------------------------------

  newTab(url = ONSHAPE_HOME): void {
    const tab = this.list.open({ url });
    this.ensureView(tab.id);
    this.changed();
  }

  closeTab(id = this.list.activeId): void {
    if (!id) return;
    const view = this.views.get(id);
    if (view) {
      this.window.contentView.removeChildView(view);
      view.webContents.close();
      this.views.delete(id);
    }
    if (id === this.signInId) this.signInId = this.returnTo = null;
    if (id === this.returnTo) this.returnTo = null;
    this.openers.delete(id);
    const mate = partner(this.split, id);
    if (mate) {
      this.split = null;
      if (this.list.activeId === id) this.list.select(mate);
    }
    const next = this.list.close(id);
    if (!next) {
      this.window.close();
      return;
    }
    this.ensureView(next);
    this.changed();
  }

  selectTab(id: string | null): void {
    if (!id || !this.list.select(id)) return;
    this.ensureView(id);
    const mate = partner(this.split, id);
    if (mate) this.ensureView(mate);
    this.changed();
  }

  selectNumber(n: number): void {
    this.selectTab(this.list.selectNumber(n));
  }

  cycleTab(step: 1 | -1): void {
    this.selectTab(this.list.cycle(step));
  }

  // Tab dropped onto another tab in the strip. Onto half of the visible split:
  // it takes that half's place. Onto any other tab: the two split, dropped
  // tab on the right.
  splitOnto(id: string, target: string): void {
    if (id === target || !this.canSplit(id) || !this.canSplit(target)) return;
    const s = this.split;
    if (s && inSplit(s, target) && !inSplit(s, id)) {
      this.split = s.a === target ? { ...s, a: id } : { ...s, b: id };
    } else if (s && inSplit(s, target) && inSplit(s, id)) {
      this.split = swapped(s);
    } else {
      this.split = placeAt(target, id, 'right');
    }
    this.showSplit(id);
  }

  // Tab dropped on the page. With a split on screen, a tab from outside it
  // replaces the pane under the pointer; a tab already in it moves to that
  // edge. Otherwise the dropped tab splits the page with the active tab.
  dropOnPage(id: string, x: number, y: number): void {
    this.hideDropPreview();
    const plan = this.planDrop(id, x, y);
    if (!plan) return;
    this.split = plan.split;
    this.showSplit(id);
  }

  // Right-click → Move to …: the tab goes to that edge of its split.
  moveInSplit(id: string, zone: Zone): void {
    const other = partner(this.split, id);
    if (!other || !this.split) return;
    this.split = { ...placeAt(other, id, zone), ratio: 0.5 };
    this.changed();
  }

  swapSplit(): void {
    if (!this.split) return;
    this.split = swapped(this.split);
    this.changed();
  }

  rotateSplit(): void {
    if (!this.split) return;
    this.split = rotated(this.split);
    this.changed();
  }

  unsplit(): void {
    this.split = null;
    this.changed();
  }

  get isZen(): boolean {
    return this.zen;
  }

  // Fade Onshape's chrome out (then close up the space), or the reverse.
  // Only CSS is inserted or removed; see zen.ts.
  async setZen(on: boolean): Promise<void> {
    if (on === this.zen) return;
    this.zen = on;
    this.stripVisibilityChanged();
    const run = ++this.zenRun;
    const sheets = [...this.zenSheets.values()];
    const all = (fn: (s: ZenSheets) => Promise<void>) =>
      Promise.all(sheets.map(fn));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await all((s) => s.add('base'));
    if (on) {
      await all((s) => s.add('fade'));
      await wait(FADE_MS);
      if (run !== this.zenRun) return;
      await all((s) => s.add('collapse'));
      this.nudge();
    } else {
      await all((s) => s.remove('collapse'));
      this.nudge();
      await wait(50);
      if (run !== this.zenRun) return;
      await all((s) => s.remove('fade'));
      await wait(FADE_MS);
      if (run !== this.zenRun) return;
      await all((s) => s.remove('base'));
    }
  }

  // A real 1px resize, so Onshape re-lays out its canvas after the CSS change
  // without any script in its page.
  private nudge(): void {
    for (const view of this.views.values()) {
      if (!view.getVisible()) continue;
      const b = view.getBounds();
      view.setBounds({ ...b, width: b.width - 1 });
    }
    setTimeout(() => this.layout(), 60);
  }

  setLocked(id: string, locked: boolean): void {
    const tab = this.list.get(id);
    if (!tab) return;
    this.list.setLocked(id, locked ? tab.url : null);
    this.changed();
  }

  // Back/forward for the active tab (strip buttons, menu, mouse buttons over
  // the strip). Mouse buttons over a page act on that page instead.
  goBack(contents = this.activeContents): void {
    this.goHistory(contents, -1);
  }

  goForward(contents = this.activeContents): void {
    this.goHistory(contents, 1);
  }

  // History navigation never raises will-navigate, so a locked tab checks the
  // entry first: one outside its lock opens beside it, as a link would.
  private goHistory(contents: WebContents | undefined, step: 1 | -1): void {
    const history = contents?.navigationHistory;
    if (!contents || !history) return;
    const index = history.getActiveIndex() + step;
    if (index < 0 || index >= history.length()) return;
    const id = this.idFor(contents);
    const locked = id ? this.list.get(id)?.lockedUrl : undefined;
    const url = history.getEntryAtIndex(index)?.url;
    if (
      id &&
      locked &&
      url &&
      !isSignInPage(url) &&
      !inLockScope(locked, url)
    ) {
      this.openFromLocked(id, url);
      return;
    }
    if (step < 0) history.goBack();
    else history.goForward();
  }

  get activeContents(): WebContents | undefined {
    const id = this.list.activeId;
    return id ? this.views.get(id)?.webContents : undefined;
  }

  // A tab opened only to start a download (an export) has nothing to show.
  closeIfBlank(contents: WebContents): void {
    for (const [id, view] of this.views) {
      if (view.webContents !== contents) continue;
      const url = contents.getURL();
      if (url === '' || url === 'about:blank') this.closeTab(id);
      return;
    }
  }

  setPinned(id: string, pinned: boolean): void {
    this.list.setPinned(id, pinned);
    this.changed();
  }

  // Drag-to-reorder from the strip; the model keeps it inside its group.
  moveTab(id: string, before: string | null): void {
    // Dragging a split tab back into the strip takes it out of the split.
    if (inSplit(this.split, id)) this.split = null;
    this.list.move(id, before);
    this.changed();
  }

  // --- strip -----------------------------------------------------------------

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  get hidesStripInZen(): boolean {
    return this.hideStripInZen;
  }

  // Whether the tab bar is hidden right now (by the user, or by zen mode).
  get stripHidden(): boolean {
    return isStripHidden({
      stripCollapsed: this.collapsed,
      zen: this.zen,
      hideStripInZen: this.hideStripInZen,
    });
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.stripVisibilityChanged();
  }

  setHideStripInZen(hide: boolean): void {
    this.hideStripInZen = hide;
    this.stripVisibilityChanged();
  }

  private stripVisibilityChanged(): void {
    clearTimeout(this.peekTimer);
    this.peeked = this.peekClosing = false;
    this.showWindowButtons(!this.stripHidden);
    this.changed();
  }

  // WORKAROUND: repeated setWindowButtonVisibility calls in full screen hide macOS's buttons; set once, then leave.
  // In full screen macOS draws the buttons in its own slide-down bar. They
  // must be on there (or there's no way out of full screen). One call as full
  // screen starts is fine; calling it on every peek, even with `true`,
  // knocked them out of that bar. So: on once, then left alone until it ends.
  // Off macOS there's no such bar: the overlay just follows the tab bar (in
  // full screen Windows and Linux draw no controls).
  private fullScreenChanged(): void {
    if (process.platform !== 'darwin')
      this.showWindowButtons(!this.stripHidden || this.peeked);
    else if (this.window.isFullScreen()) this.setWindowButtons(true);
    else this.showWindowButtons(!this.stripHidden || this.peeked);
    // The gutter's height depends on full screen, and the window's last
    // resize can land before isFullScreen() changes.
    this.layout();
    this.push();
  }

  // Only our hidden tab bar's gutter needs them gone.
  private showWindowButtons(visible: boolean): void {
    if (this.window.isFullScreen()) return;
    this.setWindowButtons(visible);
  }

  // Window buttons over our strip are macOS's traffic lights, or Electron's
  // title bar overlay on Windows and Linux. Each platform has only its own
  // call; setWindowButtonVisibility off macOS threw mid-constructor. The
  // overlay can't be hidden, only shrunk into the gutter and painted its
  // color, so the two read as one band (docs/tab-views.md).
  private setWindowButtons(visible: boolean): void {
    if (process.platform === 'darwin') {
      this.window.setWindowButtonVisibility(visible);
      return;
    }
    this.overlayGutter = visible ? null : this.gutter();
    const color = visible ? STRIP_COLOR : GUTTER_COLORS[this.gutter()];
    this.window.setTitleBarOverlay({
      // 0 = Windows' own minimum, which it then reports as the real height.
      height: visible
        ? STRIP_HEIGHT
        : process.platform === 'win32'
          ? 0
          : LINUX_GUTTER,
      color,
      symbolColor: color === GUTTER_COLORS.drawing ? STRIP_COLOR : '#ffffff',
    });
  }

  // Height of a hidden tab bar's gutter, for the layout here and the strip's
  // CSS alike. Until Windows' buttons are measured, the full strip height:
  // the strip view must be taller than them to see their real height.
  private get gutterHeight(): number {
    if (process.platform === 'win32')
      return this.hiddenControls ?? STRIP_HEIGHT;
    if (process.platform === 'linux') return LINUX_GUTTER;
    return this.window.isFullScreen() ? FULLSCREEN_GUTTER : STRIP_GUTTER;
  }

  // The strip reports the overlay's height as Electron passes it, clipped to
  // the strip view; only the hidden, unpeeked overlay (at 0) is Windows' own.
  private controlsMeasured(reported: number): void {
    if (process.platform !== 'win32' || !this.stripHidden || this.peeked)
      return;
    if (this.window.isFullScreen()) return;
    // Fractional at other scalings or zoom levels, and setBounds throws on
    // those; rounding up also keeps the buttons inside the gutter.
    const height = Math.ceil(reported);
    if (height <= 0 || height > STRIP_HEIGHT) return;
    if (height === this.hiddenControls) return;
    this.hiddenControls = height;
    this.layout();
    this.push();
  }

  // A view as short as the buttons can't see them grow (its report is
  // clipped), so anything that may change their height starts over.
  private readonly remeasureControls = (): void => {
    if (this.hiddenControls === null || this.closed) return;
    this.hiddenControls = null;
    this.layout();
    this.push();
  };

  // Hovering the gutter of a hidden tab bar slides it down over the page.
  private peek(): void {
    if (!this.stripHidden) return;
    clearTimeout(this.peekTimer);
    this.peeked = true;
    this.peekClosing = false;
    this.showWindowButtons(true);
    this.layout();
    this.push();
  }

  // The strip slides back up first; the view shrinks to the gutter after.
  // Resizing the strip view fires a pointer-leave even when the mouse hasn't
  // moved, so the cursor is checked first; if it's still over the strip, keep
  // checking until it really leaves (there may be no second leave event).
  private unpeek(): void {
    if (!this.peeked || this.menuOpen || this.closed) return;
    // An open rename keeps the strip down wherever the pointer is.
    if (this.cursorOverStrip() || this.renamingId) {
      clearTimeout(this.peekTimer);
      this.peekTimer = setTimeout(() => this.unpeek(), 250);
      return;
    }
    this.peeked = false;
    this.peekClosing = true;
    this.showWindowButtons(false);
    this.push();
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => {
      this.peekClosing = false;
      if (!this.closed) this.layout();
    }, PEEK_OUT_MS);
  }

  // Native menus can make the strip think the pointer left; once one closes,
  // hide a peeked strip only if the pointer really is outside it.
  private popup(menu: Menu, labels?: string[]): void {
    this.menuOpen = true;
    const opened = Date.now();
    if (labels) traceMenu(`opened: ${labels.join(' | ')}`);
    menu.popup({
      window: this.window,
      callback: () => {
        if (labels) traceMenu(`closed after ${Date.now() - opened} ms`);
        this.menuOpen = false;
        if (this.peeked) this.unpeek();
      },
    });
  }

  private cursorOverStrip(): boolean {
    const p = screen.getCursorScreenPoint();
    const b = this.window.getContentBounds();
    return (
      p.x >= b.x &&
      p.x < b.x + b.width &&
      p.y >= b.y &&
      p.y < b.y + STRIP_HEIGHT
    );
  }

  // Right-click on empty tab-bar space or on the Z.
  private showStripMenu(): void {
    const template = stripMenuTemplate(
      stripOwnItems(this),
      this.opts.appMenu(),
      process.platform,
    );
    this.popup(
      Menu.buildFromTemplate(template),
      template.map((m) => m.label ?? '-'),
    );
  }

  snapshot(): PersistedTabs {
    const kept = this.list.tabs.filter((t) => !t.signIn);
    const activeId =
      this.list.activeId === this.signInId ? this.returnTo : this.list.activeId;
    const tabs = kept.map((t) => ({
      url: t.url,
      title: t.title,
      pinned: t.pinned,
      name: t.name,
      lockedUrl: t.lockedUrl,
    }));
    const activeIndex = kept.findIndex((t) => t.id === activeId);
    return { tabs, activeIndex: Math.max(activeIndex, 0) };
  }

  setUpdate(update: StripState['update']): void {
    this.update = update;
    this.push();
  }

  // The logo and disclaimer over the whole window: briefly at launch, or as
  // About until dismissed.
  showSplash(mode: NonNullable<StripState['splash']>): void {
    clearTimeout(this.splashTimer);
    this.savedSignInError = null;
    this.shownEmail = null;
    // A finished run's list is only waiting out its moment on screen: the
    // page reopening ends that, rather than being hidden by it.
    if (this.endRunTimer) {
      clearTimeout(this.endRunTimer);
      this.endRunTimer = undefined;
      this.signInBusy = false;
    }
    if (!this.signInBusy) this.signInRun = null;
    this.splashMode = mode;
    this.splash.setVisible(true);
    this.push();
    if (mode === 'saved-sign-in') void this.showSavedEmail();
    if (mode === 'launch') {
      this.splashTimer = setTimeout(() => this.hideSplash(), SPLASH_MS);
    } else {
      this.splash.webContents.focus();
    }
  }

  private hideSplash(): void {
    if (!this.splashMode) return;
    clearTimeout(this.splashTimer);
    this.splashMode = null;
    this.push();
    // Gone once the page has faded it out.
    this.splashTimer = setTimeout(() => {
      this.splash.setVisible(false);
      this.activeContents?.focus();
    }, SPLASH_FADE_MS);
  }

  // Which page a sign-in opens on. One place, so the choice is easy to change.
  private zenshapePageFirst(): boolean {
    return !this.opts.savedSignIn.exists;
  }

  get isSigningIn(): boolean {
    return !!this.signInId && this.list.activeId === this.signInId;
  }

  // Only the email is decrypted for the page: it's shown filled in. The
  // password field shows a placeholder, and left untouched keeps the saved one.
  private async showSavedEmail(): Promise<void> {
    const saved = this.opts.savedSignIn;
    if (!saved.exists) return;
    const email = await saved.read('email');
    if (this.splashMode !== 'saved-sign-in') return;
    this.shownEmail = email;
    this.push();
  }

  // The Saved Sign-in page's one button (or Return): save the login if it's
  // new or changed, then sign in with it on Onshape's sign-in page.
  // `password` null = the field was left on its placeholder.
  private async signInFromPage(
    email: string,
    password: string | null,
  ): Promise<void> {
    if (this.splashMode !== 'saved-sign-in' || this.signInBusy) return;
    this.signInBusy = true;
    // The list shows from the press: the save may wait on the keychain.
    this.signInRun = { done: [], stopped: null };
    this.push();
    signInLog('sign-in pressed', { changedPassword: password !== null });
    const saved = this.opts.savedSignIn;
    const refuse = (reason: string) => {
      this.signInBusy = false;
      this.signInRun = null;
      signInLog('sign-in refused', { reason });
      this.savedSignInError = reason;
      this.push();
    };
    email = email.trim();
    if (!email) return refuse('Enter your Onshape email.');
    if (password === null && !saved.exists)
      return refuse('Enter your Onshape password.');
    // Unchanged: no key-store call at all.
    const changed =
      !saved.exists || password !== null || email !== this.shownEmail;
    if (changed) {
      let result: CanSave;
      try {
        const keep = password ?? (await saved.read('password'));
        result = keep
          ? await saved.save(email, keep)
          : {
              ok: false,
              reason: 'Couldn’t read the saved password. Enter it again.',
            };
      } catch (e) {
        // The error's own text names a file or keychain failure, never the login.
        result = {
          ok: false,
          reason: `Couldn’t save the sign-in: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      if (!result.ok) return refuse(`Not saved. ${result.reason}`);
      this.opts.onChange();
    }
    if (!this.signInId || !this.watched) {
      this.signInBusy = false;
      this.signInRun = null;
      signInLog('saved, no sign-in page', {
        signInTab: !!this.signInId,
        watched: !!this.watched,
      });
      this.hideSplash();
      if (changed)
        this.opts.notify('Sign-in saved, encrypted on this computer.');
      return;
    }
    await this.runSignIn(this.watched);
  }

  // Zenshape's page stays in front, ticking off each step, while the
  // sign-in tab's page (behind it, still loading and taking keys) is
  // driven. Onshape's page comes forward only when it needs the user.
  // Always ends in endRun, so a failure mid-run can't leave Sign in dead.
  private async runSignIn(
    watched: NonNullable<typeof this.watched>,
  ): Promise<void> {
    try {
      await this.runSignInSteps(watched);
    } catch (e) {
      // An error's own text (a protocol or page failure), never the login.
      signInLog('run failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      const done = this.signInRun?.done ?? ['save'];
      this.signInRun = {
        done,
        stopped: {
          step: next(done.at(-1) ?? 'save'),
          reason: 'Something went wrong. Finish signing in on Onshape’s page.',
        },
      };
      this.push();
      this.endRun(STOPPED_SHOWN_MS);
    }
  }

  private async runSignInSteps(
    watched: NonNullable<typeof this.watched>,
  ): Promise<void> {
    const contents = watched.contents;
    const tabId = this.signInId;
    const run: NonNullable<StripState['signInRun']> = {
      done: ['save'],
      stopped: null,
    };
    const show = () => {
      this.signInRun = { done: [...run.done], stopped: run.stopped };
      this.push();
    };
    show();
    // The user just pressed Sign in on Zenshape's page, which holds focus;
    // `:focus` matches only in a focused frame, and typing goes to the
    // focused view. The sign-in page takes focus while still covered.
    contents.focus();
    const started = Date.now();
    signInLog('run start', {
      at: where(contents.getURL()),
      pageFocused: contents.isFocused(),
      splashFocused: this.splash.webContents?.isFocused() ?? false,
    });
    const login = this.opts.savedSignIn;
    const result = await signIn(
      {
        onSignInPage: () => watched.page.isCurrent(),
        readField: async () => {
          const field = await readField(watched.page.send);
          signInLog('read', {
            ms: Date.now() - started,
            at: where(contents.getURL()),
            field: field ? field.kind : 'none',
            empty: field?.empty ?? null,
            pageFocused: contents.isFocused(),
          });
          return field;
        },
        fill: (field) =>
          fillField(
            watched.page,
            watched.fills,
            login,
            field,
            'run',
            signInLog,
          ),
        pressReturn: async () => pressReturn(watched.page),
        stepDone: (step) => {
          signInLog('step done', { step, ms: Date.now() - started });
          run.done.push(step);
          show();
        },
      },
      TIMING,
    );
    // Signed in only if finishSignIn completed this tab; closing it isn't.
    const signedIn = !!tabId && this.signedInTab === tabId;
    signInLog('run end', {
      result: result.kind,
      step:
        result.kind === 'left'
          ? result.after
          : result.kind === 'handed-over'
            ? 'done'
            : result.step,
      signedIn,
      ms: Date.now() - started,
    });
    // Onshape took the password and asks for its own next step (a code): our
    // steps are all done, so it ends as a success does and its page comes
    // forward for the rest.
    if ((result.kind === 'left' && signedIn) || result.kind === 'handed-over') {
      run.done.push('done');
      show();
      return this.endRun(SIGNED_IN_SHOWN_MS);
    }
    if (result.kind === 'left') {
      run.stopped = {
        step: next(result.after),
        reason: 'The page left Onshape’s sign-in. Finish it there.',
      };
    } else {
      run.stopped = { step: result.step, reason: result.reason };
    }
    show();
    this.endRun(STOPPED_SHOWN_MS);
  }

  // Leaves the finished or stopped list up a moment, then shows the page
  // behind: the signed-in page, or Onshape's page where it needs the user.
  private endRun(ms: number): void {
    clearTimeout(this.endRunTimer);
    this.endRunTimer = setTimeout(() => {
      this.endRunTimer = undefined;
      this.signInBusy = false;
      this.signInRun = null;
      this.hideSplash();
    }, ms);
  }

  focus(): void {
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  // --- internals -------------------------------------------------------------

  private restore(saved: PersistedTabs): void {
    for (const t of saved.tabs) {
      this.list.open(t, { activate: false });
    }
    const active = this.list.tabs[saved.activeIndex] ?? this.list.tabs[0];
    if (active) this.selectTab(active.id);
    else this.newTab();
  }

  // Our own page (strip or divider): sandboxed, our preload, and it may only
  // ever show that page. Reloading it (Vite's dev reload) is the one
  // navigation allowed.
  private ourView(mode: OurViewMode): WebContentsView {
    const view = new WebContentsView({
      webPreferences: stripWebPreferences(this.opts.preload),
    });
    view.setBackgroundColor('#00000000');
    view.webContents.on('will-navigate', (e) => {
      if (e.url !== view.webContents.getURL()) e.preventDefault();
    });
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('did-finish-load', () => this.push());
    this.handleMouseNav(view.webContents, () => this.activeContents);
    this.window.contentView.addChildView(view);
    this.opts.loadStrip(view.webContents, mode);
    return view;
  }

  private canSplit(id: string): boolean {
    const tab = this.list.get(id);
    return !!tab && !tab.signIn;
  }

  private pageArea(): Rect {
    const { width, height } = this.window.getContentBounds();
    const top = this.stripHidden ? this.gutterHeight : STRIP_HEIGHT;
    return { x: 0, y: top, width, height: height - top };
  }

  // What dropping `id` at (x, y) would do, and the area it would take.
  private planDrop(
    id: string,
    x: number,
    y: number,
  ): { split: Split; preview: Rect } | null {
    if (!this.canSplit(id)) return null;
    const area = this.pageArea();
    const active = this.list.activeId;
    const s = this.split;
    if (s && inSplit(s, active) && !inSplit(s, id)) {
      const side = paneAt(area, s, x, y);
      const panes = splitLayout(area, s);
      return {
        split: side === 'a' ? { ...s, a: id } : { ...s, b: id },
        preview: panes[side],
      };
    }
    const other = s && inSplit(s, active) ? partner(s, id) : active;
    if (!other || other === id || !this.canSplit(other)) return null;
    const zone = edgeZone(area, x, y);
    return { split: placeAt(other, id, zone), preview: zoneRect(area, zone) };
  }

  private showDropPreview(id: string, x: number, y: number): void {
    const plan = this.planDrop(id, x, y);
    const area = this.pageArea();
    this.dropPreview = plan
      ? {
          ...plan.preview,
          x: plan.preview.x - area.x,
          y: plan.preview.y - area.y,
        }
      : null;
    this.overlay.setBounds(area);
    this.overlay.setVisible(!!plan);
    this.push();
  }

  private hideDropPreview(): void {
    if (!this.dropPreview && !this.overlay.getVisible()) return;
    this.dropPreview = null;
    this.overlay.setVisible(false);
    this.push();
  }

  private showSplit(focus: string): void {
    if (!this.split) return;
    this.ensureView(this.split.a);
    this.ensureView(this.split.b);
    this.list.select(focus);
    this.changed();
  }

  // A locked tab tried to leave its page: open the destination next to it.
  // One click can report the same route change more than once.
  private openFromLocked(id: string, url: string): void {
    const now = Date.now();
    if (this.lastLeave?.url === url && now - this.lastLeave.at < 2000) return;
    this.lastLeave = { url, at: now };
    const tab = this.list.open({ url }, { after: id });
    this.ensureView(tab.id);
    this.changed();
  }

  // Mouse back/forward buttons, like a browser. Electron's 'app-command' is
  // Windows/Linux only; on macOS these arrive as input events whose button is
  // 'back' / 'forward' (missing from Electron's typings).
  private handleMouseNav(
    contents: WebContents,
    target: () => WebContents | undefined,
  ): void {
    contents.on('input-event', (_event, input) => {
      if (input.type !== 'mouseUp') return;
      const button = (input as { button?: string }).button;
      if (button === 'back') this.goBack(target());
      else if (button === 'forward') this.goForward(target());
    });
  }

  private idFor(contents: WebContents): string | undefined {
    for (const [id, view] of this.views) {
      if (view.webContents === contents) return id;
    }
    return undefined;
  }

  // The debugger is attached only while the sign-in tab shows Onshape's
  // sign-in page, and only to that page.
  private watchSignInPage(): void {
    const contents = this.signInId
      ? this.views.get(this.signInId)?.webContents
      : undefined;
    const want =
      contents && !contents.isDestroyed() && isSignInPage(contents.getURL())
        ? contents
        : undefined;
    if (this.watched?.contents === want) return;
    this.unwatchSignInPage();
    if (!want) return;
    signInLog('watch', { at: where(want.getURL()) });
    const dbg = want.debugger;
    try {
      dbg.attach('1.3');
    } catch {
      // DevTools already open on it: no focus reads, so no fill.
      return;
    }
    const login = this.opts.savedSignIn;
    const page: FillPage = {
      isCurrent: () =>
        this.watched?.contents === want &&
        !want.isDestroyed() &&
        this.isSigningIn &&
        isSignInPage(want.getURL()),
      // Only the protocol methods sign-in-focus allows: no Input.*, no Runtime.
      send: guard((method, params) => dbg.sendCommand(method, params)),
      keyboard: want,
    };
    const fills = new FillState();
    // Any key or press that reaches the page may change the email, or
    // continue with it: the last account verdict stops counting (when the
    // page has an email input), and a new reading is taken at once, as
    // Return or Continue is pressed.
    const onPress = () => {
      pressed(fills);
      void takeReading(page, fills, login);
    };
    // Keys arrive here as they're sent to the page (Electron fires it
    // synchronously, even for the run's own sendInputEvent).
    const onKey = (_e: unknown, input: { type: string }) => {
      if (input.type === 'keyDown' || input.type === 'rawKeyDown') onPress();
    };
    // Presses: a click, a tap, a touch. Not moves, and not keys (above).
    const onInput = (_e: unknown, input: { type: string }) => {
      if (!NOT_A_PRESS.has(input.type)) onPress();
    };
    // Detached from outside (DevTools opened, the page crashed): drop the
    // listener too, so a later attach doesn't add a second one.
    const onDetach = () => {
      if (this.watched?.contents === want) this.unwatchSignInPage();
    };
    want.on('before-input-event', onKey);
    want.on('input-event', onInput);
    dbg.on('detach', onDetach);
    const autofill = setInterval(() => void this.autofillTick(), AUTOFILL_MS);
    this.watched = {
      contents: want,
      page,
      fills,
      // The debugger captured at attach: it outlives its contents, whose
      // `debugger` can't be read once destroyed.
      off: () => {
        clearInterval(autofill);
        want.off('before-input-event', onKey);
        want.off('input-event', onInput);
        dbg.off('detach', onDetach);
        if (dbg.isAttached()) dbg.detach();
      },
    };
  }

  private unwatchSignInPage(): void {
    const watched = this.watched;
    this.watched = null;
    watched?.off();
  }

  // The saved-login path (a login is saved, Onshape's own page shows): as
  // Onshape's empty email or password field takes focus, the fill routine
  // types the saved one (the password only for the saved account). No key is
  // pressed: Continue and Return stay the user's, who may be signing in to
  // another account. Each tick also takes an account reading.
  private autofillTick(): Promise<void> | undefined {
    const watched = this.watched;
    const login = this.opts.savedSignIn;
    // Zenshape's page (or its run) has this sign-in instead.
    if (
      !watched ||
      watched.fills.busy ||
      !login.exists ||
      this.signInBusy ||
      this.splashMode === 'saved-sign-in' ||
      !watched.page.isCurrent()
    )
      return;
    return this.autofill(watched);
  }

  private async autofill(
    watched: NonNullable<typeof this.watched>,
  ): Promise<void> {
    const login = this.opts.savedSignIn;
    await takeReading(watched.page, watched.fills, login);
    const field = await readField(watched.page.send);
    if (!field || field.kind === 'other' || !field.empty) return;
    if (watched.fills.filled.has(field.kind)) return;
    await fillField(
      watched.page,
      watched.fills,
      login,
      field.kind,
      'focus',
      signInLog,
    );
  }

  // Onshape bounced a tab to its sign-in page: move that page into the
  // sign-in tab (left of everything) and leave the tab itself unloaded, so it
  // keeps its document and loads it again once signed in.
  private divertToSignIn(id: string, recheck = false): void {
    const view = this.views.get(id);
    if (!view) return;
    const url = view.webContents.getURL();
    if (
      !recheck &&
      Date.now() - (this.returnedAt.get(id) ?? 0) < SIGN_IN_LOOP_MS
    ) {
      // Held by the loop breaker: an auto-continuing hop leaves the sign-in
      // page by itself. One that stays (a real sign-out soon after signing
      // in) is diverted after all, or it would get no Zenshape page and no
      // fill.
      signInLog('sign-in held', { at: where(url) });
      if (!this.recheck.has(id))
        this.recheck.set(
          id,
          setTimeout(() => {
            this.recheck.delete(id);
            const held = this.views.get(id)?.webContents;
            const stillHeld = () =>
              !!held &&
              !held.isDestroyed() &&
              this.views.get(id)?.webContents === held &&
              !this.list.get(id)?.signIn &&
              isSignInPage(held.getURL());
            if (!stillHeld()) return;
            // A slow hop is still loading: judge it once it has stopped.
            if (held!.isLoading())
              held!.once('did-stop-loading', () => {
                if (stillHeld()) this.divertToSignIn(id, true);
              });
            else this.divertToSignIn(id, true);
          }, SIGN_IN_SETTLE_MS),
        );
      return;
    }
    signInLog('sign-in page', { at: where(url), recheck });
    this.views.delete(id);
    this.returnTo = id;
    if (this.signInId && this.views.has(this.signInId)) {
      this.window.contentView.removeChildView(view);
      view.webContents.close();
      this.list.select(this.signInId);
    } else {
      const tab = this.list.open({
        url: view.webContents.getURL(),
        title: SIGN_IN_TITLE,
        signIn: true,
      });
      this.signInId = tab.id;
      this.views.set(tab.id, view);
      // Nothing saved: Zenshape's page, in place of Onshape's (Esc shows
      // Onshape's). Saved: Onshape's own page, filled as its fields take
      // focus (`autofillTick`).
      if (this.zenshapePageFirst()) this.showSplash('saved-sign-in');
      // `:focus` matches only in the focused view.
      else view.webContents.focus();
    }
    this.changed();
  }

  private finishSignIn(id: string): void {
    const back =
      this.returnTo && this.list.get(this.returnTo) ? this.returnTo : null;
    this.signedInTab = id;
    signInLog('signed in', { returnTo: !!back });
    // Signed in some other way (a hop that finished by itself, or on
    // Onshape's page behind it): Zenshape's page has nothing left to do.
    if (this.splashMode === 'saved-sign-in' && !this.signInBusy)
      this.hideSplash();
    this.signInId = this.returnTo = null;
    if (back) this.returnedAt.set(back, Date.now());
    if (!back) {
      // Nothing to return to: the signed-in page just becomes a normal tab.
      this.list.becomeRegular(id);
      this.changed();
      return;
    }
    const view = this.views.get(id);
    if (view) {
      this.window.contentView.removeChildView(view);
      view.webContents.close();
      this.views.delete(id);
    }
    this.list.select(back);
    this.list.close(id);
    this.ensureView(back);
    this.changed();
  }

  // Restored tabs stay as plain entries until first selected.
  private ensureView(id: string): void {
    if (this.views.has(id)) return;
    const tab = this.list.get(id);
    if (!tab) return;
    const view = new WebContentsView({
      webPreferences: onshapeWebPreferences(),
    });
    this.addView(id, view);
    void view.webContents.loadURL(tab.url);
  }

  private addView(id: string, view: WebContentsView): void {
    // Kept: once destroyed, `view.webContents` reads undefined (Electron 45),
    // already inside 'destroyed', whatever its typings say.
    const contents = view.webContents;
    this.views.set(id, view);
    // Index 0 keeps every page underneath the strip.
    this.window.contentView.addChildView(view, 0);
    this.applyPolicy(contents);
    const sheets = new ZenSheets(contents);
    this.zenSheets.set(contents, sheets);
    contents.on('dom-ready', () => {
      if (this.zen) void sheets.applyAll();
    });
    contents.once('destroyed', () => {
      this.zenSheets.delete(contents);
      this.pageClosed(view);
    });
  }

  // A page closed its own tab (window.close(), or its opener's w.close()).
  // Zenshape's own closes drop the view from `views` in the same step as
  // close(), so a view still here was closed by its page: close its tab as
  // Close Tab does. Found by the view, since its contents is gone.
  private pageClosed(view: WebContentsView): void {
    // The window's teardown isn't a page closing its own tab. dispose()
    // empties `views` first; this holds if that order ever changes.
    if (this.closed) return;
    const id = [...this.views].find(([, v]) => v === view)?.[0];
    if (id === undefined) return;
    this.views.delete(id);
    const opener = this.openers.get(id);
    if (this.list.activeId === id && opener && this.list.get(opener))
      this.list.select(opener);
    this.closeTab(id);
  }

  // Views can move between tabs (sign-in), so handlers look up their tab
  // each time instead of capturing an id.
  private applyPolicy(contents: WebContents): void {
    const tabOf = () => {
      const id = this.idFor(contents);
      const tab = id ? this.list.get(id) : undefined;
      return id && tab ? { id, tab } : undefined;
    };

    contents.on('will-navigate', (event) => {
      if (this.closed) {
        event.preventDefault();
        return;
      }
      if (!isOnshapeUrl(event.url)) {
        event.preventDefault();
        openExternal(event.url);
        return;
      }
      const found = tabOf();
      const locked = found?.tab.lockedUrl;
      if (!found || !locked || isSignInPage(event.url)) return;
      if (inLockScope(locked, event.url)) return;
      event.preventDefault();
      this.openFromLocked(found.id, event.url);
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (this.closed) return { action: 'deny' };
      switch (decideWindowOpen(url)) {
        case 'app-window':
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              webPreferences: onshapeWebPreferences(),
            },
            createWindow: (options) =>
              this.adoptPopup(options, this.idFor(contents)),
          };
        case 'external':
          openExternal(url);
          return { action: 'deny' };
        case 'deny':
          return { action: 'deny' };
      }
    });

    const onNavigate = () => {
      const found = tabOf();
      if (!found) return;
      const { id, tab } = found;
      const url = contents.getURL();
      if (isSignInPage(url)) {
        if (!tab.signIn) this.divertToSignIn(id);
        // Back on Onshape's sign-in page (after SSO, say): watch it again.
        else this.watchSignInPage();
        return;
      }
      if (tab.signIn) {
        if (isOnshapeUrl(url)) this.finishSignIn(id);
        // Off Onshape (an SSO provider): stop watching it.
        else this.watchSignInPage();
        return;
      }
      // In-page route changes can't be stopped beforehand. The destination
      // opens beside the locked tab, which reloads its last in-scope URL
      // (`tab.url`, never updated out of scope). Going "back" instead fights
      // Onshape's router.
      if (tab.lockedUrl && !inLockScope(tab.lockedUrl, url)) {
        void contents.loadURL(tab.url);
        this.openFromLocked(id, url);
        return;
      }
      this.list.update(id, { url });
      this.changed();
    };
    contents.on('did-navigate', onNavigate);
    contents.on('did-navigate-in-page', onNavigate);
    // A drawing's frame loads after the page; the gutter follows it.
    contents.on('did-frame-navigate', (_e, _url, _code, _status, isMain) => {
      if (!isMain && contents === this.activeContents) this.push();
    });

    // Only real titles the page set itself (Electron otherwise reports the URL),
    // never placeholders: Onshape can show its sign-in page before the URL
    // changes, and that mustn't rename a pin.
    contents.on('page-title-updated', (_event, title, explicitSet) => {
      const found = tabOf();
      if (!found || found.tab.signIn || !explicitSet) return;
      if (PLACEHOLDER_TITLES.has(title.trim())) return;
      if (isSignInPage(contents.getURL())) return;
      this.list.update(found.id, { title });
      this.changed();
    });
    // Clicking into a split pane makes its tab the active one.
    contents.on('focus', () => {
      const id = this.idFor(contents);
      if (!id || id === this.list.activeId || !inSplit(this.split, id)) return;
      this.list.select(id);
      this.changed();
    });
    this.handleMouseNav(contents, () => contents);
    contents.on('did-start-loading', () => this.push());
    contents.on('did-stop-loading', () => this.push());
  }

  // window.open from Onshape: Electron hands us the new page's WebContents and
  // we give it a tab, so window.opener keeps working.
  private adoptPopup(
    options: BrowserWindowConstructorOptions,
    openerId: string | undefined,
  ): WebContents {
    const view = new WebContentsView({
      webPreferences: onshapeWebPreferences(),
      webContents: (options as { webContents?: WebContents }).webContents,
    });
    const tab = this.list.open({ url: 'about:blank' }, { after: openerId });
    if (openerId) this.openers.set(tab.id, openerId);
    this.addView(tab.id, view);
    this.changed();
    return view.webContents;
  }

  private layout(): void {
    if (this.closed) return;
    const { width, height } = this.window.getContentBounds();
    const area = this.pageArea();
    const active = this.list.activeId;
    const shown = new Map<string, typeof area>();
    if (this.split && inSplit(this.split, active)) {
      const panes = splitLayout(area, this.split);
      shown.set(this.split.a, panes.a);
      shown.set(this.split.b, panes.b);
      this.divider.setBounds(this.draggingDivider ? area : panes.divider);
      this.divider.setVisible(true);
    } else {
      if (active) shown.set(active, area);
      this.divider.setVisible(false);
    }
    for (const [id, view] of this.views) {
      const bounds = shown.get(id);
      view.setVisible(!!bounds);
      if (bounds) view.setBounds(bounds);
    }
    this.splash.setBounds({ x: 0, y: 0, width, height });
    // Hidden: just the gutter, or full height (over the page) while peeked.
    const tall = !this.stripHidden || this.peeked || this.peekClosing;
    this.strip.setBounds({
      x: 0,
      y: 0,
      width,
      height: tall ? STRIP_HEIGHT : this.gutterHeight,
    });
  }

  private push(): void {
    if (this.closed) return;
    // The overlay wears the gutter's color, which follows the page.
    if (this.overlayGutter && this.overlayGutter !== this.gutter())
      this.showWindowButtons(false);
    const state: StripState = {
      tabs: this.list.tabs.map((t) => ({
        id: t.id,
        title: displayName(t),
        pinned: t.pinned,
        signIn: t.signIn,
        locked: !!t.lockedUrl,
        loading: this.views.get(t.id)?.webContents.isLoading() ?? false,
      })),
      activeId: this.list.activeId,
      renamingId: this.renamingId,
      canGoBack: !!this.activeContents?.navigationHistory.canGoBack(),
      canGoForward: !!this.activeContents?.navigationHistory.canGoForward(),
      split: this.split
        ? {
            a: this.split.a,
            b: this.split.b,
            direction: this.split.direction,
            shown: inSplit(this.split, this.list.activeId),
          }
        : null,
      dropPreview: this.dropPreview,
      collapsed: this.stripHidden,
      peeked: this.peeked,
      gutter: this.gutter(),
      gutterColor: GUTTER_COLORS[this.gutter()],
      gutterHeight: this.gutterHeight,
      zen: this.zen,
      fullscreen: this.window.isFullScreen(),
      controls: process.platform === 'darwin' ? 'traffic-lights' : 'overlay',
      splash: this.splashMode,
      savedSignInError: this.savedSignInError,
      signInRun: this.signInRun,
      savedSignIn: this.opts.savedSignIn.exists
        ? { email: this.shownEmail }
        : null,
      version: app.getVersion(),
      update: this.update,
    };
    this.strip.webContents.send(STRIP_STATE_CHANNEL, state);
    for (const view of [this.divider, this.overlay, this.splash]) {
      if (!view.webContents.isDestroyed()) {
        view.webContents.send(STRIP_STATE_CHANNEL, state);
      }
    }
  }

  private gutter(): StripState['gutter'] {
    const contents = this.activeContents;
    const url = contents?.getURL() ?? '';
    if (!this.zen || !isDocumentUrl(url)) return 'bar';
    const drawing = contents?.mainFrame.framesInSubtree.some((f) =>
      isDrawingFrameFor(f.url, url),
    );
    return drawing ? 'drawing' : 'zen';
  }

  private changed(): void {
    if (this.closed) return;
    this.watchSignInPage();
    this.layout();
    this.push();
    this.opts.onChange();
  }

  private readonly onCommand = (event: IpcMainEvent, cmd: unknown): void => {
    if (!isStripCommand(cmd)) return;
    // The divider may only drag itself and the splash only dismiss itself;
    // everything else comes from the strip.
    const owner = cmd.type.startsWith('divider-')
      ? this.divider
      : cmd.type === 'dismiss-splash' || cmd.type === 'sign-in'
        ? this.splash
        : this.strip;
    if (event.sender !== owner.webContents) return;
    switch (cmd.type) {
      case 'select':
        return this.selectTab(cmd.id);
      case 'close':
        return this.closeTab(cmd.id);
      case 'new-tab':
        return this.newTab();
      case 'peek':
        return this.peek();
      case 'unpeek':
        return this.unpeek();
      case 'strip-menu':
        return this.showStripMenu();
      case 'toggle-zen':
        return void this.setZen(!this.zen);
      case 'dismiss-splash':
        return this.hideSplash();
      case 'sign-in':
        return void this.signInFromPage(cmd.email, cmd.password);
      case 'open-update':
        return void (this.update && openExternal(this.update.url));
      case 'controls-height':
        return this.controlsMeasured(cmd.height);
      case 'go-back':
        return this.goBack();
      case 'go-forward':
        return this.goForward();
      case 'context-menu':
        return this.showTabMenu(cmd.id);
      case 'move':
        return this.moveTab(cmd.id, cmd.before);
      case 'rename':
        return this.finishRename(cmd.id, cmd.name);
      case 'divider-start':
        this.draggingDivider = true;
        return this.layout();
      case 'divider-move':
        if (!this.split) return;
        this.split.ratio = clampRatio(cmd.ratio);
        return this.layout();
      case 'divider-end':
        this.draggingDivider = false;
        return this.layout();
      case 'drag-page':
        return this.showDropPreview(cmd.id, cmd.x, cmd.y);
      case 'drag-page-end':
        return this.hideDropPreview();
      case 'drop-page':
        return this.dropOnPage(cmd.id, cmd.x, cmd.y);
      case 'split-onto':
        return this.splitOnto(cmd.id, cmd.target);
      case 'split-swap':
        return this.swapSplit();
      case 'split-rotate':
        return this.rotateSplit();
    }
  };

  private showTabMenu(id: string): void {
    const tab = this.list.get(id);
    if (!tab) return;
    this.popup(
      Menu.buildFromTemplate([
        {
          label: tab.pinned ? 'Unpin Tab' : 'Pin Tab',
          enabled: !tab.signIn,
          click: () => this.setPinned(id, !tab.pinned),
        },
        {
          label: 'Rename…',
          enabled: !tab.signIn && (!this.stripHidden || this.peeked),
          click: () => this.startRename(id),
        },
        {
          label: tab.lockedUrl ? 'Unlock Page' : 'Lock to This Page',
          enabled: !tab.signIn,
          click: () => this.setLocked(id, !tab.lockedUrl),
        },
        { type: 'separator' },
        ...(inSplit(this.split, id)
          ? [
              ...(['left', 'right', 'top', 'bottom'] as const).map((zone) => ({
                label: `Move to ${zone[0].toUpperCase()}${zone.slice(1)}`,
                click: () => this.moveInSplit(id, zone),
              })),
              { label: 'Unsplit', click: () => this.unsplit() },
              { type: 'separator' as const },
            ]
          : []),
        { label: 'Copy Link', click: () => clipboard.writeText(tab.url) },
        { type: 'separator' },
        { label: 'Close Tab', click: () => this.closeTab(id) },
      ]),
    );
  }

  // The strip shows an editor in place of the tab's name; it needs keyboard
  // focus, which normally belongs to the Onshape page.
  private startRename(id: string): void {
    this.renamingId = id;
    this.strip.webContents.focus();
    this.push();
  }

  private finishRename(id: string, name: string | null): void {
    if (id !== this.renamingId) return;
    this.renamingId = null;
    if (name !== null) this.list.rename(id, name);
    // Pointer-leaves were ignored during the rename; hide a peeked strip now
    // if the pointer has gone (unpeek checks where it really is).
    if (this.peeked) this.unpeek();
    this.activeContents?.focus();
    this.changed();
  }

  // Like Close Tab: first nothing can reach a page through the window, then
  // the pages close.
  private dispose(): void {
    this.closed = true;
    const pages = [...this.views.values()];
    this.views.clear();
    clearTimeout(this.endRunTimer);
    for (const timer of this.recheck.values()) clearTimeout(timer);
    this.unwatchSignInPage();
    clearTimeout(this.peekTimer);
    clearTimeout(this.splashTimer);
    ipcMain.off(STRIP_COMMAND_CHANNEL, this.onCommand);
    screen.off('display-metrics-changed', this.remeasureControls);
    for (const view of pages) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    if (!this.strip.webContents.isDestroyed()) this.strip.webContents.close();
    for (const view of [this.divider, this.overlay, this.splash]) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  }
}
