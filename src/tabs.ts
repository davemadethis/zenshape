export interface Tab {
  id: string;
  url: string;
  title: string;
  pinned: boolean;
  // Set by Rename; wins over the page title until cleared.
  name?: string;
  // Lock to This Page: the URL whose scope this tab stays within.
  lockedUrl?: string;
  // The temporary tab Onshape's sign-in page lives in; never pinned or saved.
  signIn: boolean;
}

export interface PersistedTab {
  url: string;
  title: string;
  pinned: boolean;
  name?: string;
  lockedUrl?: string;
}

export interface PersistedTabs {
  tabs: PersistedTab[];
  activeIndex: number;
}

// Order within the strip: the sign-in tab, then pins, then everything else.
const rank = (t: Pick<Tab, 'pinned' | 'signIn'>) =>
  t.signIn ? 0 : t.pinned ? 1 : 2;

// Pure tab-list state. Groups follow `rank`; within a group, user order.
// Electron views are kept in step by tab-views.ts.
export class TabList {
  private items: Tab[] = [];
  private active: string | null = null;

  constructor(private readonly newId: () => string) {}

  get tabs(): readonly Tab[] {
    return this.items;
  }

  get activeId(): string | null {
    return this.active;
  }

  get(id: string): Tab | undefined {
    return this.items.find((t) => t.id === id);
  }

  // `after` places the tab right after another (a link opened from it);
  // otherwise it goes at the end.
  open(
    init: {
      url: string;
      title?: string;
      pinned?: boolean;
      name?: string;
      lockedUrl?: string;
      signIn?: boolean;
    },
    opts: { after?: string; activate?: boolean } = {},
  ): Tab {
    const tab: Tab = {
      id: this.newId(),
      url: init.url,
      title: init.title ?? '',
      pinned: init.pinned ?? false,
      signIn: init.signIn ?? false,
    };
    if (init.name) tab.name = init.name;
    if (init.lockedUrl) tab.lockedUrl = init.lockedUrl;
    const afterIdx = opts.after
      ? this.items.findIndex((t) => t.id === opts.after)
      : -1;
    const idx = afterIdx >= 0 ? afterIdx + 1 : this.items.length;
    this.items.splice(this.clampToGroup(idx, rank(tab)), 0, tab);
    if (opts.activate ?? true) this.active = tab.id;
    return tab;
  }

  // Returns the tab that becomes active, or null when the list is now empty.
  close(id: string): string | null {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx < 0) return this.active;
    this.items.splice(idx, 1);
    if (this.active === id) {
      const next = this.items[Math.min(idx, this.items.length - 1)];
      this.active = next?.id ?? null;
    }
    return this.active;
  }

  select(id: string): boolean {
    if (!this.get(id)) return false;
    this.active = id;
    return true;
  }

  // ⌘1–8 pick by position, ⌘9 always means the last tab.
  selectNumber(n: number): string | null {
    const tab = n === 9 ? this.items.at(-1) : this.items[n - 1];
    if (tab) this.active = tab.id;
    return tab?.id ?? null;
  }

  cycle(step: 1 | -1): string | null {
    if (this.items.length === 0) return null;
    const idx = this.items.findIndex((t) => t.id === this.active);
    const next = (idx + step + this.items.length) % this.items.length;
    this.active = this.items[next].id;
    return this.active;
  }

  update(id: string, patch: Partial<Pick<Tab, 'url' | 'title'>>): void {
    const tab = this.get(id);
    if (tab) Object.assign(tab, patch);
  }

  // Pinning moves the tab to the end of the pinned group; unpinning moves it
  // to the start of the unpinned group, so it stays where the eye expects it.
  setPinned(id: string, pinned: boolean): void {
    const idx = this.items.findIndex((t) => t.id === id);
    const tab = this.items[idx];
    if (!tab || tab.signIn || tab.pinned === pinned) return;
    this.items.splice(idx, 1);
    tab.pinned = pinned;
    const to = pinned ? this.groupEnd(1) : this.groupStart(2);
    this.items.splice(to, 0, tab);
  }

  // An empty name goes back to the page's own title.
  rename(id: string, name: string): void {
    const tab = this.get(id);
    if (!tab || tab.signIn) return;
    const trimmed = name.trim();
    if (trimmed) tab.name = trimmed;
    else delete tab.name;
  }

  setLocked(id: string, lockedUrl: string | null): void {
    const tab = this.get(id);
    if (!tab || tab.signIn) return;
    if (lockedUrl) tab.lockedUrl = lockedUrl;
    else delete tab.lockedUrl;
  }

  // Drag-to-reorder: the tab lands just before `before` (or at the end), but
  // never leaves its group, so pins stay pins and the sign-in tab stays first.
  move(id: string, before: string | null): void {
    const from = this.items.findIndex((t) => t.id === id);
    if (from < 0 || id === before) return;
    const [tab] = this.items.splice(from, 1);
    const at = before ? this.items.findIndex((t) => t.id === before) : -1;
    const idx = at >= 0 ? at : this.items.length;
    this.items.splice(this.clampToGroup(idx, rank(tab)), 0, tab);
  }

  // A sign-in tab with nothing to return to becomes an ordinary tab, at the
  // front of the unpinned group.
  becomeRegular(id: string): void {
    const idx = this.items.findIndex((t) => t.id === id);
    const tab = this.items[idx];
    if (!tab?.signIn) return;
    this.items.splice(idx, 1);
    tab.signIn = false;
    this.items.splice(this.groupStart(2), 0, tab);
  }

  private groupStart(r: number): number {
    return this.items.filter((t) => rank(t) < r).length;
  }

  private groupEnd(r: number): number {
    return this.items.filter((t) => rank(t) <= r).length;
  }

  private clampToGroup(idx: number, r: number): number {
    return Math.min(Math.max(idx, this.groupStart(r)), this.groupEnd(r));
  }
}

// What to bring back on launch: pins only, unless the user opted into all tabs.
export function tabsToRestore(
  saved: PersistedTabs,
  restoreAll: boolean,
): PersistedTabs {
  if (restoreAll) return saved;
  const tabs = saved.tabs.filter((t) => t.pinned);
  const active = saved.tabs[saved.activeIndex];
  const activeIndex = active?.pinned ? tabs.indexOf(active) : 0;
  return { tabs, activeIndex };
}

export const displayName = (t: Pick<Tab, 'name' | 'title' | 'url'>): string =>
  t.name || t.title || t.url;
