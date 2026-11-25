import fs from 'node:fs';

// The parts of Electron's safeStorage used here, passed in so tests can fake
// it. Only the async calls: they share Chromium's one key with the cookie
// store, read from the OS store once per launch. The sync calls read the key
// again on their own, which on macOS is a second keychain prompt per new build.
export interface Crypto {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(cipher: Buffer): Promise<{ result: string }>;
  getSelectedStorageBackend?(): string;
}

export type CanSave = { ok: true } | { ok: false; reason: string };

export type Field = 'email' | 'password';

type Stored = Record<Field, string>;

// One saved Onshape login, encrypted under the OS store's key. The
// password's plain text is never kept: each read decrypts it for that one
// use. The email is kept once read, for the sign-in page's account readings.
export class SavedSignIn {
  // Bumped by every save and forget: whatever was worked out from the old
  // login (a sign-in page's account verdict) no longer holds.
  version = 0;
  // The saved email, decrypted once for the sign-in page's account
  // readings, which ask several times a second. Dropped on save and forget.
  private email: Promise<string | null> | null = null;

  constructor(
    private readonly file: string,
    private readonly crypto: Crypto,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async canSave(): Promise<CanSave> {
    // Linux without a keyring falls back to a key hard-coded in Chromium,
    // which protects nothing.
    if (
      this.platform === 'linux' &&
      this.crypto.getSelectedStorageBackend?.() === 'basic_text'
    )
      return {
        ok: false,
        reason:
          'No desktop keyring is running, so it couldn’t be stored safely.',
      };
    if (!(await this.crypto.isAsyncEncryptionAvailable()))
      return {
        ok: false,
        reason: 'This system’s key store isn’t available to encrypt it with.',
      };
    return { ok: true };
  }

  async save(email: string, password: string): Promise<CanSave> {
    const can = await this.canSave();
    if (!can.ok) return can;
    const stored: Stored = {
      email: (await this.crypto.encryptStringAsync(email)).toString('base64'),
      password: (await this.crypto.encryptStringAsync(password)).toString(
        'base64',
      ),
    };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.changed();
    // Success is only claimed once what was written reads back as typed.
    if (
      (await this.read('email')) !== email ||
      (await this.read('password')) !== password
    )
      return {
        ok: false,
        reason: 'It was written but didn’t read back. Nothing usable is saved.',
      };
    return can;
  }

  // Only looks for the file: deciding whether a login is saved never touches
  // the key store.
  get exists(): boolean {
    return fs.existsSync(this.file);
  }

  async read(field: Field): Promise<string | null> {
    if (field !== 'email') return this.decrypt(field);
    const pending = (this.email ??= this.decrypt('email'));
    const email = await pending;
    // A failed decrypt isn't kept: the next read tries again.
    if (email === null && this.email === pending) this.email = null;
    return email;
  }

  private async decrypt(field: Field): Promise<string | null> {
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Stored;
      const cipher = stored[field];
      if (typeof cipher !== 'string') return null;
      const { result } = await this.crypto.decryptStringAsync(
        Buffer.from(cipher, 'base64'),
      );
      return result;
    } catch {
      return null;
    }
  }

  forget(): void {
    fs.rmSync(this.file, { force: true });
    this.changed();
  }

  private changed(): void {
    this.version++;
    this.email = null;
  }
}
