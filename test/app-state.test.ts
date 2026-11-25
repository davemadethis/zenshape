import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_STATE,
  isStripHidden,
  loadAppState,
  saveAppState,
} from '../src/app-state';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zs-'));

describe('app state', () => {
  it('round-trips through disk', () => {
    const file = path.join(tmp(), 'state.json');
    const state = {
      tabs: [
        {
          url: 'https://cad.onshape.com',
          title: 'Home',
          pinned: true,
          name: 'Mine',
          lockedUrl: 'https://cad.onshape.com/documents?nodeId=x',
        },
      ],
      activeIndex: 0,
      restoreAllTabs: true,
      stripCollapsed: true,
      zen: true,
      hideStripInZen: true,
    };
    saveAppState(file, state);
    expect(loadAppState(file)).toEqual(state);
  });

  it('defaults to pins-only and an expanded strip', () => {
    expect(loadAppState(path.join(tmp(), 'missing.json'))).toEqual(
      DEFAULT_APP_STATE,
    );
    expect(DEFAULT_APP_STATE.restoreAllTabs).toBe(false);
  });

  it('drops malformed tabs instead of failing the whole file', () => {
    const file = path.join(tmp(), 'state.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        tabs: [{ url: 'ok', title: 't', pinned: false }, { url: 3 }],
        activeIndex: 'x',
      }),
    );
    const state = loadAppState(file);
    expect(state.tabs).toHaveLength(1);
    expect(state.activeIndex).toBe(0);
  });

  it('hides the tab bar when asked, or in zen mode if that setting is on', () => {
    const hidden = (
      stripCollapsed: boolean,
      zen: boolean,
      hideStripInZen: boolean,
    ) => isStripHidden({ stripCollapsed, zen, hideStripInZen });
    expect(hidden(false, false, true)).toBe(false);
    expect(hidden(false, true, false)).toBe(false);
    expect(hidden(false, true, true)).toBe(true);
    expect(hidden(true, false, false)).toBe(true);
    // Zen off brings back whatever Hide Tab Bar says.
    expect(hidden(true, false, true)).toBe(true);
  });
});
