import type { FocusedField } from './sign-in-focus';
import type { Field } from './saved-sign-in';
import type { FillResult } from './sign-in-fill';

// The steps one click on Sign in takes, as the Saved Sign-in page lists them.
export type SignInStep = 'save' | 'email' | 'password' | 'done';

// Onshape's sign-in page, as the Sign in button drives it. Typing and keys
// go through the one fill routine (`sign-in-fill.ts`): `fill` is its
// `fillField` with the 'run' trigger, `pressReturn` its `pressReturn`.
export interface SignInPage {
  // Still the sign-in tab, still on Onshape's sign-in page. Checked before
  // every step, so a redirect anywhere stops the sequence.
  onSignInPage(): boolean;
  readField(): Promise<FocusedField | null>;
  fill(field: Field): Promise<FillResult>;
  // false: the page left before the key.
  pressReturn(): Promise<boolean>;
  // A step is done: the page ticks it off.
  stepDone(step: 'email' | 'password'): void;
}

export type SignInResult =
  // The page left Onshape's sign-in URL after the password's Return: signed
  // in, if it landed on Onshape (the caller checks).
  | { kind: 'left'; after: SignInStep }
  // Stopped at `step`; Onshape's page should come forward, the rest yours.
  | { kind: 'needs-you'; step: SignInStep; reason: string };

export interface Timing {
  timeoutMs: number;
  pollMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const TIMING: Timing = {
  timeoutMs: 10_000,
  pollMs: 150,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const describe = (f: FocusedField | null) =>
  f ? `${f.kind} field, ${f.empty ? 'empty' : 'with text'}` : 'no field';

type Wait = {
  field: FocusedField | null;
  outcome: 'ok' | 'stop' | 'left' | 'timeout';
};

// Polls the focused field until `want` says yes or stop, the page leaves,
// or the time runs out.
async function waitFor(
  page: SignInPage,
  t: Timing,
  want: (f: FocusedField | null) => boolean | 'stop',
): Promise<Wait> {
  const start = t.now();
  let field: FocusedField | null = null;
  for (;;) {
    if (!page.onSignInPage()) return { field, outcome: 'left' };
    try {
      field = await page.readField();
    } catch {
      field = null;
    }
    if (!page.onSignInPage()) return { field, outcome: 'left' };
    const verdict = want(field);
    if (verdict === 'stop') return { field, outcome: 'stop' };
    if (verdict) return { field, outcome: 'ok' };
    if (t.now() - start >= t.timeoutMs) return { field, outcome: 'timeout' };
    await t.sleep(t.pollMs);
  }
}

const needs = (
  step: SignInStep,
  reason: string,
): Extract<SignInResult, { kind: 'needs-you' }> => ({
  kind: 'needs-you',
  step,
  reason,
});

// Fills `field` through the routine, waiting out `busy` (another fill on
// the page) as "not yet", until the timeout.
async function fillStep(
  page: SignInPage,
  t: Timing,
  field: Field,
): Promise<FillResult> {
  const start = t.now();
  for (;;) {
    const result = await page.fill(field);
    if (result.kind !== 'busy' || t.now() - start >= t.timeoutMs)
      return result.kind === 'busy'
        ? { kind: 'skipped', reason: 'Another fill was in the way.' }
        : result;
    await t.sleep(t.pollMs);
  }
}

// Email, Return (Onshape's Continue), password, Return, then wait to leave
// the sign-in page. The routine types each only into an empty field of its
// own kind, only while on the sign-in page, the password only for the saved
// account.
export async function signIn(
  page: SignInPage,
  t: Timing = TIMING,
): Promise<SignInResult> {
  // An email field with text is the routine's to judge: the saved email
  // already there counts as this step done.
  const email = await waitFor(page, t, (f) => f?.kind === 'email');
  if (email.outcome === 'left') return { kind: 'left', after: 'save' };
  if (email.outcome === 'timeout')
    return needs(
      'email',
      `Onshape’s email field didn’t take focus (saw: ${describe(email.field)}).`,
    );
  const emailFill = await fillStep(page, t, 'email');
  if (emailFill.kind === 'left') return { kind: 'left', after: 'save' };
  if (emailFill.kind !== 'typed' && emailFill.kind !== 'already')
    return needs(
      'email',
      emailFill.kind === 'skipped' ? emailFill.reason : 'Not typed.',
    );
  if (!(await page.pressReturn())) return { kind: 'left', after: 'save' };
  page.stepDone('email');

  const password = await waitFor(page, t, (f) =>
    f?.kind === 'password' ? (f.empty ? true : 'stop') : false,
  );
  if (password.outcome === 'left') return { kind: 'left', after: 'email' };
  if (password.outcome === 'stop')
    return needs('password', 'Onshape’s password field already has text.');
  if (password.outcome === 'timeout')
    return needs(
      'password',
      `Onshape didn’t show its password field in time (saw: ${describe(password.field)}). Type it and press Return.`,
    );
  const passwordFill = await fillStep(page, t, 'password');
  if (passwordFill.kind === 'left') return { kind: 'left', after: 'email' };
  if (passwordFill.kind !== 'typed')
    return needs(
      'password',
      passwordFill.kind === 'skipped' ? passwordFill.reason : 'Not typed.',
    );
  if (!(await page.pressReturn())) return { kind: 'left', after: 'email' };
  page.stepDone('password');
  // Signed in means leaving the sign-in page. Still here with an empty field
  // focused, or still here at the timeout, is the user's: the password asked
  // again at the password step, anything else (a code) at the last step.
  const after = await waitFor(page, t, (f) => !!f?.empty);
  if (after.outcome === 'left') return { kind: 'left', after: 'password' };
  if (after.outcome === 'timeout')
    return needs('done', 'Onshape didn’t finish signing in. Check its page.');
  // The password asked again is most likely a wrong one, not "more".
  if (after.field?.kind === 'password')
    return needs(
      'password',
      'Onshape asked for the password again. Check it, or change it in Zenshape → Saved Sign-in….',
    );
  return needs('done', 'Onshape asks for more. Finish it on its page.');
}
