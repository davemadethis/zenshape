import type { Cookie, CookiesSetDetails } from 'electron';

export const SESSION_COOKIE_LIFETIME_S = 30 * 24 * 60 * 60;

function isOnshapeDomain(domain: string | undefined): boolean {
  const host = (domain ?? '').replace(/^\./, '').toLowerCase();
  return host === 'onshape.com' || host.endsWith('.onshape.com');
}

// WORKAROUND: Onshape's login cookies are session cookies, and Chromium drops
// session cookies on quit (Chrome only keeps them with "Continue where you
// left off"). Re-setting them with an expiry makes the login survive a restart.
// Returns null for anything that should be left alone.
export function persistentCopy(
  cookie: Cookie,
  nowSeconds: number,
): CookiesSetDetails | null {
  if (!cookie.session || !isOnshapeDomain(cookie.domain)) return null;
  const host = (cookie.domain ?? '').replace(/^\./, '');
  return {
    url: `https://${host}${cookie.path ?? '/'}`,
    name: cookie.name,
    value: cookie.value,
    // Passing a domain turns a host-only cookie into a domain cookie.
    domain: cookie.hostOnly ? undefined : cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: nowSeconds + SESSION_COOKIE_LIFETIME_S,
  };
}
