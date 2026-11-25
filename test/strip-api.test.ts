import { describe, expect, it } from 'vitest';
import {
  SAVED_PASSWORD_MASK,
  canSignIn,
  passwordProblem,
  passwordToSend,
  shouldFocusSignIn,
} from '../src/strip-api';

describe('the Saved Sign-in page’s fields', () => {
  it('the mask, or an emptied field, sends null: keep the saved password', () => {
    expect(passwordToSend(SAVED_PASSWORD_MASK)).toBeNull();
    expect(passwordToSend('')).toBeNull();
    expect(passwordToSend('new-password')).toBe('new-password');
  });

  it('a partly edited mask is never sent as a password', () => {
    // One dot removed (click, click, Backspace).
    expect(passwordToSend(SAVED_PASSWORD_MASK.slice(1))).toBeNull();
    // Text typed after the dots, and before them.
    expect(passwordToSend(`${SAVED_PASSWORD_MASK.slice(1)}x`)).toBeNull();
    expect(passwordToSend(`x${SAVED_PASSWORD_MASK}`)).toBeNull();
  });

  it('the mask is no password: it says nothing about the saved one', () => {
    expect(SAVED_PASSWORD_MASK).toMatch(/^•+$/);
  });

  it('nothing saved: Sign in waits for both fields', () => {
    expect(canSignIn('', '', false)).toBe(false);
    expect(canSignIn('me@example.test', '', false)).toBe(false);
    expect(canSignIn('', 'pw', false)).toBe(false);
    expect(canSignIn('  ', 'pw', false)).toBe(false);
    expect(canSignIn('me@example.test', 'pw', false)).toBe(true);
  });

  it('forgotten with the page open: the mask left in the field doesn’t count', () => {
    expect(canSignIn('me@example.test', SAVED_PASSWORD_MASK, false)).toBe(
      false,
    );
    expect(passwordToSend(SAVED_PASSWORD_MASK)).toBeNull();
  });

  it('saved: an email is enough, the password being the saved one', () => {
    expect(canSignIn('me@example.test', SAVED_PASSWORD_MASK, true)).toBe(true);
    expect(canSignIn('', SAVED_PASSWORD_MASK, true)).toBe(false);
  });
});

describe('focus on Sign in, with a login saved', () => {
  it('moves only while nothing in the form has focus', () => {
    expect(shouldFocusSignIn(true, true, false)).toBe(true);
    // The user is typing in a field: never taken out of it.
    expect(shouldFocusSignIn(true, true, true)).toBe(false);
    expect(shouldFocusSignIn(true, false, false)).toBe(false);
    expect(shouldFocusSignIn(false, true, false)).toBe(false);
  });
});

describe('a password with a mask dot in it', () => {
  it('is refused with a reason, not silently dropped', () => {
    expect(passwordProblem('pass•word')).toMatch(/•/);
    expect(passwordToSend('pass•word')).toBeNull();
  });

  it('the mask itself, an empty field or a normal password: no problem', () => {
    expect(passwordProblem(SAVED_PASSWORD_MASK)).toBeNull();
    expect(passwordProblem('')).toBeNull();
    expect(passwordProblem('fine-password')).toBeNull();
  });
});

describe('Sign in with a refused password', () => {
  it('can’t be pressed, saved login or not', () => {
    expect(canSignIn('me@example.test', 'pass•word', true)).toBe(false);
    expect(canSignIn('me@example.test', 'pass•word', false)).toBe(false);
    // The mask itself is the saved password, not a refused one.
    expect(canSignIn('me@example.test', SAVED_PASSWORD_MASK, true)).toBe(true);
  });
});
