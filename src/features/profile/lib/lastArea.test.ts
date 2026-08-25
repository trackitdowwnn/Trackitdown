/**
 * WHAT:  Tests for the last-visited-tab store behind the bug reporter's
 *        pre-filled area.
 * WHY:   This module is one string, and the only interesting thing about it is
 *        what it REFUSES. The original bug reporter would not capture the
 *        current route because a route can be `/post/<id>`, tying a report to
 *        one specific stolen car; this convenience has to stay on the safe side
 *        of that line, and "it only ever holds one of four tab names" is the
 *        property that keeps it there.
 * LINKS: ./lastArea.ts; ./bugReportOptions.ts.
 */

import { noteVisitedTab, readLastArea, resetLastArea } from './lastArea';

beforeEach(() => resetLastArea());

describe('the pre-filled area', () => {
  it('is null before any tab has been seen', () => {
    // A fresh launch straight into a deep link. Guessing would be worse than
    // asking: a wrong pre-fill is a wrong fact the reporter has to notice.
    expect(readLastArea()).toBeNull();
  });

  it('maps each tab to the area a reporter would name', () => {
    noteVisitedTab('explore');
    expect(readLastArea()).toBe('explore');

    noteVisitedTab('inbox');
    expect(readLastArea()).toBe('messages');

    noteVisitedTab('watchlist');
    expect(readLastArea()).toBe('watchlist');

    noteVisitedTab('profile');
    expect(readLastArea()).toBe('account');
  });

  it('⚠️ refuses anything that is not one of the four tabs', () => {
    // The guard that keeps a route out. If this ever accepts arbitrary strings,
    // the caller in (tabs)/_layout.tsx is one refactor away from handing it a
    // pathname — and `/post/<uuid>` is exactly what must never be stored.
    noteVisitedTab('explore');

    noteVisitedTab('/post/11111111-2222-3333-4444-555555555555');
    noteVisitedTab('post');
    noteVisitedTab('');
    noteVisitedTab(null);
    noteVisitedTab(undefined);

    // Still the last VALID tab, never the rejected value.
    expect(readLastArea()).toBe('explore');
  });

  it('⚠️ cannot be made to return a value it was never given', () => {
    // Belt and braces on the same rule, from the read side: whatever is stored,
    // the answer is always one of the closed vocabulary or null.
    noteVisitedTab('constructor');
    noteVisitedTab('__proto__');
    noteVisitedTab('toString');

    expect(readLastArea()).toBeNull();
  });
});
