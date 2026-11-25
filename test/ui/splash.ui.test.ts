import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cdp, listTargets } from './cdp';
import { Ui, sleep } from './harness';
import { DISCLAIMER_TITLE } from '../../src/disclaimer';

// The logo-and-disclaimer view: at launch it goes by itself; as About it
// stays until dismissed.
let ui: Ui;
let splash: Cdp;

const visible = () => ui.win<boolean>('return w.splash.getVisible();');

beforeAll(async () => {
  ui = await Ui.connect();
  const t = (await listTargets(ui.cdpPort)).find(
    (t) => t.type === 'page' && t.url.endsWith('#splash'),
  );
  if (!t) throw new Error('UI: splash page not found');
  splash = await Cdp.connect(t.webSocketDebuggerUrl);
});
afterAll(() => {
  splash?.close();
  ui?.close();
});

describe('splash and About', () => {
  it('goes away by itself after launch', async () => {
    await ui.waitFor(
      'the launch splash to hide',
      async () => !(await visible()),
      6000,
    );
  });

  it('About covers the window with the logo and the disclaimer, and stays', async () => {
    await ui.win(`w.showSplash('about');`);
    await sleep(600);
    expect(await visible()).toBe(true);
    const [bounds, content] = await ui.win<
      [{ width: number; height: number }, { width: number; height: number }]
    >(`return [w.splash.getBounds(), w.window.getContentBounds()];`);
    expect(bounds.width).toBe(content.width);
    expect(bounds.height).toBe(content.height);
    const text = await splash.eval<string>('document.body.innerText');
    expect(text).toContain(DISCLAIMER_TITLE);
    expect(text).toMatch(/Version \d+\.\d+\.\d+/);
    expect(await splash.eval('!!document.querySelector(".splash-logo")')).toBe(
      true,
    );
    expect(await splash.eval('getComputedStyle(document.body).opacity')).toBe(
      '1',
    );
    await ui.screenshot(splash, 'about');
    await sleep(3000);
    expect(await visible()).toBe(true);
  });

  it('Esc dismisses it', async () => {
    for (const type of ['keyDown', 'keyUp']) {
      await splash.send('Input.dispatchKeyEvent', {
        type,
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
    }
    await ui.waitFor('About to hide', async () => !(await visible()), 2000);
  });
});
