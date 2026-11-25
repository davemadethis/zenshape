import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SavedSignIn, type Crypto } from '../src/saved-sign-in';

const EMAIL = 'fake-user@example.test';
const PASSWORD = 'fake-password-1';

// Reversible but not plain: reversed and tagged, so plain text never shows.
// Every call is recorded.
function fakeCrypto(calls: string[] = [], over: Partial<Crypto> = {}): Crypto {
  return {
    isAsyncEncryptionAvailable: () => {
      calls.push('available');
      return Promise.resolve(true);
    },
    encryptStringAsync: (s) => {
      calls.push('encrypt');
      return Promise.resolve(Buffer.from(`enc:${[...s].reverse().join('')}`));
    },
    decryptStringAsync: (b) => {
      calls.push('decrypt');
      return Promise.resolve({
        result: [...b.toString().slice(4)].reverse().join(''),
      });
    },
    getSelectedStorageBackend: () => 'gnome_libsecret',
    ...over,
  };
}

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenshape-signin-'));
  file = path.join(dir, 'saved-sign-in.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('SavedSignIn on a real disk', () => {
  it('saves, then a separate instance on the same file finds and reads it', async () => {
    expect(
      await new SavedSignIn(file, fakeCrypto()).save(EMAIL, PASSWORD),
    ).toEqual({ ok: true });
    const later = new SavedSignIn(file, fakeCrypto());
    expect(later.exists).toBe(true);
    expect(await later.read('email')).toBe(EMAIL);
    expect(await later.read('password')).toBe(PASSWORD);
  });

  it('writes only ciphertext', async () => {
    await new SavedSignIn(file, fakeCrypto()).save(EMAIL, PASSWORD);
    const written = fs.readFileSync(file, 'utf8');
    expect(written).not.toContain(EMAIL);
    expect(written).not.toContain(PASSWORD);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('checking for a saved login never calls the key store', async () => {
    const calls: string[] = [];
    const saved = new SavedSignIn(file, fakeCrypto(calls));
    expect(saved.exists).toBe(false);
    expect(calls).toEqual([]);
    await new SavedSignIn(file, fakeCrypto()).save(EMAIL, PASSWORD);
    expect(saved.exists).toBe(true);
    expect(calls).toEqual([]);
  });

  it('Forget deletes the file', async () => {
    const saved = new SavedSignIn(file, fakeCrypto());
    await saved.save(EMAIL, PASSWORD);
    saved.forget();
    expect(fs.existsSync(file)).toBe(false);
    expect(saved.exists).toBe(false);
    expect(await saved.read('email')).toBeNull();
  });

  it('refuses on Linux without a keyring, writes nothing, and asks the key store nothing', async () => {
    const calls: string[] = [];
    const saved = new SavedSignIn(
      file,
      fakeCrypto(calls, { getSelectedStorageBackend: () => 'basic_text' }),
      'linux',
    );
    const result = await saved.save(EMAIL, PASSWORD);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/keyring/);
    expect(fs.existsSync(file)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses when encryption is unavailable', async () => {
    const saved = new SavedSignIn(
      file,
      fakeCrypto([], {
        isAsyncEncryptionAvailable: () => Promise.resolve(false),
      }),
    );
    expect((await saved.save(EMAIL, PASSWORD)).ok).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('claims success only if it reads back', async () => {
    const saved = new SavedSignIn(
      file,
      fakeCrypto([], {
        decryptStringAsync: () => Promise.resolve({ result: 'something else' }),
      }),
    );
    expect((await saved.save(EMAIL, PASSWORD)).ok).toBe(false);
  });
});

describe('the saved email for account readings', () => {
  it('is decrypted once, and again after a save or forget (version bumps)', async () => {
    const calls: string[] = [];
    const saved = new SavedSignIn(file, fakeCrypto(calls));
    await saved.save(EMAIL, PASSWORD);
    const v = saved.version;
    calls.length = 0;
    await saved.read('email');
    await saved.read('email');
    expect(calls.filter((c) => c === 'decrypt')).toHaveLength(0);
    await saved.save('b@example.test', 'pw-b');
    expect(saved.version).toBe(v + 1);
    expect(await saved.read('email')).toBe('b@example.test');
    saved.forget();
    expect(saved.version).toBe(v + 2);
    expect(await saved.read('email')).toBeNull();
  });
});

describe('a failed decrypt of the email', () => {
  it('isn’t kept: the next read tries again', async () => {
    let fail = true;
    const saved = new SavedSignIn(
      file,
      fakeCrypto([], {
        decryptStringAsync: (b) =>
          fail
            ? Promise.reject(new Error('locked'))
            : Promise.resolve({
                result: [...b.toString().slice(4)].reverse().join(''),
              }),
      }),
    );
    fail = false;
    await saved.save(EMAIL, PASSWORD);
    saved.forget();
    await new SavedSignIn(file, fakeCrypto()).save(EMAIL, PASSWORD);
    fail = true;
    expect(await saved.read('email')).toBeNull();
    fail = false;
    expect(await saved.read('email')).toBe(EMAIL);
  });
});
