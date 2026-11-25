import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, net: {} }));
vi.mock('update-electron-app', () => ({
  UpdateSourceType: {},
  updateElectronApp: vi.fn(),
}));

const { isNewer, pickUpdate } = await import('../src/updates');

const page = (tag: string) =>
  `https://github.com/davemadethis/zenshape/releases/tag/${tag}`;

describe('isNewer', () => {
  it('compares x.y.z numerically, with or without a v', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });

  it('never treats a prerelease or junk as newer', () => {
    expect(isNewer('v9.0.0-beta.1', '0.1.0')).toBe(false);
    expect(isNewer('latest', '0.1.0')).toBe(false);
    expect(isNewer('', '0.1.0')).toBe(false);
  });
});

describe('pickUpdate', () => {
  it('offers a newer release with its page', () => {
    expect(
      pickUpdate({ tag_name: 'v0.2.0', html_url: page('v0.2.0') }, '0.1.0'),
    ).toEqual({ version: '0.2.0', url: page('v0.2.0') });
  });

  it('offers nothing for the running version or older', () => {
    expect(
      pickUpdate({ tag_name: 'v0.1.0', html_url: page('v0.1.0') }, '0.1.0'),
    ).toBeNull();
  });

  it('ignores links outside this repo’s releases', () => {
    expect(
      pickUpdate(
        { tag_name: 'v0.2.0', html_url: 'https://example.com/zenshape' },
        '0.1.0',
      ),
    ).toBeNull();
  });

  it('ignores malformed responses', () => {
    expect(pickUpdate(null, '0.1.0')).toBeNull();
    expect(pickUpdate({ message: 'Not Found' }, '0.1.0')).toBeNull();
  });
});
