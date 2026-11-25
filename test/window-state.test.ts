import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isVisibleOnSomeDisplay,
  loadWindowState,
  saveWindowState,
} from '../src/window-state';

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe('window state', () => {
  it('round-trips through disk', () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'zs-')),
      'a',
      's.json',
    );
    const state = {
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      maximized: true,
    };
    saveWindowState(file, state);
    expect(loadWindowState(file)).toEqual(state);
  });

  it('returns null for missing or corrupt files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-'));
    expect(loadWindowState(path.join(dir, 'missing.json'))).toBeNull();
    fs.writeFileSync(path.join(dir, 'bad.json'), '{"bounds":{"x":"a"}}');
    expect(loadWindowState(path.join(dir, 'bad.json'))).toBeNull();
  });

  it('rejects bounds left on an unplugged monitor', () => {
    expect(
      isVisibleOnSomeDisplay({ x: 100, y: 100, width: 800, height: 600 }, [
        display,
      ]),
    ).toBe(true);
    expect(
      isVisibleOnSomeDisplay({ x: 3000, y: 100, width: 800, height: 600 }, [
        display,
      ]),
    ).toBe(false);
  });
});
