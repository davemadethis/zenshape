import { describe, expect, it } from 'vitest';
import {
  cleanUserAgent,
  decideWindowOpen,
  isOnshapeUrl,
  inLockScope,
  isDocumentUrl,
  isDrawingFrameFor,
  isSignInPage,
  lockScope,
} from '../src/navigation';

describe('isOnshapeUrl', () => {
  it.each([
    ['https://cad.onshape.com/documents', true],
    ['https://onshape.com', true],
    ['https://acme.onshape.com', true],
    ['https://CAD.OnShape.com', true],
    ['http://cad.onshape.com', false],
    ['https://onshape.com.evil.com', false],
    ['https://evilonshape.com', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isOnshapeUrl(url)).toBe(expected);
  });
});

describe('isDocumentUrl', () => {
  it.each([
    [
      'https://cad.onshape.com/documents/a1b2c3d4e5f60718293a4b5c/w/0a0b0c0d0e0f101112131415/e/1f1e1d1c1b1a191817161514',
      true,
    ],
    ['https://cad.onshape.com/documents/a1b2c3d4e5f60718293a4b5c', true],
    ['https://cad.onshape.com/documents?nodeId=12&resourceType=filter', false],
    ['https://cad.onshape.com/documents', false],
    ['https://example.com/documents/a1b2c3d4e5f60718293a4b5c', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isDocumentUrl(url)).toBe(expected);
  });
});

describe('isSignInPage', () => {
  it.each([
    ['https://cad.onshape.com/signin', true],
    ['https://cad.onshape.com/signin?redirect=x', true],
    ['https://oauth.onshape.com/oauth/authorize', true],
    ['https://cad.onshape.com/documents/abc', false],
    ['https://example.com/signin', false],
  ])('%s → %s', (url, expected) => {
    expect(isSignInPage(url)).toBe(expected);
  });
});

describe('decideWindowOpen', () => {
  it.each([
    ['https://cad.onshape.com/documents/1', 'app-window'],
    ['about:blank', 'app-window'],
    ['https://github.com', 'external'],
    ['mailto:a@b.c', 'deny'],
    ['javascript:alert(1)', 'deny'],
  ])('%s → %s', (url, expected) => {
    expect(decideWindowOpen(url)).toBe(expected);
  });
});

describe('cleanUserAgent', () => {
  it('strips the app and Electron tokens', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Zenshape/0.1.0 Chrome/146.0.0.0 Electron/45.0.0 Safari/537.36';
    expect(cleanUserAgent(ua, 'Zenshape')).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    );
  });
});

describe('lock scopes', () => {
  const DOC = 'https://cad.onshape.com/documents/0123456789abcdef01234567';
  const FOLDER =
    'https://cad.onshape.com/documents?nodeId=abc&resourceType=folder';

  it.each([
    [`${DOC}/w/aaa/e/bbb`, 'doc:0123456789abcdef01234567'],
    [FOLDER, 'node:abc'],
    ['https://cad.onshape.com/appstore/', 'path:/appstore'],
    ['https://example.com/documents?nodeId=abc', null],
  ])('%s → %s', (url, scope) => {
    expect(lockScope(url)).toBe(scope);
  });

  it('a document lock allows anything inside the document', () => {
    expect(inLockScope(DOC, `${DOC}/w/aaa/e/bbb`)).toBe(true);
    expect(inLockScope(DOC, `${DOC}/v/ccc/e/ddd?renderMode=0`)).toBe(true);
    expect(
      inLockScope(
        DOC,
        'https://cad.onshape.com/documents/ffffffffffffffffffffffff/w/a',
      ),
    ).toBe(false);
  });

  it('a folder lock allows sorting/filters but not another folder or a document', () => {
    expect(inLockScope(FOLDER, `${FOLDER}&sort=modified`)).toBe(true);
    expect(
      inLockScope(
        FOLDER,
        'https://cad.onshape.com/documents?nodeId=xyz&resourceType=folder',
      ),
    ).toBe(false);
    expect(inLockScope(FOLDER, `${DOC}/w/aaa`)).toBe(false);
  });
});

describe('isDrawingFrameFor', () => {
  const page =
    'https://cad.onshape.com/documents/a1b2c3d4e5f60718293a4b5c/w/2a2b2c2d2e2f303132333435/e/3f3e3d3c3b3a393837363534';
  const frame = (host: string, element: string) =>
    `https://${host}/editor?documentId=a1b2c3d4e5f60718293a4b5c&workspaceId=2a2b2c2d2e2f303132333435&elementId=${element}`;
  const drawingHost = 'production-drawing-usw2c-102416.onshape.com';
  it.each([
    [frame(drawingHost, '3f3e3d3c3b3a393837363534'), page, true],
    // Kept from a drawing you switched away from.
    [frame(drawingHost, '1f1e1d1c1b1a191817161514'), page, false],
    [
      frame('production-pcb-usw2.onshape.com', '3f3e3d3c3b3a393837363534'),
      page,
      false,
    ],
    [frame('drawing.evil.com', '3f3e3d3c3b3a393837363534'), page, false],
    [page, page, false],
    [
      frame(drawingHost, '3f3e3d3c3b3a393837363534'),
      'https://cad.onshape.com/documents',
      false,
    ],
  ])('%s on %s → %s', (f, p, expected) => {
    expect(isDrawingFrameFor(f, p)).toBe(expected);
  });
});
