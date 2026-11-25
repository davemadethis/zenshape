import { describe, expect, it } from 'vitest';
import { TabList, displayName, tabsToRestore } from '../src/tabs';

function list() {
  let n = 0;
  return new TabList(() => `t${++n}`);
}

const order = (l: TabList) => l.tabs.map((t) => t.id);

describe('TabList', () => {
  it('opens at the end, or right after the opener, and activates', () => {
    const l = list();
    l.open({ url: 'a' });
    l.open({ url: 'b' });
    l.open({ url: 'c' }, { after: 't1' });
    expect(order(l)).toEqual(['t1', 't3', 't2']);
    expect(l.activeId).toBe('t3');
    l.open({ url: 'd' }, { activate: false });
    expect(l.activeId).toBe('t3');
  });

  it('closing the active tab activates its right neighbour, else the left', () => {
    const l = list();
    ['a', 'b', 'c'].forEach((url) => l.open({ url }));
    l.select('t2');
    expect(l.close('t2')).toBe('t3');
    expect(l.close('t3')).toBe('t1');
    expect(l.close('t1')).toBeNull();
  });

  it('closing an inactive tab keeps the active one', () => {
    const l = list();
    ['a', 'b'].forEach((url) => l.open({ url }));
    expect(l.close('t1')).toBe('t2');
  });

  it('⌘1–8 pick by position and ⌘9 is always the last tab', () => {
    const l = list();
    ['a', 'b', 'c'].forEach((url) => l.open({ url }));
    expect(l.selectNumber(1)).toBe('t1');
    expect(l.selectNumber(9)).toBe('t3');
    expect(l.selectNumber(5)).toBeNull();
    expect(l.activeId).toBe('t3');
  });

  it('cycles in both directions with wraparound', () => {
    const l = list();
    ['a', 'b', 'c'].forEach((url) => l.open({ url }));
    expect(l.cycle(1)).toBe('t1');
    expect(l.cycle(-1)).toBe('t3');
  });

  it('keeps pinned tabs first: pin goes to end of pins, unpin to start of the rest', () => {
    const l = list();
    ['a', 'b', 'c', 'd'].forEach((url) => l.open({ url }));
    l.setPinned('t3', true);
    l.setPinned('t1', true);
    expect(order(l)).toEqual(['t3', 't1', 't2', 't4']);
    l.setPinned('t3', false);
    expect(order(l)).toEqual(['t1', 't3', 't2', 't4']);
  });

  it('never lets a new tab land inside the pinned group', () => {
    const l = list();
    l.open({ url: 'a', pinned: true });
    l.open({ url: 'b', pinned: true });
    l.open({ url: 'c' }, { after: 't1' });
    expect(order(l)).toEqual(['t1', 't2', 't3']);
  });
});

describe('move (drag to reorder)', () => {
  it('drops a tab before another in its group, or at the group end', () => {
    const l = list();
    ['a', 'b', 'c', 'd'].forEach((url, i) => l.open({ url, pinned: i < 3 }));
    l.move('t3', 't1');
    expect(order(l)).toEqual(['t3', 't1', 't2', 't4']);
    l.move('t3', null);
    expect(order(l)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('never lets a pin leave the pins, or a tab join them', () => {
    const l = list();
    ['a', 'b', 'c'].forEach((url, i) => l.open({ url, pinned: i < 2 }));
    l.move('t1', 't3');
    expect(order(l)).toEqual(['t2', 't1', 't3']);
    l.move('t3', 't2');
    expect(order(l)).toEqual(['t2', 't1', 't3']);
  });

  it('keeps the sign-in tab first', () => {
    const l = list();
    l.open({ url: 'p', pinned: true });
    l.open({ url: 's', signIn: true });
    l.move('t1', 't2');
    expect(order(l)).toEqual(['t2', 't1']);
  });
});

describe('sign-in tab', () => {
  it('always sits left of pins, and can never be pinned', () => {
    const l = list();
    l.open({ url: 'p', pinned: true });
    l.open({ url: 'u' });
    l.open({ url: 's', signIn: true });
    expect(order(l)).toEqual(['t3', 't1', 't2']);
    l.setPinned('t3', true);
    expect(l.get('t3')?.pinned).toBe(false);
    l.open({ url: 'pin-two', pinned: true });
    expect(order(l)).toEqual(['t3', 't1', 't4', 't2']);
  });

  it('becomes a regular tab at the front of the unpinned group', () => {
    const l = list();
    l.open({ url: 'p', pinned: true });
    l.open({ url: 'u' });
    l.open({ url: 's', signIn: true });
    l.becomeRegular('t3');
    expect(order(l)).toEqual(['t1', 't3', 't2']);
    expect(l.get('t3')?.signIn).toBe(false);
  });
});

describe('lock', () => {
  it('locks to a URL, survives other changes, and unlocks', () => {
    const l = list();
    l.open({ url: 'u' });
    l.setLocked('t1', 'https://cad.onshape.com/documents?nodeId=x');
    l.update('t1', { url: 'other', title: 'T' });
    expect(l.get('t1')?.lockedUrl).toBe(
      'https://cad.onshape.com/documents?nodeId=x',
    );
    l.setLocked('t1', null);
    expect(l.get('t1')?.lockedUrl).toBeUndefined();
  });

  it('never locks the sign-in tab', () => {
    const l = list();
    l.open({ url: 's', signIn: true });
    l.setLocked('t1', 's');
    expect(l.get('t1')?.lockedUrl).toBeUndefined();
  });
});

describe('rename', () => {
  it('a name wins over the page title; an empty name clears it', () => {
    const l = list();
    l.open({ url: 'u', title: 'Owned by me | Documents' });
    expect(displayName(l.get('t1')!)).toBe('Owned by me | Documents');
    l.rename('t1', '  Mine  ');
    expect(displayName(l.get('t1')!)).toBe('Mine');
    l.update('t1', { title: 'New page title' });
    expect(displayName(l.get('t1')!)).toBe('Mine');
    l.rename('t1', '   ');
    expect(displayName(l.get('t1')!)).toBe('New page title');
  });

  it('never renames the sign-in tab', () => {
    const l = list();
    l.open({ url: 's', title: 'Sign in', signIn: true });
    l.rename('t1', 'Nope');
    expect(l.get('t1')?.name).toBeUndefined();
  });

  it('falls back to the URL when there is no title yet', () => {
    expect(displayName({ url: 'https://x', title: '' })).toBe('https://x');
  });
});

describe('tabsToRestore', () => {
  const saved = {
    tabs: [
      { url: 'pin-one', title: 'Pin one', pinned: true },
      { url: 'u1', title: 'U1', pinned: false },
      { url: 'pin-two', title: 'Pin two', pinned: true },
    ],
    activeIndex: 2,
  };

  it('restores everything when the setting is on', () => {
    expect(tabsToRestore(saved, true)).toEqual(saved);
  });

  it('restores only pins by default, keeping the active pin selected', () => {
    const r = tabsToRestore(saved, false);
    expect(r.tabs.map((t) => t.url)).toEqual(['pin-one', 'pin-two']);
    expect(r.activeIndex).toBe(1);
  });

  it('falls back to the first pin when the active tab was unpinned', () => {
    expect(tabsToRestore({ ...saved, activeIndex: 1 }, false).activeIndex).toBe(
      0,
    );
  });
});
