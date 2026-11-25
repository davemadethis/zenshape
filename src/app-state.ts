import fs from 'node:fs';
import path from 'node:path';
import type { PersistedTab, PersistedTabs } from './tabs';

export interface AppState extends PersistedTabs {
  restoreAllTabs: boolean;
  stripCollapsed: boolean;
  zen: boolean;
  hideStripInZen: boolean;
}

// The tab bar is hidden when the user hid it, or while zen mode is on if they
// asked for that. Zen never rewrites stripCollapsed, so turning zen off
// restores whatever it was.
export const isStripHidden = (s: {
  stripCollapsed: boolean;
  zen: boolean;
  hideStripInZen: boolean;
}): boolean => s.stripCollapsed || (s.zen && s.hideStripInZen);

export const DEFAULT_APP_STATE: AppState = {
  tabs: [],
  activeIndex: 0,
  restoreAllTabs: false,
  stripCollapsed: false,
  zen: false,
  hideStripInZen: false,
};

function isTab(t: unknown): t is PersistedTab {
  const o = t as PersistedTab;
  return (
    typeof o?.url === 'string' &&
    typeof o.title === 'string' &&
    typeof o.pinned === 'boolean' &&
    (o.name === undefined || typeof o.name === 'string') &&
    (o.lockedUrl === undefined || typeof o.lockedUrl === 'string')
  );
}

export function loadAppState(file: string): AppState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const tabs = Array.isArray(raw.tabs) ? raw.tabs.filter(isTab) : [];
    return {
      tabs,
      activeIndex: Number.isInteger(raw.activeIndex) ? raw.activeIndex : 0,
      restoreAllTabs: raw.restoreAllTabs === true,
      stripCollapsed: raw.stripCollapsed === true,
      zen: raw.zen === true,
      hideStripInZen: raw.hideStripInZen === true,
    };
  } catch {
    return { ...DEFAULT_APP_STATE };
  }
}

export function saveAppState(file: string, state: AppState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash mid-write can't wipe the pins.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}
