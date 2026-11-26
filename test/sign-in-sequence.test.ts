import { describe, expect, it } from 'vitest';
import type { FocusedField } from '../src/sign-in-focus';
import type { Field } from '../src/saved-sign-in';
import { signIn, type SignInPage, type Timing } from '../src/sign-in-sequence';

const EMAIL = 'fake-user@example.test';
const PASSWORD = 'fake-password-1';
const read = (f: Field) => Promise.resolve(f === 'email' ? EMAIL : PASSWORD);

// A fake clock: sleeping advances it, so timeouts take no real time.
function clock(): Timing {
  let now = 0;
  return {
    timeoutMs: 10_000,
    pollMs: 150,
    settleMs: 2_000,
    now: () => now,
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

// A scripted sign-in page: what has focus, and what happens on Return.
function fakePage(opts: {
  focus: FocusedField | null;
  onReturn?: (n: number, p: Fake) => void;
}) {
  const p: Fake = {
    focus: opts.focus,
    typed: [],
    returns: 0,
    steps: [],
    on: true,
    page: undefined as unknown as SignInPage,
  };
  // `fill` stands in for the fill routine (tested in sign-in-fill.test.ts):
  // it types only into an empty focused field of its kind.
  p.page = {
    onSignInPage: () => p.on,
    readField: () => Promise.resolve(p.focus),
    fill: async (field) => {
      if (!p.on) return { kind: 'left' };
      if (p.focus?.kind !== field || !p.focus.empty)
        return { kind: 'skipped', reason: 'not focused' };
      p.typed.push(await read(field));
      p.focus = { ...p.focus, empty: false };
      return { kind: 'typed' };
    },
    pressReturn: () => {
      if (!p.on) return Promise.resolve(false);
      p.returns++;
      opts.onReturn?.(p.returns, p);
      return Promise.resolve(true);
    },
    stepDone: (step) => p.steps.push(step),
  };
  return p;
}
interface Fake {
  focus: FocusedField | null;
  typed: string[];
  returns: number;
  steps: string[];
  on: boolean;
  page: SignInPage;
}

const emailField = { kind: 'email', empty: true } as const;
const passwordField = { kind: 'password', empty: true } as const;
// Onshape: Continue shows the focused password field; Return signs in.
const onshape = (n: number, p: Fake) => {
  if (n === 1) p.focus = passwordField;
  if (n === 2) p.on = false;
};

describe('the Sign in sequence', () => {
  it('email, Continue, password, Return, then signed in; each step marked as it happens', async () => {
    const p = fakePage({ focus: emailField, onReturn: onshape });
    const result = await signIn(p.page, clock());
    expect(result).toEqual({ kind: 'left', after: 'password' });
    expect(p.typed).toEqual([EMAIL, PASSWORD]);
    expect(p.returns).toBe(2);
    expect(p.steps).toEqual(['email', 'password']);
  });

  it('waits for Onshape to focus the password field after Continue', async () => {
    let polls = 0;
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        if (n === 2) p.on = false;
      },
    });
    const readField = p.page.readField;
    p.page.readField = () => {
      if (p.returns === 1 && ++polls === 4) p.focus = passwordField;
      return readField();
    };
    const result = await signIn(p.page, clock());
    expect(result.kind).toBe('left');
    expect(p.typed).toEqual([EMAIL, PASSWORD]);
  });

  it('stops when the page leaves the sign-in URL mid-way, typing no password', async () => {
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        if (n === 1) {
          p.on = false; // a redirect to an SSO provider
          p.focus = passwordField;
        }
      },
    });
    const result = await signIn(p.page, clock());
    expect(result).toEqual({ kind: 'left', after: 'email' });
    expect(p.typed).toEqual([EMAIL]);
    expect(p.returns).toBe(1);
  });

  it('stops at the email step when its field already has text', async () => {
    const p = fakePage({ focus: { kind: 'email', empty: false } });
    const result = await signIn(p.page, clock());
    expect(result).toMatchObject({ kind: 'needs-you', step: 'email' });
    expect(p.typed).toEqual([]);
    expect(p.returns).toBe(0);
  });

  it('stops at the password step when its field already has text', async () => {
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        if (n === 1) p.focus = { kind: 'password', empty: false };
      },
    });
    const result = await signIn(p.page, clock());
    expect(result).toMatchObject({ kind: 'needs-you', step: 'password' });
    expect(p.typed).toEqual([EMAIL]);
  });

  it('a timeout: no password typed when the password step doesn’t appear in time, and the email step not ticked', async () => {
    const p = fakePage({ focus: emailField });
    const result = await signIn(p.page, clock());
    expect(result).toMatchObject({ kind: 'needs-you', step: 'password' });
    expect(p.typed).toEqual([EMAIL]);
    expect(p.returns).toBe(1);
    expect(p.steps).toEqual([]);
  });

  it('Onshape asks for a code: handed over, every step of ours done', async () => {
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        if (n === 1) p.focus = passwordField;
        if (n === 2) p.focus = { kind: 'other', empty: true }; // the code field
      },
    });
    const result = await signIn(p.page, clock());
    expect(result).toEqual({ kind: 'handed-over' });
    expect(p.steps).toEqual(['email', 'password']);
    expect(p.typed).toEqual([EMAIL, PASSWORD]);
  });

  it('types nothing into another field', async () => {
    const p = fakePage({ focus: { kind: 'other', empty: true } });
    expect(await signIn(p.page, clock())).toMatchObject({
      kind: 'needs-you',
      step: 'email',
    });
    expect(p.typed).toEqual([]);
  });

  it('the password asked again after Return reads as the password step, not more', async () => {
    const t = clock();
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        p.focus = passwordField; // Continue, then a wrong password cleared
      },
    });
    const result = await signIn(p.page, t);
    expect(result).toEqual({
      kind: 'needs-you',
      step: 'password',
      reason:
        'Onshape asked for the password again. Check it, or change it in Zenshape → Saved Sign-in….',
    });
    expect(p.typed).toEqual([EMAIL, PASSWORD]);
    expect(t.now()).toBeGreaterThanOrEqual(t.settleMs);
  });

  // Seen on a fresh Windows install (bug-run-password-cleared): Onshape took
  // the password and went to its code step, emptying the field on the way.
  it('Onshape empties the password on its way to its code step: handed over, not the password', async () => {
    const t = clock();
    let secondReturnAt = -1;
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        if (n === 1) p.focus = passwordField;
        if (n === 2) {
          p.focus = passwordField;
          secondReturnAt = t.now();
        }
      },
    });
    const readField = p.page.readField;
    p.page.readField = () => {
      if (secondReturnAt >= 0 && t.now() - secondReturnAt >= 450)
        p.focus = { kind: 'other', empty: true }; // the code field
      return readField();
    };
    const result = await signIn(p.page, t);
    expect(result).toEqual({ kind: 'handed-over' });
    expect(p.steps).toEqual(['email', 'password']);
  });

  for (const [between, what] of [
    [null, 'no field'],
    [{ kind: 'password', empty: false }, 'the password field with text'],
  ] as const)
    it(`a brief empty password read doesn’t stick: the count restarts after ${what}, then the page leaves`, async () => {
      const t = clock();
      let secondReturnAt = -1;
      const p = fakePage({
        focus: emailField,
        onReturn: (n, p) => {
          if (n === 1) p.focus = passwordField;
          if (n === 2) secondReturnAt = t.now();
        },
      });
      const readField = p.page.readField;
      // Empty, then the read in between, then empty again for less than
      // settleMs (from 300 ms); counted from the first empty read it would
      // pass settleMs at 2100 ms.
      p.page.readField = () => {
        if (secondReturnAt >= 0) {
          const since = t.now() - secondReturnAt;
          if (since < 150) p.focus = passwordField;
          else if (since < 300) p.focus = between;
          else p.focus = passwordField;
          if (since >= 2_200) p.on = false;
        }
        return readField();
      };
      const result = await signIn(p.page, t);
      expect(result).toEqual({ kind: 'left', after: 'password' });
    });

  it('the email field empty after the password’s Return is a stop, never a hand-over', async () => {
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        p.focus = n === 1 ? passwordField : emailField; // back to the start
      },
    });
    const result = await signIn(p.page, clock());
    expect(result).toMatchObject({ kind: 'needs-you', step: 'done' });
    expect(p.steps).toEqual(['email', 'password']);
  });

  it('a settle that starts near the timeout runs its full settleMs: the password step, not the last', async () => {
    const t = clock();
    let secondReturnAt = -1;
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        if (n === 1) p.focus = passwordField;
        if (n === 2) secondReturnAt = t.now();
      },
    });
    const readField = p.page.readField;
    p.page.readField = () => {
      if (secondReturnAt >= 0 && t.now() - secondReturnAt >= 9_000)
        p.focus = passwordField; // emptied late, and it stays
      return readField();
    };
    const result = await signIn(p.page, t);
    expect(result).toMatchObject({ kind: 'needs-you', step: 'password' });
    expect(t.now() - secondReturnAt).toBeGreaterThanOrEqual(9_000 + t.settleMs);
  });

  it('another fill in flight (busy) is "not yet": it waits and fills', async () => {
    const p = fakePage({ focus: emailField, onReturn: onshape });
    const fill = p.page.fill;
    let first = true;
    p.page.fill = (field) => {
      if (first) {
        first = false;
        return Promise.resolve({ kind: 'busy' });
      }
      return fill(field);
    };
    const result = await signIn(p.page, clock());
    expect(result.kind).toBe('left');
    expect(p.typed).toEqual([EMAIL, PASSWORD]);
  });

  it('the routine refusing (another account) stops at that step with its reason, no key', async () => {
    const p = fakePage({
      focus: emailField,
      onReturn: (n, p) => {
        if (n === 1) p.focus = passwordField;
      },
    });
    const fill = p.page.fill;
    p.page.fill = (field) =>
      field === 'password'
        ? Promise.resolve({ kind: 'skipped', reason: 'Another account' })
        : fill(field);
    const result = await signIn(p.page, clock());
    expect(result).toEqual({
      kind: 'needs-you',
      step: 'password',
      reason: 'Another account',
    });
    expect(p.typed).toEqual([EMAIL]);
    expect(p.returns).toBe(1);
  });

  it('the saved email already in the field (the routine says already): Return pressed and the step ticked', async () => {
    const p = fakePage({
      focus: { kind: 'email', empty: false },
      onReturn: onshape,
    });
    const fill = p.page.fill;
    p.page.fill = (field) =>
      field === 'email' ? Promise.resolve({ kind: 'already' }) : fill(field);
    const result = await signIn(p.page, clock());
    expect(result).toEqual({ kind: 'left', after: 'password' });
    expect(p.typed).toEqual([PASSWORD]);
    expect(p.returns).toBe(2);
    expect(p.steps).toEqual(['email', 'password']);
  });
});
