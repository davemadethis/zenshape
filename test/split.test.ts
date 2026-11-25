import { describe, expect, it } from 'vitest';
import {
  DIVIDER,
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
} from '../src/split';

const area = { x: 0, y: 36, width: 1006, height: 806 };
const split = { a: 'A', b: 'B', direction: 'row' as const, ratio: 0.5 };

describe('split', () => {
  it('lays out side by side with the divider between, filling the area', () => {
    const { a, b, divider } = splitLayout(area, split);
    expect(a).toEqual({ x: 0, y: 36, width: 500, height: 806 });
    expect(divider).toEqual({ x: 500, y: 36, width: DIVIDER, height: 806 });
    expect(b).toEqual({ x: 506, y: 36, width: 500, height: 806 });
  });

  it('lays out top and bottom', () => {
    const { a, b, divider } = splitLayout(area, {
      direction: 'column',
      ratio: 0.25,
    });
    expect(a.height + divider.height + b.height).toBe(area.height);
    expect(a.height).toBe(200);
    expect(b.y).toBe(area.y + 200 + DIVIDER);
    expect(a.width).toBe(area.width);
  });

  it('keeps each pane at least 15%', () => {
    expect(clampRatio(0)).toBe(0.15);
    expect(clampRatio(1)).toBe(0.85);
    expect(
      splitLayout(area, { direction: 'row', ratio: 0.99 }).b.width,
    ).toBeGreaterThan(140);
  });

  it('knows the pair', () => {
    expect(inSplit(split, 'A')).toBe(true);
    expect(inSplit(split, 'C')).toBe(false);
    expect(inSplit(null, 'A')).toBe(false);
    expect(partner(split, 'A')).toBe('B');
    expect(partner(split, 'B')).toBe('A');
    expect(partner(split, 'C')).toBeNull();
  });

  it('picks the nearest page edge', () => {
    expect(edgeZone(area, 50, 400)).toBe('left');
    expect(edgeZone(area, 950, 400)).toBe('right');
    expect(edgeZone(area, 500, 60)).toBe('top');
    expect(edgeZone(area, 500, 800)).toBe('bottom');
  });

  it('previews the half a drop would take', () => {
    expect(zoneRect(area, 'right')).toEqual({
      x: 503,
      y: 36,
      width: 503,
      height: 806,
    });
    expect(zoneRect(area, 'top')).toEqual({
      x: 0,
      y: 36,
      width: 1006,
      height: 403,
    });
  });

  it('places the dragged tab on the dropped side', () => {
    expect(placeAt('X', 'D', 'left')).toEqual({
      a: 'D',
      b: 'X',
      direction: 'row',
      ratio: 0.5,
    });
    expect(placeAt('X', 'D', 'right')).toEqual({
      a: 'X',
      b: 'D',
      direction: 'row',
      ratio: 0.5,
    });
    expect(placeAt('X', 'D', 'top').direction).toBe('column');
    expect(placeAt('X', 'D', 'bottom').b).toBe('D');
  });

  it('knows which pane a point is over', () => {
    expect(paneAt(area, split, 100, 300)).toBe('a');
    expect(paneAt(area, split, 900, 300)).toBe('b');
    const col = { ...split, direction: 'column' as const };
    expect(paneAt(area, col, 500, 100)).toBe('a');
    expect(paneAt(area, col, 500, 700)).toBe('b');
  });

  it('swaps sides keeping each pane its size, and rotates keeping order', () => {
    const s = { ...split, ratio: 0.3 };
    expect(swapped(s)).toMatchObject({ a: 'B', b: 'A', direction: 'row' });
    expect(swapped(s).ratio).toBeCloseTo(0.7);
    expect(rotated(s)).toMatchObject({
      a: 'A',
      b: 'B',
      direction: 'column',
      ratio: 0.3,
    });
  });
});
