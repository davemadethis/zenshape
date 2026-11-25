// Contract between the main process and the strip page (via preload).

export interface StripTab {
  id: string;
  title: string;
  pinned: boolean;
  signIn: boolean;
  locked: boolean;
  loading: boolean;
}

export interface StripState {
  tabs: StripTab[];
  activeId: string | null;
  // The tab whose name is being edited in place, if any.
  renamingId: string | null;
  // Whether the active tab has history to go back/forward to.
  canGoBack: boolean;
  canGoForward: boolean;
  // Overlay mode: where a tab dragged over the pages would land.
  dropPreview: { x: number; y: number; width: number; height: number } | null;
  // `shown` = the active tab is one of the pair, so both panes are on screen.
  split: {
    a: string;
    b: string;
    direction: 'row' | 'column';
    shown: boolean;
  } | null;
  // Tab bar hidden (gutter only), and whether hovering has slid it down.
  collapsed: boolean;
  peeked: boolean;
  // What's at the top of the page, so a hidden tab bar's gutter can take its
  // color: Onshape's own top bar (everywhere but a document in zen mode), a
  // drawing's white toolbar, or zen's gray.
  gutter: 'bar' | 'drawing' | 'zen';
  // The gutter's paint and height (12px on macOS; taller elsewhere, to hold
  // the window's controls).
  gutterColor: string;
  gutterHeight: number;
  zen: boolean;
  fullscreen: boolean;
  // macOS's traffic lights at the strip's left, or the window's own controls
  // overlaid at its right (Windows, Linux).
  controls: 'traffic-lights' | 'overlay';
  // Splash view: shown at launch (goes by itself) or as About (stays until
  // dismissed); null = fading out or hidden.
  // 'saved-sign-in' = the form for saving an Onshape login.
  splash: 'launch' | 'about' | 'saved-sign-in' | null;
  // Why the last save was refused, shown on that form.
  savedSignInError: string | null;
  // The saved login as the form shows it: the email (null until read), and
  // never the password. null = nothing saved.
  savedSignIn: { email: string | null } | null;
  // While Sign in runs: the steps done so far, and where it stopped and why.
  signInRun: {
    done: Array<'save' | 'email' | 'password' | 'done'>;
    stopped: {
      step: 'save' | 'email' | 'password' | 'done';
      reason: string;
    } | null;
  } | null;
  version: string;
  // A newer release this build can't install itself (macOS, Linux).
  update: { version: string; url: string } | null;
}

export type StripCommand =
  | { type: 'select'; id: string }
  | { type: 'close'; id: string }
  | { type: 'new-tab' }
  | { type: 'context-menu'; id: string }
  // Drop `id` just before `before` (null = end of its group).
  | { type: 'move'; id: string; before: string | null }
  // null = cancelled; '' = back to the page title.
  | { type: 'rename'; id: string; name: string | null }
  // From the divider view only. `ratio` = share of the area for the left/top pane.
  | { type: 'divider-start' }
  | { type: 'divider-move'; ratio: number }
  | { type: 'divider-end' }
  // While a strip tab is dragged below the strip (window coordinates).
  | { type: 'drag-page'; id: string; x: number; y: number }
  | { type: 'drag-page-end' }
  | { type: 'drop-page'; id: string; x: number; y: number }
  // Tab dropped onto another tab in the strip.
  | { type: 'split-onto'; id: string; target: string }
  | { type: 'split-swap' }
  | { type: 'split-rotate' }
  | { type: 'peek' }
  | { type: 'unpeek' }
  // Right-click on empty tab-bar space or the Z.
  | { type: 'strip-menu' }
  | { type: 'toggle-zen' }
  | { type: 'go-back' }
  | { type: 'go-forward' }
  | { type: 'open-update' }
  // The window controls overlay's height as this view sees it (Windows, Linux).
  | { type: 'controls-height'; height: number }
  // From the splash view only.
  | { type: 'dismiss-splash' }
  // From the splash view only, while it shows the Saved Sign-in page: save
  // if new or changed, then sign in. password null = the saved one, untouched.
  | { type: 'sign-in'; email: string; password: string | null };

export const STRIP_STATE_CHANNEL = 'zenshape:strip-state';
export const STRIP_COMMAND_CHANNEL = 'zenshape:strip-command';
export const STRIP_READY_CHANNEL = 'zenshape:strip-ready';

export interface ZenshapeBridge {
  onState(cb: (state: StripState) => void): void;
  send(cmd: StripCommand): void;
}

// The Saved Sign-in page's password field, with a login saved, holds this
// fixed mask: it looks filled, and means "the saved one". The real password
// never comes to the page. Typing over it is a new password.
const MASK_DOT = '\u2022';
export const SAVED_PASSWORD_MASK = MASK_DOT.repeat(8);

// Anything still holding a mask dot is the mask, or an edit of it, never a
// password: the page drops the whole mask on its first edit, and this is
// the backstop, so a partly edited mask can never be saved as the password.
const isMask = (value: string) => value.includes(MASK_DOT);

// What the page sends for its password field: null = keep the saved one
// (or, with nothing saved, no password, which main refuses).
export function passwordToSend(value: string): string | null {
  if (value === '' || isMask(value)) return null;
  return value;
}

// Sign in can be pressed only with an email, and a password typed or saved.
export function canSignIn(
  email: string,
  password: string,
  hasSaved: boolean,
): boolean {
  if (email.trim() === '') return false;
  // A password the page refuses (it has a •) is no password to sign in with,
  // and not "the saved one" either.
  if (passwordProblem(password)) return false;
  return hasSaved || passwordToSend(password) !== null;
}

// A password typed with a mask dot in it (Option-8 types one) can't be told
// from an edit of the mask, so it isn't sent: the page says why.
export function passwordProblem(value: string): string | null {
  return value !== SAVED_PASSWORD_MASK && isMask(value)
    ? 'Passwords containing • can’t be saved here.'
    : null;
}

// With a login saved, the page puts focus on Sign in once it's enabled, so
// Return works, but only while nothing in the form has focus: never out of
// a field the user is typing in.
export function shouldFocusSignIn(
  pending: boolean,
  enabled: boolean,
  formHasFocus: boolean,
): boolean {
  return pending && enabled && !formHasFocus;
}
