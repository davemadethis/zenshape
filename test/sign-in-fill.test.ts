import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SavedSignIn } from '../src/saved-sign-in';
import type { Field } from '../src/saved-sign-in';
import {
  FillState,
  pressed,
  fillField,
  pressReturn,
  takeReading,
  type FillPage,
  type Trigger,
} from '../src/sign-in-fill';

const EMAIL = 'fake-user@example.test';
const PASSWORD = 'fake-password-1';
const OTHER = 'someone-else@example.test';

// A fake sign-in page behind the DevTools protocol: the focused input, the
// email inputs' live values, and hooks into the decrypt.
function fake() {
  const f = {
    current: true,
    focused: true,
    focus: { kind: 'email' as Field | 'other', empty: true } as {
      kind: Field | 'other';
      empty: boolean;
    } | null,
    emails: [] as string[],
    typed: [] as string[],
    keys: [] as string[],
    focusCalls: 0,
    onDecrypt: null as null | (() => void),
    saved: { email: EMAIL, password: PASSWORD } as Record<Field, string>,
    logs: [] as Array<[string, Record<string, unknown>]>,
  };
  const attrs = (kind: string) =>
    kind === 'password'
      ? ['type', 'password']
      : kind === 'email'
        ? ['type', 'text', 'name', 'username']
        : ['type', 'text', 'name', 'company'];
  const page: FillPage = {
    isCurrent: () => f.current,
    send: (method, params) => {
      const p = params as { selector?: string; nodeId?: number } | undefined;
      switch (method) {
        case 'DOM.getDocument':
          return Promise.resolve({ root: { nodeId: 1 } });
        case 'DOM.querySelector':
          return Promise.resolve({ nodeId: f.focus && f.focused ? 7 : 0 });
        case 'DOM.querySelectorAll':
          return Promise.resolve({ nodeIds: f.emails.map((_, i) => 100 + i) });
        case 'DOM.getAttributes':
          return Promise.resolve({ attributes: attrs(f.focus!.kind) });
        case 'Accessibility.getPartialAXTree':
          return Promise.resolve({
            nodes: [
              {
                value: {
                  value:
                    p!.nodeId! >= 100
                      ? f.emails[p!.nodeId! - 100]
                      : f.focus!.empty
                        ? ''
                        : 'x',
                },
              },
            ],
          });
        default:
          return Promise.reject(new Error(`unexpected ${method}`));
      }
    },
    keyboard: {
      focus: () => {
        f.focusCalls++;
        f.focused = true;
      },
      isFocused: () => f.focused,
      insertText: (text) => {
        f.typed.push(text);
        if (f.focus) f.focus = { ...f.focus, empty: false };
        return Promise.resolve();
      },
      sendInputEvent: (e) => {
        f.keys.push(`${e.type}:${e.keyCode}`);
      },
    },
  };
  const login = {
    exists: true,
    version: 0,
    read: (field: Field) => {
      f.onDecrypt?.();
      return Promise.resolve(f.saved[field]);
    },
  };
  const log = (e: string, d: Record<string, unknown>) => {
    f.logs.push([e, d]);
  };
  const state = new FillState();
  const fill = (field: Field, trigger: Trigger = 'focus') =>
    fillField(page, state, login, field, trigger, log as never);
  return { f, page, login, state, fill };
}

describe('fillField, guard by guard', () => {
  it('types an empty focused field of the asked kind, and marks it filled', async () => {
    const { f, state, fill } = fake();
    expect(await fill('email')).toEqual({ kind: 'typed' });
    expect(f.typed).toEqual([EMAIL]);
    expect(state.filled.has('email')).toBe(true);
  });

  it('1. one fill at a time on a page: busy', async () => {
    const { f, fill } = fake();
    const first = fill('email');
    expect(await fill('email')).toEqual({ kind: 'busy' });
    await first;
    expect(f.typed).toEqual([EMAIL]);
  });

  it('2. not this sign-in page: left', async () => {
    const { f, fill } = fake();
    f.current = false;
    expect(await fill('email')).toEqual({ kind: 'left' });
    expect(f.typed).toEqual([]);
  });

  it('3. nothing saved: skipped', async () => {
    const { f, login, fill } = fake();
    login.exists = false;
    expect((await fill('email')).kind).toBe('skipped');
    expect(f.typed).toEqual([]);
  });

  it('4. once per page for the automatic trigger, again for an explicit one', async () => {
    const { f, fill } = fake();
    await fill('email');
    f.focus = { kind: 'email', empty: true };
    expect((await fill('email', 'focus')).kind).toBe('skipped');
    expect(await fill('email', 'run')).toEqual({ kind: 'typed' });
    expect(f.typed).toEqual([EMAIL, EMAIL]);
  });

  it('5. focus is moved only for an explicit trigger', async () => {
    const auto = fake();
    auto.f.focused = false;
    expect((await auto.fill('email', 'focus')).kind).toBe('skipped');
    expect(auto.f.focusCalls).toBe(0);
    const run = fake();
    run.f.focused = false;
    expect(await run.fill('email', 'run')).toEqual({ kind: 'typed' });
    expect(run.f.focusCalls).toBe(1);
  });

  it('6. the field: text in it, the other kind, or nothing focused types nothing', async () => {
    for (const focus of [
      { kind: 'email', empty: false },
      { kind: 'password', empty: true },
      { kind: 'other', empty: true },
      null,
    ] as const) {
      const { f, fill } = fake();
      f.focus = focus;
      expect((await fill('email')).kind).toBe('skipped');
      expect(f.typed).toEqual([]);
    }
  });

  it('9. re-read after the decrypt: the page leaving, or focus moving, types nothing', async () => {
    const left = fake();
    left.f.onDecrypt = () => (left.f.current = false);
    expect((await left.fill('email')).kind).toBe('left');
    const moved = fake();
    moved.f.onDecrypt = () => (moved.f.focus = { kind: 'other', empty: true });
    expect((await moved.fill('email')).kind).toBe('skipped');
    expect([...left.f.typed, ...moved.f.typed]).toEqual([]);
  });
});

describe('the account check (password)', () => {
  const atPassword = () => {
    const t = fake();
    t.f.focus = { kind: 'password', empty: true };
    return t;
  };

  it('live same: typed, and the log says live, never an email', async () => {
    const { f, fill } = atPassword();
    f.emails = [EMAIL];
    expect(await fill('password')).toEqual({ kind: 'typed' });
    expect(f.typed).toEqual([PASSWORD]);
    expect(f.logs).toContainEqual([
      'account',
      { source: 'live', verdict: 'same' },
    ]);
    expect(JSON.stringify(f.logs)).not.toContain(EMAIL);
  });

  it('live other, in any of the email inputs: nothing, for good on this page', async () => {
    const { f, state, fill } = atPassword();
    f.emails = [EMAIL, OTHER];
    expect((await fill('password')).kind).toBe('skipped');
    f.emails = [EMAIL];
    expect((await fill('password', 'run')).kind).toBe('skipped');
    expect(state.otherAccount).toBe(true);
    expect(f.typed).toEqual([]);
    expect(JSON.stringify(f.logs)).not.toContain(OTHER);
  });

  it('no reading and no verdict: nothing', async () => {
    const { f, fill } = atPassword();
    expect((await fill('password')).kind).toBe('skipped');
    expect(f.typed).toEqual([]);
  });

  it('no live reading: the verdict taken at Continue decides', async () => {
    const { f, page, state, login, fill } = atPassword();
    f.emails = [EMAIL];
    await takeReading(page, state, login);
    f.emails = []; // the email step is gone
    expect(await fill('password')).toEqual({ kind: 'typed' });
    expect(f.logs).toContainEqual([
      'account',
      { source: 'at-continue', verdict: 'same' },
    ]);
  });

  it('a key or press clears the verdict', async () => {
    const { f, page, state, login, fill } = atPassword();
    f.emails = [EMAIL];
    await takeReading(page, state, login);
    pressed(state);
    f.emails = [];
    expect((await fill('password')).kind).toBe('skipped');
    expect(f.typed).toEqual([]);
  });

  it('a reading begun before a key or press doesn’t count', async () => {
    const { f, page, state, login, fill } = atPassword();
    f.emails = [EMAIL];
    const reading = takeReading(page, state, login);
    pressed(state); // ⌘V, Return…
    await reading;
    f.emails = [];
    expect(state.verdict).toBeNull();
    expect((await fill('password')).kind).toBe('skipped');
  });

  it('applies to the run too', async () => {
    const { f, fill } = atPassword();
    f.emails = [OTHER];
    expect((await fill('password', 'run')).kind).toBe('skipped');
    expect(f.typed).toEqual([]);
  });
});

describe('every trigger, every unsafe state: nothing typed, no key', () => {
  const triggers: Trigger[] = ['focus', 'run'];
  const states: Array<[string, (t: ReturnType<typeof fake>) => void, Field]> = [
    [
      'the URL leaves during the decrypt',
      (t) => (t.f.onDecrypt = () => (t.f.current = false)),
      'email',
    ],
    [
      'focus moves during the decrypt',
      (t) =>
        (t.f.onDecrypt = () => (t.f.focus = { kind: 'other', empty: true })),
      'email',
    ],
    [
      'the field has text',
      (t) => (t.f.focus = { kind: 'email', empty: false }),
      'email',
    ],
    [
      'the field is the other kind',
      (t) => (t.f.focus = { kind: 'password', empty: true }),
      'email',
    ],
    [
      'another account’s email',
      (t) => {
        t.f.focus = { kind: 'password', empty: true };
        t.f.emails = [OTHER];
      },
      'password',
    ],
    ['not the active sign-in tab', (t) => (t.f.current = false), 'email'],
    ['another fill in flight', (t) => (t.state.busy = true), 'email'],
  ];
  for (const trigger of triggers)
    for (const [name, set, field] of states)
      it(`${trigger}: ${name}`, async () => {
        const t = fake();
        set(t);
        expect((await t.fill(field, trigger)).kind).not.toBe('typed');
        expect(t.f.typed).toEqual([]);
        expect(t.f.keys).toEqual([]);
      });
});

describe('pressReturn', () => {
  it('sends Return as a keyboard does', () => {
    const { f, page } = fake();
    expect(pressReturn(page)).toBe(true);
    expect(f.keys).toEqual(['keyDown:Return', 'char:\r', 'keyUp:Return']);
  });

  it('the reading taken at its own keyDown (as Electron fires before-input-event) decides the password', async () => {
    const { f, page, state, login, fill } = fake();
    // tab-views' key handler, run synchronously from the keyDown.
    const send = page.keyboard.sendInputEvent;
    let reading: Promise<void> | undefined;
    page.keyboard.sendInputEvent = (e) => {
      if (e.type === 'keyDown') {
        pressed(state);
        reading = takeReading(page, state, login);
      }
      send(e);
    };
    f.emails = [EMAIL];
    pressReturn(page);
    await reading;
    f.emails = []; // no email input once the page has moved on
    f.focus = { kind: 'password', empty: true };
    expect(await fill('password', 'run')).toEqual({ kind: 'typed' });
  });

  it('presses nothing once the page has left', () => {
    const { f, page } = fake();
    f.current = false;
    expect(pressReturn(page)).toBe(false);
    expect(f.keys).toEqual([]);
  });
});

describe('races found after the fill routine was built', () => {
  it('focus moving into the email field during the last account read types nothing', async () => {
    // The password step keeps an email input holding
    // the saved email, and Shift+Tab lands during the pre-typing read.
    const { f, page, state, fill } = fake();
    f.focus = { kind: 'password', empty: true };
    f.emails = [EMAIL];
    const send = page.send;
    let reads = 0;
    page.send = (method, params) => {
      if (method === 'DOM.querySelectorAll' && ++reads === 2) {
        f.focus = { kind: 'email', empty: false };
        pressed(state);
      }
      return send(method, params);
    };
    expect((await fill('password')).kind).not.toBe('typed');
    expect(f.typed).toEqual([]);
  });

  it('a key or press during a fill stops it, even with focus back by the end', async () => {
    const { f, state, fill } = fake();
    f.onDecrypt = () => pressed(state);
    expect((await fill('email')).kind).toBe('skipped');
    expect(f.typed).toEqual([]);
  });

  it('on a step with no email input, a press keeps the verdict', async () => {
    const { f, page, state, login, fill } = fake();
    f.emails = [EMAIL];
    await takeReading(page, state, login);
    f.emails = [];
    await takeReading(page, state, login); // the step has no email input now
    pressed(state); // the click into the password field
    f.focus = { kind: 'password', empty: true };
    expect(await fill('password')).toEqual({ kind: 'typed' });
  });

  it('another email seen before the password step isn’t "for good"', async () => {
    const { f, page, state, login, fill } = fake();
    f.emails = [OTHER]; // a stray edit
    await takeReading(page, state, login);
    pressed(state);
    f.emails = [EMAIL]; // fixed back
    await takeReading(page, state, login);
    f.focus = { kind: 'password', empty: true };
    expect(await fill('password')).toEqual({ kind: 'typed' });
  });

  it('the account line is logged once per change, not every tick', async () => {
    const { f, page, state, login, fill } = fake();
    f.focus = { kind: 'password', empty: true };
    for (let i = 0; i < 4; i++) {
      await takeReading(page, state, login);
      await fill('password');
    }
    expect(f.logs.filter(([e]) => e === 'account')).toHaveLength(1);
  });

  // A verdict worked out against the old
  // saved login outlived a save.

  // A real SavedSignIn on a temp file, with the login A saved.
  const withReal = async (fn: (saved: SavedSignIn) => Promise<void>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenshape-fill-'));
    try {
      const saved = new SavedSignIn(path.join(dir, 'saved-sign-in.json'), {
        isAsyncEncryptionAvailable: () => Promise.resolve(true),
        encryptStringAsync: (s) => Promise.resolve(Buffer.from(`enc:${s}`)),
        decryptStringAsync: (b) =>
          Promise.resolve({ result: b.toString().slice(4) }),
      });
      await saved.save(EMAIL, PASSWORD);
      await fn(saved);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('with the real SavedSignIn: saved again as B, the page names A: no password', async () => {
    await withReal(async (saved) => {
      const t = fake();
      t.f.emails = [EMAIL];
      await takeReading(t.page, t.state, saved); // A, read and kept
      await saved.save('b@example.test', 'pw-b');
      t.f.focus = { kind: 'password', empty: true };
      expect(
        (await fillField(t.page, t.state, saved, 'password', 'focus', () => {}))
          .kind,
      ).toBe('skipped');
      expect(t.f.typed).toEqual([]);
    });
  });

  it('with the real SavedSignIn: saved again as B, the page names B: the run’s password is typed', async () => {
    await withReal(async (saved) => {
      const t = fake();
      t.f.emails = [OTHER]; // the page once named someone else: "other"
      await takeReading(t.page, t.state, saved);
      t.f.focus = { kind: 'password', empty: true };
      await fillField(t.page, t.state, saved, 'password', 'focus', () => {});
      await saved.save('b@example.test', 'pw-b');
      t.f.emails = ['b@example.test'];
      expect(
        await fillField(t.page, t.state, saved, 'password', 'run', () => {}),
      ).toEqual({ kind: 'typed' });
      expect(t.f.typed).toEqual(['pw-b']);
    });
  });

  // A save landing during a fill's
  // account reading, with no email input on the page, left the old
  // verdict to decide.
  for (const change of ['save', 'forget'] as const)
    it(`the saved login ${change === 'save' ? 'saved again' : 'forgotten'} during a fill's reading: nothing typed`, async () => {
      await withReal(async (saved) => {
        const t = fake();
        t.f.emails = [EMAIL];
        await takeReading(t.page, t.state, saved); // same, for A
        t.f.emails = []; // a password step with no email input
        t.f.focus = { kind: 'password', empty: true };
        const send = t.page.send;
        let reads = 0;
        t.page.send = (method, params) => {
          if (method === 'DOM.querySelectorAll' && ++reads === 2) {
            if (change === 'forget') saved.forget();
            // The read answers once the save has landed.
            else
              return saved
                .save(EMAIL, 'pw-a-corrected')
                .then(() => send(method, params));
          }
          return send(method, params);
        };
        await fillField(t.page, t.state, saved, 'password', 'focus', () => {});
        expect(t.f.typed).toEqual([]);
      });
    });

  it('O-a: a failed reading leaves "may have email inputs", so a press still clears', async () => {
    const t = fake();
    t.f.emails = [EMAIL];
    await takeReading(t.page, t.state, t.login); // same
    t.f.emails = [];
    await takeReading(t.page, t.state, t.login); // no email input
    const send = t.page.send;
    t.page.send = () => Promise.reject(new Error('gone'));
    await takeReading(t.page, t.state, t.login); // fails
    t.page.send = send;
    pressed(t.state);
    expect(t.state.verdict).toBeNull();
  });
});

describe('the run’s email step with text already in the field', () => {
  it('the saved email already there: done, nothing typed', async () => {
    const { f, state, fill } = fake();
    f.focus = { kind: 'email', empty: false };
    f.emails = [EMAIL];
    expect(await fill('email', 'run')).toEqual({ kind: 'already' });
    expect(f.typed).toEqual([]);
    expect(state.filled.has('email')).toBe(true);
  });

  it('another email there: left alone, with a reason', async () => {
    const { f, fill } = fake();
    f.focus = { kind: 'email', empty: false };
    f.emails = [OTHER];
    expect((await fill('email', 'run')).kind).toBe('skipped');
    expect(f.typed).toEqual([]);
  });

  it('the autofill never counts text as done', async () => {
    const { f, fill } = fake();
    f.focus = { kind: 'email', empty: false };
    f.emails = [EMAIL];
    expect((await fill('email', 'focus')).kind).toBe('skipped');
  });

  it('a failed account reading: left alone, saying it couldn’t tell', async () => {
    const { f, page, fill } = fake();
    f.focus = { kind: 'email', empty: false };
    const send = page.send;
    page.send = (method, params) =>
      method === 'DOM.querySelectorAll'
        ? Promise.reject(new Error('gone'))
        : send(method, params);
    const result = await fill('email', 'run');
    expect(result).toMatchObject({ kind: 'skipped' });
    expect(result.kind === 'skipped' && result.reason).toMatch(/Couldn’t tell/);
    expect(f.typed).toEqual([]);
  });
});
