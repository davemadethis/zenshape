export type SplitDirection = 'row' | 'column';

export interface Split {
  // `a` is left/top, `b` is right/bottom.
  a: string;
  b: string;
  direction: SplitDirection;
  // Share of the area given to `a`.
  ratio: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DIVIDER = 6;
export const MIN_RATIO = 0.15;

export const clampRatio = (r: number) =>
  Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, r));

export const inSplit = (split: Split | null, id: string | null) =>
  !!split && !!id && (split.a === id || split.b === id);

export function partner(split: Split | null, id: string): string | null {
  if (!split) return null;
  if (split.a === id) return split.b;
  if (split.b === id) return split.a;
  return null;
}

// The two panes and the divider between them, filling `area`.
export function splitLayout(
  area: Rect,
  split: Pick<Split, 'direction' | 'ratio'>,
): { a: Rect; b: Rect; divider: Rect } {
  const row = split.direction === 'row';
  const total = row ? area.width : area.height;
  const first = Math.round((total - DIVIDER) * clampRatio(split.ratio));
  const second = total - DIVIDER - first;
  if (row) {
    return {
      a: { ...area, width: first },
      divider: { ...area, x: area.x + first, width: DIVIDER },
      b: { ...area, x: area.x + first + DIVIDER, width: second },
    };
  }
  return {
    a: { ...area, height: first },
    divider: { ...area, y: area.y + first, height: DIVIDER },
    b: { ...area, y: area.y + first + DIVIDER, height: second },
  };
}

export type Zone = 'left' | 'right' | 'top' | 'bottom';

// The page edge the pointer is closest to, relative to the area's size.
export function edgeZone(area: Rect, x: number, y: number): Zone {
  const fx = (x - area.x) / area.width;
  const fy = (y - area.y) / area.height;
  const dist: [Zone, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  return dist.reduce((best, d) => (d[1] < best[1] ? d : best))[0];
}

// The half of the area a tab dropped on `zone` would take.
export function zoneRect(area: Rect, zone: Zone): Rect {
  const halfW = Math.round(area.width / 2);
  const halfH = Math.round(area.height / 2);
  switch (zone) {
    case 'left':
      return { ...area, width: halfW };
    case 'right':
      return { ...area, x: area.x + area.width - halfW, width: halfW };
    case 'top':
      return { ...area, height: halfH };
    case 'bottom':
      return { ...area, y: area.y + area.height - halfH, height: halfH };
  }
}

// `dragged` goes on the `zone` side, `other` on the opposite side.
export function placeAt(other: string, dragged: string, zone: Zone): Split {
  const first = zone === 'left' || zone === 'top';
  return {
    a: first ? dragged : other,
    b: first ? other : dragged,
    direction: zone === 'left' || zone === 'right' ? 'row' : 'column',
    ratio: 0.5,
  };
}

export function paneAt(
  area: Rect,
  split: Split,
  x: number,
  y: number,
): 'a' | 'b' {
  const { b } = splitLayout(area, split);
  return split.direction === 'row'
    ? x < b.x
      ? 'a'
      : 'b'
    : y < b.y
      ? 'a'
      : 'b';
}

export const swapped = (s: Split): Split => ({
  ...s,
  a: s.b,
  b: s.a,
  ratio: 1 - s.ratio,
});

export const rotated = (s: Split): Split => ({
  ...s,
  direction: s.direction === 'row' ? 'column' : 'row',
});
