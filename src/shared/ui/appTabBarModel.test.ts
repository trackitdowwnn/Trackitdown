/**
 * WHAT:  Tests for AppTabBar's pure logic — badge display thresholds (none /
 *        dot / count / "9+") and the spoken tab label with badge and
 *        position.
 * WHY:   A wrong badge threshold silently over- or under-states unread
 *        activity, and screen-reader users get ONLY these labels — pinned
 *        cheaply here, no rendering.
 * LINKS: src/shared/ui/appTabBarModel.ts; docs/TESTING.md.
 */

import { badgeDisplay, defaultBadgeLabel, tabAccessibilityLabel } from './appTabBarModel';

describe('badgeDisplay', () => {
  it('absent, false, and zero render nothing', () => {
    expect(badgeDisplay(undefined)).toEqual({ kind: 'none' });
    expect(badgeDisplay(false)).toEqual({ kind: 'none' });
    expect(badgeDisplay(0)).toEqual({ kind: 'none' });
  });

  it('true renders a dot', () => {
    expect(badgeDisplay(true)).toEqual({ kind: 'dot' });
  });

  it('1–9 render the exact count', () => {
    expect(badgeDisplay(1)).toEqual({ kind: 'count', text: '1' });
    expect(badgeDisplay(9)).toEqual({ kind: 'count', text: '9' });
  });

  it('10 and beyond collapse to 9+', () => {
    expect(badgeDisplay(10)).toEqual({ kind: 'count', text: '9+' });
    expect(badgeDisplay(120)).toEqual({ kind: 'count', text: '9+' });
  });

  it('nonsense counts render nothing', () => {
    expect(badgeDisplay(-3)).toEqual({ kind: 'none' });
    expect(badgeDisplay(Number.NaN)).toEqual({ kind: 'none' });
    expect(badgeDisplay(Number.POSITIVE_INFINITY)).toEqual({ kind: 'none' });
    expect(badgeDisplay(0.9)).toEqual({ kind: 'none' }); // never a "0" pill
  });
});

describe('tabAccessibilityLabel', () => {
  it('bare tab: name and position only', () => {
    expect(tabAccessibilityLabel('Explore', 0, 4, undefined)).toBe('Explore, tab 1 of 4');
  });

  it('dot badge announces activity without a number', () => {
    expect(tabAccessibilityLabel('My Cars', 1, 4, true)).toBe(
      'My Cars, new activity, tab 2 of 4',
    );
  });

  it('count badge speaks the number', () => {
    expect(tabAccessibilityLabel('Inbox', 2, 4, 3)).toBe('Inbox, 3 new, tab 3 of 4');
  });

  it('overflow count is honest, not "9+"', () => {
    expect(tabAccessibilityLabel('Inbox', 2, 4, 12)).toBe(
      'Inbox, more than 9 new, tab 3 of 4',
    );
  });

  it('custom badge wording is used for counts', () => {
    expect(tabAccessibilityLabel('Inbox', 2, 4, 3, (n) => `${n} unread messages`)).toBe(
      'Inbox, 3 unread messages, tab 3 of 4',
    );
  });

  it('zero badge adds nothing', () => {
    expect(tabAccessibilityLabel('Inbox', 2, 4, 0)).toBe('Inbox, tab 3 of 4');
  });

  it('defaultBadgeLabel matches the visual 9+ threshold', () => {
    expect(defaultBadgeLabel(9)).toBe('9 new');
    expect(defaultBadgeLabel(10)).toBe('more than 9 new');
  });
});
