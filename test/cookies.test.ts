import type { Cookie } from 'electron';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_LIFETIME_S, persistentCopy } from '../src/cookies';

const base: Cookie = {
  name: 'auth',
  value: 'v',
  domain: 'cad.onshape.com',
  hostOnly: true,
  path: '/',
  secure: true,
  httpOnly: true,
  session: true,
  sameSite: 'lax',
};

describe('persistentCopy', () => {
  it('gives Onshape session cookies an expiry, keeping their attributes', () => {
    expect(persistentCopy(base, 1000)).toEqual({
      url: 'https://cad.onshape.com/',
      name: 'auth',
      value: 'v',
      domain: undefined,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 1000 + SESSION_COOKIE_LIFETIME_S,
    });
  });

  it('keeps domain cookies as domain cookies', () => {
    const copy = persistentCopy(
      { ...base, domain: '.onshape.com', hostOnly: false },
      0,
    );
    expect(copy?.domain).toBe('.onshape.com');
    expect(copy?.url).toBe('https://onshape.com/');
  });

  it('leaves persistent cookies alone, so re-setting cannot loop', () => {
    expect(persistentCopy({ ...base, session: false }, 0)).toBeNull();
  });

  it('never touches other sites', () => {
    for (const domain of [
      'example.com',
      '.onshape.com.evil.com',
      'evilonshape.com',
    ]) {
      expect(persistentCopy({ ...base, domain }, 0)).toBeNull();
    }
  });
});
