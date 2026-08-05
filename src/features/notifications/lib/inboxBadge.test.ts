/**
 * WHAT:  Tests for the Inbox badge aggregator — the sum is honest, halves
 *        never overwrite each other, and garbage reports degrade to zero.
 * WHY:   The tab shows ONE number for two features. The failure this guards
 *        is silent and user-facing: chat reporting 3 must not erase the
 *        center's 2, or the badge lies at a glance.
 * LINKS: ./inboxBadge.ts; src/features/chat/hooks/useInbox.ts;
 *        ../hooks/useNotificationCenter.ts.
 */

import { reportInboxBadge, resetInboxBadge } from './inboxBadge';

beforeEach(() => {
  resetInboxBadge();
});

describe('reportInboxBadge', () => {
  it('sums the two halves and neither overwrites the other', () => {
    expect(reportInboxBadge('chat', 3)).toBe(3);
    expect(reportInboxBadge('center', 2)).toBe(5);
    // Chat re-reporting updates ITS half only.
    expect(reportInboxBadge('chat', 1)).toBe(3);
    // A half clearing to zero leaves the other standing.
    expect(reportInboxBadge('center', 0)).toBe(1);
  });

  it('treats garbage as zero — the badge may never show NaN or negatives', () => {
    expect(reportInboxBadge('chat', Number.NaN)).toBe(0);
    expect(reportInboxBadge('center', -4)).toBe(0);
    expect(reportInboxBadge('chat', 2.9)).toBe(2);
  });
});
