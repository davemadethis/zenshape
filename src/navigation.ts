// The documents page, not the site root: when signed in, the root hops through
// /signin on its way here, which would look like a sign-in to tab-views.
export const ONSHAPE_HOME = 'https://cad.onshape.com/documents';

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isHttpUrl(url: string): boolean {
  const parsed = parse(url);
  return parsed?.protocol === 'https:' || parsed?.protocol === 'http:';
}

// Covers cad., oauth. and enterprise <company>.onshape.com.
export function isOnshapeUrl(url: string): boolean {
  const parsed = parse(url);
  if (parsed?.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'onshape.com' || host.endsWith('.onshape.com');
}

// Where Onshape sends you when the session has lapsed. A tab passing through
// here shouldn't forget which document it was for.
export function isSignInPage(url: string): boolean {
  const parsed = parse(url);
  if (!parsed || !isOnshapeUrl(url)) return false;
  return (
    parsed.hostname.toLowerCase().startsWith('oauth.') ||
    parsed.pathname.startsWith('/signin')
  );
}

export type OpenDecision = 'app-window' | 'external' | 'deny';

export function decideWindowOpen(url: string): OpenDecision {
  // Pages commonly open a blank window and then navigate it; the child's own
  // will-navigate policy still applies to wherever it goes next.
  if (url === 'about:blank' || isOnshapeUrl(url)) return 'app-window';
  if (isHttpUrl(url)) return 'external';
  return 'deny';
}

// Zenshape's user agent: Chromium's, without the Electron and app tokens.
export function cleanUserAgent(ua: string, appName: string): string {
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ua
    .replace(new RegExp(`\\s+${escaped}/\\S+`, 'gi'), '')
    .replace(/\s+Electron\/\S+/gi, '');
}

const DOCUMENT_PATH = /^\/documents\/([0-9a-f]{24})(\/|$)/i;

// A document (Part Studio, Assembly, …), as opposed to a list or other page.
export function isDocumentUrl(url: string): boolean {
  const parsed = parse(url);
  return !!parsed && isOnshapeUrl(url) && DOCUMENT_PATH.test(parsed.pathname);
}

const ELEMENT_PATH =
  /^\/documents\/[0-9a-f]{24}\/[wvm]\/[0-9a-f]{24}\/e\/([0-9a-f]{24})/i;

// Drawings are drawn by a frame from their own host
// (production-drawing-….onshape.com/editor?…&elementId=…). Onshape may keep
// that frame after you switch elements, so it only counts for the element
// the page is showing.
export function isDrawingFrameFor(frameUrl: string, pageUrl: string): boolean {
  const frame = parse(frameUrl);
  const page = parse(pageUrl);
  if (!frame || !page || !isOnshapeUrl(frameUrl)) return false;
  if (!frame.hostname.toLowerCase().includes('drawing')) return false;
  const element = page.pathname.match(ELEMENT_PATH)?.[1];
  return (
    !!element &&
    frame.searchParams.get('elementId')?.toLowerCase() === element.toLowerCase()
  );
}

// What a locked tab is locked to. Moving within the same scope is fine;
// leaving it opens a new tab instead.
export function lockScope(url: string): string | null {
  const parsed = parse(url);
  if (!parsed || !isOnshapeUrl(url)) return null;
  const doc = parsed.pathname.match(DOCUMENT_PATH);
  if (doc) return `doc:${doc[1].toLowerCase()}`;
  const node = parsed.searchParams.get('nodeId');
  if (node) return `node:${node}`;
  return `path:${parsed.pathname.replace(/\/+$/, '') || '/'}`;
}

export function inLockScope(lockedUrl: string, url: string): boolean {
  const scope = lockScope(lockedUrl);
  return scope !== null && scope === lockScope(url);
}
