import {
  app,
  dialog,
  Menu,
  safeStorage,
  screen,
  session,
  shell,
  type Session,
  type WebContents,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { appMenuTemplate, type AppMenuContext } from './app-menu';
import { loadAppState, saveAppState, type AppState } from './app-state';
import { persistentCopy } from './cookies';
import { cleanUserAgent } from './navigation';
import { SavedSignIn } from './saved-sign-in';
import { startSignInLog } from './sign-in-log';
import { ZenshapeWindow, type OurViewMode } from './tab-views';
import { tabsToRestore } from './tabs';
import { startUpdates, type Update } from './updates';
import { PARTITION } from './web-preferences';
import {
  DEFAULT_SIZE,
  isVisibleOnSomeDisplay,
  loadWindowState,
  saveWindowState,
} from './window-state';

const SCHEME = 'zenshape';

let current: ZenshapeWindow | null = null;
let appState: AppState;
let saveTimer: NodeJS.Timeout | undefined;
let update: Update | null = null;
let savedSignIn: SavedSignIn | undefined;

const userFile = (name: string) => path.join(app.getPath('userData'), name);

function persist(): void {
  clearTimeout(saveTimer);
  if (current) {
    appState = {
      ...appState,
      ...current.snapshot(),
      stripCollapsed: current.isCollapsed,
      zen: current.isZen,
      hideStripInZen: current.hidesStripInZen,
    };
  }
  saveAppState(userFile('app-state.json'), appState);
}

// Tab changes come in bursts (title + url + load), so coalesce the writes.
function persistSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}

function loadStrip(contents: WebContents, mode: OurViewMode): void {
  const hash = mode === 'strip' ? '' : mode;
  if (STRIP_VITE_DEV_SERVER_URL) {
    void contents.loadURL(`${STRIP_VITE_DEV_SERVER_URL}#${hash}`);
  } else {
    void contents.loadFile(
      path.join(__dirname, `../renderer/${STRIP_VITE_NAME}/index.html`),
      { hash },
    );
  }
}

function createWindow(): ZenshapeWindow {
  const saved = loadWindowState(userFile('window-state.json'));
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  const bounds =
    saved && isVisibleOnSomeDisplay(saved.bounds, workAreas)
      ? saved.bounds
      : DEFAULT_SIZE;

  savedSignIn ??= new SavedSignIn(userFile('saved-sign-in.json'), safeStorage);
  const win = new ZenshapeWindow({
    savedSignIn,
    notify: (message) => notify(win, message),
    bounds,
    maximized: saved?.maximized ?? false,
    restore: tabsToRestore(appState, appState.restoreAllTabs),
    collapsed: appState.stripCollapsed,
    zen: appState.zen,
    hideStripInZen: appState.hideStripInZen,
    preload: path.join(__dirname, 'preload.cjs'),
    loadStrip,
    onChange: () => {
      persistSoon();
      buildMenu();
    },
    appMenu: () => appMenuTemplate(menuContext()),
  });

  win.window.on('close', () => {
    saveWindowState(userFile('window-state.json'), {
      bounds: win.window.getNormalBounds(),
      maximized: win.window.isMaximized(),
    });
    persist();
  });
  win.window.on('closed', () => {
    if (current === win) current = null;
  });
  win.setUpdate(update);
  return win;
}

function notify(win: ZenshapeWindow, message: string, warning = false): void {
  void dialog.showMessageBox(win.window, {
    type: warning ? 'warning' : 'info',
    message,
  });
}

function focusApp(): void {
  if (current) current.focus();
  else current = createWindow();
}

function menuContext(): AppMenuContext {
  return {
    appName: app.name,
    window: () => current,
    showSplash: (mode) => {
      current ??= createWindow();
      current.showSplash(mode);
    },
    newTab: () => (current ? current.newTab() : focusApp()),
    update,
    openUpdate: (url) => void shell.openExternal(url),
    signInSaved: !!savedSignIn?.exists,
    forgetSignIn: () => {
      savedSignIn?.forget();
      buildMenu();
    },
    restoreAllTabs: appState.restoreAllTabs,
    setRestoreAllTabs: (on) => {
      appState.restoreAllTabs = on;
      persist();
    },
    saved: {
      zen: appState.zen,
      hideStripInZen: appState.hideStripInZen,
      stripCollapsed: appState.stripCollapsed,
    },
  };
}

// Set on every OS: off macOS no menu bar is drawn, but the application menu
// is what makes its accelerators (Ctrl+T and the rest) work.
function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(appMenuTemplate(menuContext())),
  );
}

function uniquePath(dir: string, filename: string): string {
  const { name, ext } = path.parse(filename);
  let candidate = path.join(dir, filename);
  for (let n = 1; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${name} (${n})${ext}`);
  }
  return candidate;
}

function configureSession(ses: Session): void {
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent(), app.getName()));

  ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (removed) return;
    const copy = persistentCopy(cookie, Date.now() / 1000);
    if (copy) void ses.cookies.set(copy).catch(() => {});
  });

  ses.on('will-download', (_event, item, contents) => {
    const target = uniquePath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(target);
    item.once('done', (_e, state) => {
      if (state === 'completed') shell.showItemInFolder(target);
    });
    current?.closeIfBlank(contents);
  });
}

function registerProtocol(): void {
  // In dev the app is `electron <script>`, so Windows needs the script path too.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }
}

function start(): void {
  // Packaged builds encrypt cookies (fuse) and dev Electron can't read them, so
  // sharing one profile would log you out each time you switch.
  // The UI tests (test/ui) point dev runs at a throwaway profile instead.
  if (!app.isPackaged) {
    app.setPath(
      'userData',
      process.env.ZENSHAPE_USER_DATA ?? `${app.getPath('userData')} Dev`,
    );
  }

  // The UI tests measure layout and animations; Chromium pauses both in a
  // window that other windows cover, which depends on what else is on screen.
  if (process.env.ZENSHAPE_E2E === '1' && !app.isPackaged) {
    for (const flag of [
      'disable-backgrounding-occluded-windows',
      'disable-renderer-backgrounding',
      'disable-background-timer-throttling',
    ]) {
      app.commandLine.appendSwitch(flag);
    }
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.userAgentFallback = cleanUserAgent(app.userAgentFallback, app.getName());
  registerProtocol();

  // Windows/Linux deliver zenshape:// URLs as a second instance's argv.
  app.on('second-instance', () => focusApp());
  // macOS delivers them here, possibly before ready.
  app.on('open-url', (event) => {
    event.preventDefault();
    if (app.isReady()) focusApp();
  });

  void app.whenReady().then(() => {
    // Dev, UI-test and scratch runs keep their own log.
    startSignInLog(
      app.getPath('logs'),
      app.isPackaged && !process.env.ZENSHAPE_USER_DATA
        ? 'sign-in.log'
        : 'sign-in-dev.log',
    );
    // Packaged builds get the icon from their bundle. In dev,
    // scripts/dev-bundle.sh also patches Electron.app; this covers a dev run
    // started without `npm start`.
    if (!app.isPackaged) {
      app.dock?.setIcon(path.join(__dirname, '../../assets/icon.png'));
    }
    appState = loadAppState(userFile('app-state.json'));
    const onshapeSession = session.fromPartition(PARTITION);
    configureSession(onshapeSession);
    // Cookie writes are batched; make sure the login reaches disk on quit.
    app.on('before-quit', () => void onshapeSession.cookies.flushStore());
    current = createWindow();
    current.showSplash('launch');
    buildMenu();
    startUpdates((u) => {
      update = u;
      current?.setUpdate(u);
      buildMenu();
    });
    // The UI tests drive the window through the main-process inspector;
    // native menus can't be clicked from there. Dev runs only.
    if (process.env.ZENSHAPE_E2E === '1' && !app.isPackaged) {
      Object.assign(globalThis, { __zenshape: { window: () => current } });
    }

    app.on('activate', () => {
      if (!current) current = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// Squirrel runs the app once on install/uninstall to manage shortcuts.
if (started) {
  app.quit();
} else {
  start();
}
