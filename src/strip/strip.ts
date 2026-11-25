import {
  DISCLAIMER_LEGAL,
  DISCLAIMER_POINTS,
  DISCLAIMER_TITLE,
} from '../disclaimer';
import {
  SAVED_PASSWORD_MASK,
  canSignIn,
  passwordProblem,
  passwordToSend,
  shouldFocusSignIn,
  type StripState,
  type StripTab,
  type ZenshapeBridge,
} from '../strip-api';

declare global {
  interface Window {
    zenshape: ZenshapeBridge;
  }
}

const bridge = window.zenshape;
const tabsEl = document.getElementById('tabs')!;
const dropMarker = document.getElementById('drop-marker')!;
const backBtn = document.getElementById('back') as HTMLButtonElement;
const forwardBtn = document.getElementById('forward') as HTMLButtonElement;
const updateBtn = document.getElementById('update') as HTMLButtonElement;

// Tabs reorder within their group (pins, or the rest); the sign-in tab
// doesn't move. While a tab is held, state pushes wait: pressing a tab selects
// it, and re-rendering would replace the very node being dragged.
const group = (t: StripTab) =>
  t.signIn ? 'sign-in' : t.pinned ? 'pinned' : 'tabs';
const DRAG_THRESHOLD = 4;
// Dropping on the middle of a tab splits with it; nearer its edges reorders.
const ONTO_MARGIN = 0.25;
// A click on the split icon waits this long to see if it's a double-click.
const DOUBLE_CLICK_MS = 250;
let tabsById = new Map<string, StripTab>();
let holding = false;
let dragging = false;
let renaming = false;
// Hidden tab bar: whether it's hidden, and slid down by hovering the gutter.
let hidden = false;
let peeked = false;
let leaveTimer: number | undefined;
const LINGER_MS = 300;
let pending: StripState | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Inline name editor. Enter or clicking away saves, Esc cancels, and an empty
// name goes back to the page's own title.
function renameField(tab: StripTab): HTMLInputElement {
  const input = el('input', 'rename');
  input.value = tab.title;
  input.spellcheck = false;
  let done = false;
  const finish = (name: string | null) => {
    if (done) return;
    done = true;
    renaming = false;
    bridge.send({ type: 'rename', id: tab.id, name });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(input.value);
    else if (e.key === 'Escape') finish(null);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(input.value));
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  return input;
}

const LOCK_ICON =
  '<svg viewBox="0 0 10 12" width="9" height="11" aria-hidden="true"><rect x="1" y="5" width="8" height="6.5" rx="1.2" fill="currentColor"/><path d="M3 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

function renderTab(
  tab: StripTab,
  state: StripState,
  editing: boolean,
  half = false,
): HTMLElement {
  const node = el('div', half ? 'tab half' : 'tab');
  node.classList.toggle('active', tab.id === state.activeId);
  node.classList.toggle('pinned', tab.pinned);
  node.classList.toggle('loading', tab.loading);

  node.title = tab.locked ? `${tab.title} (locked to this page)` : tab.title;
  if (tab.locked) {
    const lock = el('span', 'lock');
    lock.innerHTML = LOCK_ICON;
    node.append(lock);
  }
  node.append(editing ? renameField(tab) : el('span', 'title', tab.title));
  // Pins have no close button; close them from the right-click menu.
  if (!tab.pinned && !editing) {
    const close = el('button', 'close', '×');
    close.title = 'Close Tab (⌘W)';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      bridge.send({ type: 'close', id: tab.id });
    });
    node.append(close);
  }

  node.dataset.id = tab.id;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('.close')) return;
    // Holding a tab keeps a peeked strip down (cancels any pending hide);
    // the hide is rescheduled when the drag ends outside the strip.
    if (peeked) bridge.send({ type: 'peek' });
    // Tabs select on release unless dragged, so dragging a tab onto the page
    // doesn't first hide the split it's being dropped on.
    if (tab.signIn) bridge.send({ type: 'select', id: tab.id });
    else startDrag(node, tab, e);
  });
  // Middle-click closes, as in browsers.
  node.addEventListener('auxclick', (e) => {
    if (e.button === 1) bridge.send({ type: 'close', id: tab.id });
  });
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bridge.send({ type: 'context-menu', id: tab.id });
  });
  return node;
}

// Click swaps the panes; double-click switches side by side ↔ stacked. The
// click waits out the double-click window so a double-click never swaps first.
function splitIcon(direction: 'row' | 'column'): HTMLElement {
  const icon = el('button', `split-icon ${direction}`);
  icon.title =
    direction === 'row'
      ? 'Click: swap left/right · Double-click: stack'
      : 'Click: swap top/bottom · Double-click: side by side';
  let timer: number | undefined;
  icon.addEventListener('pointerdown', (e) => e.stopPropagation());
  icon.addEventListener('click', () => {
    clearTimeout(timer);
    timer = window.setTimeout(
      () => bridge.send({ type: 'split-swap' }),
      DOUBLE_CLICK_MS,
    );
  });
  icon.addEventListener('dblclick', () => {
    clearTimeout(timer);
    bridge.send({ type: 'split-rotate' });
  });
  return icon;
}

// The two tabs sharing the screen render as one grouped tab.
function renderGroup(state: StripState): HTMLElement {
  const split = state.split!;
  const node = el('div', 'group');
  node.classList.toggle('shown', split.shown);
  node.append(splitIcon(split.direction));
  const [a, b] = [tabsById.get(split.a)!, tabsById.get(split.b)!];
  node.append(
    renderTab(a, state, a.id === state.renamingId, true),
    el('span', 'group-sep'),
    renderTab(b, state, b.id === state.renamingId, true),
  );
  return node;
}

type Target =
  | { kind: 'onto'; id: string; node: HTMLElement }
  | { kind: 'before'; before: string | null; markerX: number };

// Where the dragged tab would land in the strip: onto the middle of another
// tab (split with it), or before the first same-group tab whose midpoint is
// right of the pointer.
function dropTarget(tab: StripTab, x: number): Target {
  const nodes = [...tabsEl.querySelectorAll<HTMLElement>('.tab')];
  for (const n of nodes) {
    const t = tabsById.get(n.dataset.id!);
    if (!t || t.id === tab.id || t.signIn) continue;
    const r = n.getBoundingClientRect();
    const margin = r.width * ONTO_MARGIN;
    if (x > r.left + margin && x < r.right - margin) {
      return { kind: 'onto', id: t.id, node: n };
    }
  }
  const siblings = nodes.filter((n) => {
    const t = tabsById.get(n.dataset.id!);
    return t && t.id !== tab.id && group(t) === group(tab);
  });
  for (const n of siblings) {
    const r = n.getBoundingClientRect();
    if (x < r.left + r.width / 2)
      return { kind: 'before', before: n.dataset.id!, markerX: r.left - 1 };
  }
  const last = siblings.at(-1)?.getBoundingClientRect();
  return { kind: 'before', before: null, markerX: last ? last.right + 1 : x };
}

function startDrag(node: HTMLElement, tab: StripTab, down: PointerEvent): void {
  // Listen on the window, not via pointer capture: the main process re-lays
  // out views on state changes, which drops capture. The view that took the press
  // keeps getting the pointer while the button is held, even below the strip.
  holding = true;
  let target: Target | null = null;
  let overPage = false;
  let last = { x: down.clientX, y: down.clientY };
  let ontoNode: HTMLElement | null = null;
  const setOnto = (n: HTMLElement | null) => {
    ontoNode?.classList.remove('drop-onto');
    ontoNode = n;
    ontoNode?.classList.add('drop-onto');
  };

  const move = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY };
    const dx = e.clientX - down.clientX;
    const dy = e.clientY - down.clientY;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      node.classList.add('dragging');
    }
    // Below the strip: the main process previews where it would land.
    if (e.clientY > window.innerHeight) {
      overPage = true;
      setOnto(null);
      dropMarker.hidden = true;
      node.classList.add('over-page');
      bridge.send({
        type: 'drag-page',
        id: tab.id,
        x: e.clientX,
        y: e.clientY,
      });
      return;
    }
    if (overPage) {
      overPage = false;
      node.classList.remove('over-page');
      bridge.send({ type: 'drag-page-end' });
    }
    node.style.transform = `translateX(${dx}px)`;
    target = dropTarget(tab, e.clientX);
    if (target.kind === 'onto') {
      setOnto(target.node);
      dropMarker.hidden = true;
    } else {
      setOnto(null);
      dropMarker.style.left = `${target.markerX}px`;
      dropMarker.hidden = false;
    }
  };

  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', end);
    const wasDragging = dragging;
    holding = dragging = false;
    if (hidden && last.y > window.innerHeight) {
      leaveTimer = window.setTimeout(
        () => bridge.send({ type: 'unpeek' }),
        LINGER_MS,
      );
    }
    dropMarker.hidden = true;
    setOnto(null);
    node.classList.remove('dragging', 'over-page');
    node.style.transform = '';
    if (!wasDragging) {
      bridge.send({ type: 'select', id: tab.id });
    } else if (overPage) {
      bridge.send({ type: 'drop-page', id: tab.id, x: last.x, y: last.y });
    } else if (target?.kind === 'onto') {
      bridge.send({ type: 'split-onto', id: tab.id, target: target.id });
    } else if (target?.kind === 'before') {
      bridge.send({ type: 'move', id: tab.id, before: target.before });
    }
    if (pending) {
      const state = pending;
      pending = null;
      render(state);
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
}

// Chromium's Window Controls Overlay API; not in TypeScript's DOM types yet.
interface ControlsOverlay extends EventTarget {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

// Windows lets main read its controls' real height only through us: Electron
// tells each view the overlay's area (clipped to the view).
function reportControls(): void {
  const overlay = (
    navigator as Navigator & { windowControlsOverlay?: ControlsOverlay }
  ).windowControlsOverlay;
  if (!overlay) return;
  const report = () => {
    if (overlay.visible)
      bridge.send({
        type: 'controls-height',
        height: overlay.getTitlebarAreaRect().height,
      });
  };
  overlay.addEventListener('geometrychange', report);
  report();
}

function render(state: StripState): void {
  // Don't rebuild under a held tab or an open name editor.
  if (holding || renaming) {
    pending = state;
    return;
  }
  tabsById = new Map(state.tabs.map((t) => [t.id, t]));
  hidden = state.collapsed;
  peeked = state.peeked;
  document.documentElement.classList.toggle('collapsed', state.collapsed);
  document.documentElement.dataset.gutter = state.gutter;
  document.documentElement.style.setProperty(
    '--gutter-color',
    state.gutterColor,
  );
  document.documentElement.style.setProperty(
    '--gutter-h',
    `${state.gutterHeight}px`,
  );
  document.body.classList.toggle('collapsed', state.collapsed);
  document.body.classList.toggle('peeked', state.peeked);
  document.body.classList.toggle('fullscreen', state.fullscreen);
  document.body.classList.toggle(
    'overlay-controls',
    state.controls === 'overlay',
  );
  document.body.classList.toggle('zen', state.zen);
  backBtn.disabled = !state.canGoBack;
  forwardBtn.disabled = !state.canGoForward;
  updateBtn.hidden = !state.update;
  if (state.update) {
    updateBtn.textContent = 'Update available';
    updateBtn.title = `Zenshape ${state.update.version} — open the download page`;
  }
  const split = state.split;
  const items: HTMLElement[] = [];
  let groupDone = false;
  for (const t of state.tabs) {
    if (split && (t.id === split.a || t.id === split.b)) {
      // The group sits where the first of its two tabs is.
      if (!groupDone) items.push(renderGroup(state));
      groupDone = true;
      continue;
    }
    items.push(renderTab(t, state, t.id === state.renamingId));
  }
  tabsEl.replaceChildren(...items);
  tabsEl.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest' });
  const input = tabsEl.querySelector<HTMLInputElement>('input.rename');
  if (input) {
    renaming = true;
    input.focus();
    input.select();
  }
}

// The same page also renders the split divider (loaded with #divider). Once a
// drag starts, the main process stretches this view over the page area, so
// the pointer position maps straight to the split ratio.
function runDivider(): void {
  document.body.className = 'divider';
  let direction: 'row' | 'column' = 'row';
  let down = false;
  bridge.onState((state) => {
    direction = state.split?.direction ?? direction;
    document.body.classList.toggle('row', direction === 'row');
    document.body.classList.toggle('column', direction === 'column');
  });
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = true;
    document.body.classList.add('dragging');
    bridge.send({ type: 'divider-start' });
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const row = direction === 'row';
    const size = row ? window.innerWidth : window.innerHeight;
    // Still the thin divider; wait for the stretch.
    if (size < 50) return;
    bridge.send({
      type: 'divider-move',
      ratio: (row ? e.clientX : e.clientY) / size,
    });
  });
  const end = () => {
    if (!down) return;
    down = false;
    document.body.classList.remove('dragging');
    bridge.send({ type: 'divider-end' });
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
}

// Loaded with #overlay: a see-through layer over the pages showing where a
// dragged tab would land. It never takes input; the strip keeps the pointer.
function runOverlay(): void {
  document.body.className = 'overlay';
  const box = el('div', 'drop-preview');
  document.body.replaceChildren(box);
  bridge.onState((state) => {
    const p = state.dropPreview;
    box.hidden = !p;
    if (!p) return;
    Object.assign(box.style, {
      left: `${p.x}px`,
      top: `${p.y}px`,
      width: `${p.width}px`,
      height: `${p.height}px`,
    });
  });
}

// Loaded with #splash: the logo and disclaimer over the whole window, at
// launch and as About. Main decides when it shows; a click or Esc dismisses.
function runSplash(): void {
  document.body.className = 'splash';
  const card = el('div', 'splash-card');
  const logo = document.getElementById('zen')!.querySelector('svg')!;
  const mark = logo.cloneNode(true) as SVGElement;
  mark.setAttribute('width', '72');
  mark.setAttribute('height', '72');
  mark.classList.add('splash-logo');
  const version = el('div', 'splash-version');
  const points = el('ul', 'splash-points');
  points.append(...DISCLAIMER_POINTS.map((p) => el('li', undefined, p)));
  card.append(
    mark,
    el('h1', undefined, 'Zenshape'),
    version,
    el('h2', undefined, DISCLAIMER_TITLE),
    points,
    el('p', 'splash-legal', DISCLAIMER_LEGAL),
    el('p', 'splash-hint', 'Click anywhere to continue'),
  );
  const form = savedSignInForm();
  document.body.replaceChildren(card, form.root);
  let mode: StripState['splash'] = null;
  bridge.onState((state) => {
    // Keep the last mode while fading out, so the card doesn't swap mid-fade.
    if (state.splash) mode = state.splash;
    document.body.classList.toggle('shown', !!state.splash);
    card.hidden = mode === 'saved-sign-in';
    form.root.hidden = mode !== 'saved-sign-in';
    if (state.splash === 'saved-sign-in') form.show(state);
    else form.hide();
    version.textContent = `Version ${state.version}`;
  });
  const dismiss = () => bridge.send({ type: 'dismiss-splash' });
  window.addEventListener('pointerdown', () => {
    if (mode !== 'saved-sign-in') dismiss();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismiss();
    else if (e.key === 'Enter' && mode !== 'saved-sign-in') dismiss();
  });
}

// Inline icons (no icon font): 20px, stroked in the text color.
const STEP_ICONS = {
  save: '<rect x="3" y="3" width="14" height="14" rx="1.5"/><rect x="6" y="3" width="7" height="5"/><rect x="6" y="11" width="8" height="6"/>',
  email:
    '<rect x="2.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M3 6l7 5.5L17 6"/>',
  password:
    '<rect x="4" y="9" width="12" height="8.5" rx="1.5"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/>',
  done: '<circle cx="10" cy="10" r="7.5"/><path d="M6.5 10.2l2.4 2.4 4.6-5"/>',
} as const;

const STEPS: Array<{ id: keyof typeof STEP_ICONS; text: string }> = [
  { id: 'save', text: 'Saves the login if it’s new or changed' },
  {
    id: 'email',
    text: 'Opens Onshape’s page, types your email, presses Continue',
  },
  { id: 'password', text: 'Types your password, presses Return' },
  {
    id: 'done',
    text: 'You’re in. If Onshape asks for more, like a code, you finish it',
  },
];

// What one click on Sign in does. Each step is an <li data-step="…">,
// marked `done` or `stopped` as a run goes (`showSignInRun`).
function signInSteps(): HTMLElement {
  const box = el('div', 'sign-in-steps');
  const list = el('ol');
  for (const step of STEPS) {
    const item = el('li');
    item.dataset.step = step.id;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 20 20');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('step-icon');
    icon.innerHTML = STEP_ICONS[step.id];
    item.append(icon, el('span', undefined, step.text));
    list.append(item);
  }
  box.append(
    el('h3', undefined, 'One click on Sign in:'),
    list,
    el('p', 'sign-in-run-note'),
  );
  return box;
}

function showSignInRun(box: HTMLElement, run: StripState['signInRun']): void {
  for (const item of box.querySelectorAll<HTMLElement>('li[data-step]')) {
    const step = item.dataset.step as NonNullable<typeof run>['done'][number];
    item.classList.toggle('done', !!run?.done.includes(step));
    item.classList.toggle('stopped', run?.stopped?.step === step);
  }
  box.querySelector('.sign-in-run-note')!.textContent =
    run?.stopped?.reason ?? '';
}

// Zenshape's Saved Sign-in page: shown in place of Onshape's sign-in page,
// or from the menu. One button, Sign in (or Return): main saves the login if
// it's new or changed, then signs in with it. Esc shows Onshape's own page.
// The saved password never comes to this page: its field shows a
// placeholder, and left empty means "keep the saved one".
function savedSignInForm(): {
  root: HTMLFormElement;
  show: (state: StripState) => void;
  hide: () => void;
} {
  const root = el('form', 'splash-card sign-in-form');
  const email = el('input');
  email.type = 'email';
  email.autocomplete = 'off';
  email.placeholder = 'Onshape email';
  const password = el('input');
  password.type = 'password';
  password.autocomplete = 'off';
  const error = el('p', 'sign-in-error');
  const submit = el('button', 'primary', 'Sign in');
  submit.type = 'submit';
  const buttons = el('div', 'sign-in-buttons');
  buttons.append(submit);
  const fields = el('div', 'sign-in-fields');
  fields.append(
    el('h2', undefined, 'Sign in to Onshape'),
    el(
      'p',
      undefined,
      'Onshape asks again after some hours without use. Your login is saved encrypted on this computer. Esc shows Onshape’s own page.',
    ),
    email,
    password,
    error,
    buttons,
  );
  const steps = signInSteps();
  root.append(fields, steps);
  let wasShown = false;
  let hasSaved = false;
  let emailTouched = false;
  let running = false;
  // With a login saved, Sign in gets focus once it can be pressed (the
  // saved email arrives a moment after the page shows), so Return works.
  let focusSubmit = false;
  let serverError: string | null = null;
  // Nothing saved: Sign in waits for both fields.
  // A field in the form has focus: the user is there, and Sign in mustn't
  // take it from them, now or later.
  const fieldFocused = () =>
    document.activeElement === email || document.activeElement === password;
  const update = () => {
    submit.disabled =
      running || !canSignIn(email.value, password.value, hasSaved);
    error.textContent = passwordProblem(password.value) ?? serverError ?? '';
    if (fieldFocused()) focusSubmit = false;
    const active = document.activeElement;
    if (
      shouldFocusSignIn(
        focusSubmit,
        !submit.disabled,
        !!active && active !== document.body && root.contains(active),
      )
    ) {
      focusSubmit = false;
      submit.focus();
    }
  };
  // The user's own focus or typing in a field ends the pending focus.
  root.addEventListener('focusin', (e) => {
    if (e.target !== submit) focusSubmit = false;
  });
  email.addEventListener('input', () => {
    emailTouched = true;
    update();
  });
  // The first edit of the mask drops all of it, whatever the caret: what's
  // typed is the new password, and a Backspace leaves the field empty.
  password.addEventListener('beforeinput', () => {
    if (password.value === SAVED_PASSWORD_MASK) password.value = '';
  });
  password.addEventListener('input', update);
  password.addEventListener('focus', () => {
    if (password.value === SAVED_PASSWORD_MASK) password.select();
  });
  // Emptied with a login saved: the mask comes back, so what's shown is
  // what's sent (the saved password).
  password.addEventListener('blur', () => {
    if (hasSaved && password.value === '') password.value = SAVED_PASSWORD_MASK;
    update();
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    bridge.send({
      type: 'sign-in',
      email: email.value,
      password: passwordToSend(password.value),
    });
    // Cleared, but with a login saved it still means the saved one: show so.
    password.value = hasSaved ? SAVED_PASSWORD_MASK : '';
    update();
  });
  return {
    root,
    hide: () => {
      wasShown = false;
      focusSubmit = false;
      password.value = '';
    },
    show: (state) => {
      serverError = state.savedSignInError;
      error.textContent = passwordProblem(password.value) ?? serverError ?? '';
      showSignInRun(steps, state.signInRun);
      root.classList.toggle('running', !!state.signInRun);
      running = !!state.signInRun;
      const wasSaved = hasSaved;
      hasSaved = !!state.savedSignIn;
      // Forgotten while the page is open: the mask no longer stands for
      // anything.
      if (wasSaved && !hasSaved && password.value === SAVED_PASSWORD_MASK)
        password.value = '';
      password.placeholder = 'Password';
      // The saved email arrives after the page shows; fill it unless typed over.
      if (!emailTouched && state.savedSignIn?.email)
        email.value = state.savedSignIn.email;
      if (wasShown) return update();
      wasShown = true;
      emailTouched = false;
      email.value = state.savedSignIn?.email ?? '';
      // Saved: the mask, so it looks filled. Nothing saved: empty.
      password.value = hasSaved ? SAVED_PASSWORD_MASK : '';
      // Sign in takes focus once enabled, unless a field already has it (it
      // kept focus across a hide and reopen).
      if (hasSaved) focusSubmit = !fieldFocused();
      else email.focus();
      update();
    },
  };
}

if (location.hash === '#divider') {
  runDivider();
} else if (location.hash === '#splash') {
  runSplash();
} else if (location.hash === '#overlay') {
  runOverlay();
} else {
  document
    .getElementById('new-tab')!
    .addEventListener('click', () => bridge.send({ type: 'new-tab' }));
  document
    .getElementById('zen')!
    .addEventListener('click', () => bridge.send({ type: 'toggle-zen' }));
  updateBtn.addEventListener('click', () =>
    bridge.send({ type: 'open-update' }),
  );
  backBtn.addEventListener('click', () => bridge.send({ type: 'go-back' }));
  forwardBtn.addEventListener('click', () =>
    bridge.send({ type: 'go-forward' }),
  );
  bridge.onState(render);
  reportControls();

  // Hidden tab bar: hovering the gutter slides it down; leaving slides it
  // back up after a moment, but not while a tab is held or being renamed.
  const root = document.documentElement;
  root.addEventListener('pointermove', () => {
    clearTimeout(leaveTimer);
    if (hidden && !peeked) bridge.send({ type: 'peek' });
  });
  root.addEventListener('pointerleave', () => {
    if (!hidden || holding || renaming) return;
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(
      () => bridge.send({ type: 'unpeek' }),
      LINGER_MS,
    );
  });
  // Right-click on empty tab-bar space (or the Z): Hide Tab Bar, Zen Mode,
  // Hide Tab Bar in Zen Mode. Tabs have their own menu.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    bridge.send({ type: 'strip-menu' });
  });
}
