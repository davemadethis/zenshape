import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// On Windows, Chromium treats a page that an opaque view covers completely
// as hidden and drops keys sent to it. Zenshape's page covers Onshape's
// sign-in page during the Sign in run, so the run's Return never arrived
// (seen 2026-11-25, reproduced in a scratch Electron 45 run on Windows).
describe('the page over the sign-in page (splash)', () => {
  it('never paints a fully opaque background', () => {
    const css = readFileSync(join(__dirname, '../src/strip/strip.css'), 'utf8');
    const rule = css.match(/body\.splash\s*\{([^}]*)\}/)?.[1] ?? '';
    const background = rule.match(/background:\s*([^;]+);/)?.[1] ?? '';
    expect(background).toMatch(
      /color-mix\(in srgb, var\(--bar\) 99%, transparent\)/,
    );
  });
});
