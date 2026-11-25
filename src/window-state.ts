import fs from 'node:fs';
import path from 'node:path';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1400, height: 900 };

export function loadWindowState(file: string): WindowState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const b = raw?.bounds;
    const valid =
      b &&
      [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
      b.width > 0 &&
      b.height > 0;
    return valid ? { bounds: b, maximized: raw.maximized === true } : null;
  } catch {
    return null;
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
}

// A monitor that was unplugged since last run would leave the window off-screen.
export function isVisibleOnSomeDisplay(
  bounds: Rect,
  workAreas: Rect[],
): boolean {
  const MIN_OVERLAP = 100;
  return workAreas.some((a) => {
    const w =
      Math.min(bounds.x + bounds.width, a.x + a.width) -
      Math.max(bounds.x, a.x);
    const h =
      Math.min(bounds.y + bounds.height, a.y + a.height) -
      Math.max(bounds.y, a.y);
    return w >= MIN_OVERLAP && h >= MIN_OVERLAP;
  });
}
