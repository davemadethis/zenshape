import { describe, expect, it } from 'vitest';
import {
  ALLOWED_METHODS,
  kindOf,
  readFocusedField,
  type Send,
} from '../src/sign-in-focus';

// A fake page: one focused input (or none) with these attributes and AX value.
function page(
  input: { attrs: string[]; value?: string } | null,
  calls: string[] = [],
): Send {
  return (method) => {
    calls.push(method);
    switch (method) {
      case 'DOM.getDocument':
        return Promise.resolve({ root: { nodeId: 1 } });
      case 'DOM.querySelector':
        return Promise.resolve({ nodeId: input ? 7 : 0 });
      case 'DOM.getAttributes':
        return Promise.resolve({ attributes: input!.attrs });
      case 'Accessibility.getPartialAXTree':
        return Promise.resolve({
          nodes: [
            input!.value === undefined
              ? {}
              : { value: { value: input!.value } },
          ],
        });
      default:
        return Promise.reject(new Error(method));
    }
  };
}

// Onshape's own email field, as read from its live sign-in page (2026-11-18).
const ONSHAPE_EMAIL = [
  'type',
  'text',
  'name',
  'username',
  'autocomplete',
  'username',
];

describe('which field has focus', () => {
  it('tells Onshape’s email field from a password field', async () => {
    expect(
      await readFocusedField(page({ attrs: ONSHAPE_EMAIL, value: '' })),
    ).toEqual({ kind: 'email', empty: true });
    expect(
      await readFocusedField(page({ attrs: ['type', 'password'] })),
    ).toEqual({ kind: 'password', empty: true });
  });

  it('says when the field already has text', async () => {
    expect(
      await readFocusedField(page({ attrs: ONSHAPE_EMAIL, value: 'x' })),
    ).toEqual({ kind: 'email', empty: false });
  });

  it('null when no input has focus', async () => {
    expect(await readFocusedField(page(null))).toBeNull();
  });

  it('other fields are other', () => {
    expect(kindOf({ type: 'text', name: 'company' })).toBe('other');
    expect(kindOf({ type: 'checkbox', name: 'username' })).toBe('other');
    expect(kindOf({ type: 'email' })).toBe('email');
  });

  it('never uses Runtime, or anything outside its list', async () => {
    const calls: string[] = [];
    await readFocusedField(page({ attrs: ONSHAPE_EMAIL, value: '' }, calls));
    for (const m of calls) expect(ALLOWED_METHODS.has(m)).toBe(true);
    for (const m of ALLOWED_METHODS)
      expect(m.startsWith('Runtime')).toBe(false);
  });
});
