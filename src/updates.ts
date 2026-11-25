import { app, net } from 'electron';
import { UpdateSourceType, updateElectronApp } from 'update-electron-app';

// Updates come from this repo's GitHub Releases (docs/release.md).
const REPO = 'davemadethis/zenshape';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/`;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export interface Update {
  version: string;
  url: string;
}

function parts(version: string): number[] | null {
  const m = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}

// Plain x.y.z only; anything else (prerelease, junk) is never newer.
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// The update offered by GitHub's "latest release" response, if it's newer
// than what's running. Only links into this repo's releases are trusted.
export function pickUpdate(release: unknown, current: string): Update | null {
  const r = release as { tag_name?: unknown; html_url?: unknown } | null;
  if (typeof r?.tag_name !== 'string' || typeof r.html_url !== 'string') {
    return null;
  }
  if (!r.html_url.startsWith(RELEASES_PAGE)) return null;
  if (!isNewer(r.tag_name, current)) return null;
  return { version: r.tag_name.replace(/^v/, ''), url: r.html_url };
}

async function checkLatest(): Promise<Update | null> {
  try {
    const res = await net.fetch(LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    return pickUpdate(await res.json(), app.getVersion());
  } catch {
    return null;
  }
}

// Windows installs updates itself. macOS can't while unsigned (Squirrel.Mac
// only accepts updates signed like the running app) and Linux packages have no
// updater, so those get a notice that links to the release.
export function startUpdates(onUpdate: (update: Update) => void): void {
  if (!app.isPackaged) return;
  if (process.platform === 'win32') {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: REPO,
      },
    });
    return;
  }
  const check = async () => {
    const update = await checkLatest();
    if (update) onUpdate(update);
  };
  void check();
  setInterval(() => void check(), CHECK_EVERY_MS);
}
