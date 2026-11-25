import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { listTargets } from './cdp';
import { urls } from './targets';

declare module 'vitest' {
  interface ProvidedContext {
    zs: { cdpPort: number; inspectPort: number; outDir: string };
  }
}

const root = path.resolve(import.meta.dirname, '../..');
const devProfile = path.join(
  os.homedir(),
  'Library/Application Support/Zenshape Dev',
);

const freePort = () =>
  new Promise<number>((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  ms: number,
) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`UI setup: timed out waiting for ${what}`);
}

// A throwaway profile seeded with the dev login cookies, so tests never touch
// your own tabs or settings and don't need to sign in.
function makeProfile(): string {
  const cookies = path.join(devProfile, 'Partitions/zenshape/Cookies');
  if (!fs.existsSync(cookies)) {
    throw new Error(
      'UI setup: no dev login found. Sign in once via `npm start`, then rerun.',
    );
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zenshape-ui-'));
  const part = path.join(profile, 'Partitions/zenshape');
  fs.mkdirSync(part, { recursive: true });
  for (const f of ['Cookies', 'Cookies-journal']) {
    const src = path.join(devProfile, 'Partitions/zenshape', f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(part, f));
  }
  fs.writeFileSync(
    path.join(profile, 'app-state.json'),
    JSON.stringify({
      tabs: [{ url: urls.owned, title: '', pinned: false }],
      activeIndex: 0,
      restoreAllTabs: false,
      stripCollapsed: false,
      zen: false,
    }),
  );
  return profile;
}

let child: ChildProcess | undefined;
let profile: string | undefined;

export default async function setup(project: TestProject) {
  if (!process.env.ZS_SKIP_BUILD) {
    // Builds main, preload and the strip page into .vite/ (what `electron .` runs).
    execFileSync('npx', ['electron-forge', 'package'], {
      cwd: root,
      stdio: 'inherit',
    });
  }
  profile = makeProfile();
  const outDir = path.join(root, 'test-results/ui');
  fs.mkdirSync(outDir, { recursive: true });
  const cdpPort = await freePort();
  const inspectPort = await freePort();
  const electron = createRequire(import.meta.url)(
    'electron',
  ) as unknown as string;
  child = spawn(
    electron,
    [`--inspect=${inspectPort}`, '.', `--remote-debugging-port=${cdpPort}`],
    {
      cwd: root,
      env: { ...process.env, ZENSHAPE_E2E: '1', ZENSHAPE_USER_DATA: profile },
      stdio: 'ignore',
    },
  );

  const page = await waitFor(
    'an Onshape page',
    async () =>
      (await listTargets(cdpPort)).find(
        (t) => t.type === 'page' && t.url.startsWith('https://cad.onshape.com'),
      ),
    60_000,
  );
  await waitFor(
    'the main-process inspector',
    async () =>
      (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).ok ||
      undefined,
    30_000,
  );
  // Give redirects a moment, then fail fast if the copied login didn't take.
  await new Promise((r) => setTimeout(r, 4000));
  const now = (await listTargets(cdpPort)).find((t) => t.id === page.id);
  if (now?.url.includes('/signin')) {
    // Otherwise every failed run leaves another window open.
    child.kill('SIGTERM');
    throw new Error(
      'UI setup: Onshape asked to sign in. Sign in once via `npm start`, then rerun.',
    );
  }

  project.provide('zs', { cdpPort, inspectPort, outDir });

  return async () => {
    child?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  };
}
