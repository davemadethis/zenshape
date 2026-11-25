// Which field on Onshape's sign-in page has focus, read through Chromium's
// DevTools protocol. DOM and Accessibility only: nothing runs in the page.

export type FieldKind = 'email' | 'password' | 'other';

export interface FocusedField {
  kind: FieldKind;
  empty: boolean;
}

export type Send = (method: string, params?: object) => Promise<unknown>;

// Every call this module may make. `Runtime` (running code in the page) is
// never among them.
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.querySelectorAll',
  'DOM.getAttributes',
  'Accessibility.getPartialAXTree',
]);

export function kindOf(attrs: Record<string, string>): FieldKind {
  const type = (attrs.type ?? 'text').toLowerCase();
  if (type === 'password') return 'password';
  if (type === 'email') return 'email';
  const hints = `${attrs.name ?? ''} ${attrs.id ?? ''} ${attrs.autocomplete ?? ''}`;
  if (type === 'text' && /email|user|login/i.test(hints)) return 'email';
  return 'other';
}

function pairs(flat: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2)
    out[flat[i].toLowerCase()] = flat[i + 1];
  return out;
}

// Every protocol call the sign-in code makes goes through this list.
export function guard(send: Send): Send {
  return (method, params) => {
    if (!ALLOWED_METHODS.has(method))
      return Promise.reject(new Error(`not allowed: ${method}`));
    return send(method, params);
  };
}

// null = no input has focus. The field's text is looked at only to tell
// whether it's empty; it's never kept or returned.
export async function readFocusedField(
  send: Send,
): Promise<FocusedField | null> {
  const guarded = guard(send);
  const { root } = (await guarded('DOM.getDocument', { depth: 0 })) as {
    root: { nodeId: number };
  };
  const { nodeId } = (await guarded('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input:focus',
  })) as { nodeId: number };
  if (!nodeId) return null;
  const { attributes } = (await guarded('DOM.getAttributes', { nodeId })) as {
    attributes: string[];
  };
  const { nodes } = (await guarded('Accessibility.getPartialAXTree', {
    nodeId,
    fetchRelatives: false,
  })) as { nodes: Array<{ value?: { value?: unknown } }> };
  const value = nodes[0]?.value?.value;
  return {
    kind: kindOf(pairs(attributes)),
    empty: value === undefined || value === null || value === '',
  };
}

// Every email/username input on the page, focused or not.
export const EMAIL_INPUT =
  'input[type=email], input[name=username], input[autocomplete=username], input[name=email]';

export type Verdict = 'same' | 'other';

// Whose account the page's email inputs name, read from their accessibility
// values: Chromium keeps those in step with what's typed, unlike the `value`
// attribute `DOM.getAttributes` returns. Compared here, inside, and only the
// verdict comes out: any input holding another email is 'other'; one holding
// the saved email and none another is 'same'; none with text is null.
export interface Account {
  verdict: Verdict | null;
  // Whether the page has any email/username input at all, empty or not.
  inputs: boolean;
}

export async function readAccount(
  send: Send,
  savedEmail: string,
): Promise<Account> {
  const guarded = guard(send);
  const { root } = (await guarded('DOM.getDocument', { depth: 0 })) as {
    root: { nodeId: number };
  };
  const { nodeIds } = (await guarded('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: EMAIL_INPUT,
  })) as { nodeIds: number[] };
  const saved = savedEmail.trim().toLowerCase();
  let same = false;
  for (const nodeId of nodeIds ?? []) {
    const { nodes } = (await guarded('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    })) as { nodes: Array<{ value?: { value?: unknown } }> };
    const value = nodes[0]?.value?.value;
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!text) continue;
    if (text !== saved) return { verdict: 'other', inputs: true };
    same = true;
  }
  return { verdict: same ? 'same' : null, inputs: (nodeIds ?? []).length > 0 };
}
