import fs from 'node:fs';
import path from 'node:path';

// A diagnostic trail of the sign-in: events, timings, where the page was
// (host and path only, never the query) and what had focus. Never a value:
// no email, no password, no field text.
export type LogValue = string | number | boolean | null;

const MAX_BYTES = 256 * 1024;

let file: string | null = null;
const started = Date.now();

export function startSignInLog(dir: string, name = 'sign-in.log'): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, name);
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES)
      fs.rmSync(file, { force: true });
  } catch {
    file = null;
  }
}

// Host and path of a URL, nothing that could carry a value.
export function where(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(none)';
  }
}

export function signInLog(
  event: string,
  details: Record<string, LogValue> = {},
): void {
  if (!file) return;
  const parts = Object.entries(details).map(([k, v]) => `${k}=${v}`);
  const line = `${new Date().toISOString()} +${Date.now() - started}ms ${event} ${parts.join(' ')}\n`;
  try {
    fs.appendFileSync(file, line);
  } catch {
    // Diagnostics never get in the way.
  }
}
