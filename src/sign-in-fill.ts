import type { Field } from './saved-sign-in';
import {
  readAccount,
  readFocusedField,
  type Account,
  type FocusedField,
  type Send,
  type Verdict,
} from './sign-in-focus';
import type { LogValue } from './sign-in-log';

// The one door to Onshape's sign-in page: the only code that types into it
// (`fillField`) or presses a key on it (`pressReturn`). Every way a saved
// login reaches the page comes through here, so every guard is in one place.

// 'focus': the saved-login autofill, as a field takes focus (automatic).
// 'run': the Sign in button's run on Zenshape's page (the user asked).
export type Trigger = 'focus' | 'run';

// What the routine types into and presses keys on: the page's contents.
export interface Keyboard {
  focus(): void;
  isFocused(): boolean;
  insertText(text: string): Promise<void>;
  sendInputEvent(event: {
    type: 'keyDown' | 'char' | 'keyUp';
    keyCode: string;
  }): void;
}

// The sign-in page as the routine sees it, given by tab-views.
export interface FillPage {
  // Still the watched page, the sign-in tab active, the contents alive, the
  // URL Onshape's sign-in page.
  isCurrent(): boolean;
  send: Send;
  keyboard: Keyboard;
}

export interface Login {
  exists: boolean;
  // Bumped when the saved login is saved again or forgotten.
  version: number;
  read(field: Field): Promise<string | null>;
}

// Per sign-in page: what's been filled, the one-at-a-time lock, and whose
// account the page names (only a verdict, never the page's email).
export class FillState {
  readonly filled = new Set<Field>();
  busy = false;
  verdict: Verdict | null = null;
  // Every key or press on the page. A fill typing after one has landed
  // since it began doesn't type: focus may have moved (Shift+Tab, a click).
  presses = 0;
  // The presses that cleared the verdict: a reading begun before one of
  // them doesn't count.
  clears = 0;
  // As of the last reading, whether the page had any email input. A press
  // with none can't have changed the email, so it keeps the verdict.
  emailInputs = true;
  // The password step showed another account's email: its password is the
  // user's on this page.
  otherAccount = false;
  lastAccountLog = '';
  // The saved login this state was worked out for (`Login.version`).
  loginVersion: number | null = null;
}

export type FillResult =
  | { kind: 'typed' }
  // The run's email step: the field already holds the saved email (typed
  // there before, by the autofill or by hand), so there's nothing to type.
  | { kind: 'already' }
  | { kind: 'busy' }
  | { kind: 'left' }
  | { kind: 'skipped'; reason: string };

export type Log = (event: string, details: Record<string, LogValue>) => void;

// A focus read that hasn't answered by now counts as no field.
const READ_TIMEOUT_MS = 2_000;

function within<T>(p: Promise<T>): Promise<T | undefined> {
  return Promise.race([
    p,
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), READ_TIMEOUT_MS),
    ),
  ]);
}

export async function readField(send: Send): Promise<FocusedField | null> {
  try {
    return (await within(readFocusedField(send))) ?? null;
  } catch {
    return null;
  }
}

// The saved login changed (saved again, or forgotten) since this page's
// verdict was worked out: it was about the old one, so it goes.
function syncLogin(state: FillState, login: Login): void {
  if (state.loginVersion === login.version) return;
  state.loginVersion = login.version;
  state.verdict = null;
  state.otherAccount = false;
  state.lastAccountLog = '';
}

async function accountNow(
  page: FillPage,
  state: FillState,
  login: Login,
): Promise<Account | null> {
  syncLogin(state, login);
  const version = login.version;
  // Decrypted once per saved login, inside SavedSignIn.
  const savedEmail = await login.read('email');
  if (!savedEmail) return null;
  try {
    const account = (await within(readAccount(page.send, savedEmail))) ?? null;
    // Saved again or forgotten during the read: it compared against the old
    // login, and the page's verdict was about it too. Drop both.
    if (login.version === version) return account;
    syncLogin(state, login);
    return null;
  } catch {
    return null;
  }
}

// A reading of whose account the page names, kept as the verdict when
// there's one. Taken by the tick and at each key or press: it starts as
// Return or Continue is pressed. Its protocol calls are answered after the
// page has the key, but Onshape keeps the email input on its password step
// (seen, source=live), so it still reads the email continued with.
export async function takeReading(
  page: FillPage,
  state: FillState,
  login: Login,
): Promise<void> {
  if (!login.exists || !page.isCurrent()) return;
  const clears = state.clears;
  const now = await accountNow(page, state, login);
  if (!page.isCurrent() || state.clears !== clears) return;
  // A reading that failed can't say the page has no email input: assume it
  // may, so a press still clears the verdict.
  state.emailInputs = now?.inputs ?? true;
  if (!now) return;
  if (now.verdict) state.verdict = now.verdict;
}

// A key or a press reached the page. With an email input on the page it may
// have changed the email, or continued with it: the last verdict stops
// counting. With none (a password step without one), it can't have, and
// the verdict stands.
export function pressed(state: FillState): void {
  state.presses++;
  if (!state.emailInputs) return;
  state.clears++;
  state.verdict = null;
}

// The password only for the saved account. A live reading decides when the
// page still has an email input with text; otherwise the last verdict.
async function accountAllows(
  page: FillPage,
  state: FillState,
  login: Login,
  log: Log,
): Promise<string | null> {
  const live = (await accountNow(page, state, login))?.verdict ?? null;
  // At the password step, another account's email decides it for good.
  if (live === 'other') state.otherAccount = true;
  const verdict = live ?? state.verdict;
  const line = `${live ? 'live' : 'at-continue'} ${state.otherAccount ? 'other' : (verdict ?? 'none')}`;
  // Once per change: the autofill asks again every tick.
  if (line !== state.lastAccountLog) {
    state.lastAccountLog = line;
    const [source, said] = line.split(' ');
    log('account', { source, verdict: said });
  }
  if (state.otherAccount)
    return 'Another account’s email is on Onshape’s page: its password is yours to type.';
  if (verdict !== 'same')
    return 'Couldn’t tell which account Onshape’s page is for, so the password was left to you.';
  return null;
}

const matches = (f: FocusedField | null, field: Field) =>
  !!f && f.kind === field && f.empty;

// Types the saved `field` into Onshape's sign-in page, if every guard holds.
export async function fillField(
  page: FillPage,
  state: FillState,
  login: Login,
  field: Field,
  trigger: Trigger,
  log: Log,
): Promise<FillResult> {
  if (state.busy) return { kind: 'busy' };
  state.busy = true;
  const presses = state.presses;
  syncLogin(state, login);
  // The saved login this fill decrypts and checks against.
  const version = login.version;
  try {
    if (!page.isCurrent()) return { kind: 'left' };
    if (!login.exists) return { kind: 'skipped', reason: 'No saved sign-in.' };
    const automatic = trigger === 'focus';
    if (automatic && state.filled.has(field))
      return { kind: 'skipped', reason: 'Already filled on this page.' };
    // Only an explicit trigger moves focus; the page keeps its focused field.
    if (!automatic && !page.keyboard.isFocused()) page.keyboard.focus();
    const focused = await readField(page.send);
    if (
      trigger === 'run' &&
      field === 'email' &&
      focused?.kind === 'email' &&
      !focused.empty
    ) {
      // Text there already: done, if it's the saved email; otherwise the
      // user's, and left alone.
      const now = await accountNow(page, state, login);
      if (!page.isCurrent()) return { kind: 'left' };
      if (now?.verdict === 'same') {
        state.filled.add('email');
        log('fill', { field, trigger, already: true });
        return { kind: 'already' };
      }
      return {
        kind: 'skipped',
        reason: now?.verdict
          ? 'Onshape’s email field already has another email in it.'
          : 'Couldn’t tell whose email is in Onshape’s email field, so it was left alone.',
      };
    }
    if (!matches(focused, field))
      return {
        kind: 'skipped',
        reason: `Onshape’s ${field} field isn’t focused and empty.`,
      };
    if (!page.isCurrent()) return { kind: 'left' };
    if (field === 'password') {
      const no = await accountAllows(page, state, login, log);
      if (no) return { kind: 'skipped', reason: no };
      if (!page.isCurrent()) return { kind: 'left' };
    }
    const text = await login.read(field);
    if (!text)
      return { kind: 'skipped', reason: 'Couldn’t read the saved sign-in.' };
    // Typing goes wherever focus is, and the decrypt was an await: check the
    // account, then the field, then the page, with focus the last thing read
    // before typing, and no key or press since this fill began.
    if (field === 'password') {
      const no = await accountAllows(page, state, login, log);
      if (no) return { kind: 'skipped', reason: no };
    }
    if (!matches(await readField(page.send), field))
      return {
        kind: 'skipped',
        reason: `Focus moved off Onshape’s ${field} field before typing.`,
      };
    if (!page.isCurrent()) return { kind: 'left' };
    // Saved again or forgotten during the fill: what was decrypted and
    // checked is the old login's.
    if (login.version !== version)
      return {
        kind: 'skipped',
        reason: 'The saved sign-in changed during the fill.',
      };
    // The run's own Return counts as a press too, but it comes after its
    // fill, never during one.
    if (state.presses !== presses)
      return {
        kind: 'skipped',
        reason: 'A key or click reached the page during the fill.',
      };
    log('fill', { field, trigger });
    await page.keyboard.insertText(text);
    state.filled.add(field);
    return { kind: 'typed' };
  } catch {
    return { kind: 'left' };
  } finally {
    state.busy = false;
  }
}

// Return as a keyboard sends it: Onshape's Continue listens for the
// keypress, and its password field submits on it. No script in the page.
// Only the run calls it, right after fillField typed, still on the page.
// Electron fires `before-input-event` for the keyDown synchronously, so the
// page's key handler (`pressed`, then `takeReading`) starts the reading the
// run's password relies on as this Return goes out.
export function pressReturn(page: FillPage): boolean {
  if (!page.isCurrent()) return false;
  page.keyboard.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  page.keyboard.sendInputEvent({ type: 'char', keyCode: '\r' });
  page.keyboard.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  return true;
}
