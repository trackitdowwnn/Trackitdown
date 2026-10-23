/**
 * WHAT:  Tests for deletionReason — every blocker code reads as a short title
 *        plus a line saying what to do, and an unknown code still reads as a
 *        reason.
 * WHY:   A code the server adds before the app knows it must not render as a
 *        blank row beside no button — that would look like a broken sheet.
 * LINKS: ./deletionReasons.ts.
 */

import { deletionReason } from './deletionReasons';

describe('deletionReason', () => {
  it.each([
    [
      'LIVE_LISTING',
      1,
      'A listing in progress',
      'A reward or a recovery is still open. Close it first.',
    ],
    [
      'LIVE_LISTING',
      3,
      '3 listings in progress',
      'A reward or a recovery is still open. Close it first.',
    ],
    ['MONEY_HELD', 1, 'Money on its way back', 'A refund from a listing hasn’t landed yet.'],
    ['REWARD_ON_ITS_WAY', 1, 'A reward for you', 'Set up payouts to receive it first.'],
    ['DISPUTE_OPEN', 1, 'A dispute', 'It’s still being decided.'],
    ['REVIEW_OPEN', 2, 'A payment under review', 'It’s still being checked.'],
  ])('%s ×%i', (code, count, title, detail) => {
    expect(deletionReason({ code, count })).toEqual({ title, detail });
  });

  it('an unknown code is still a reason', () => {
    expect(deletionReason({ code: 'SOMETHING_NEW', count: 1 })).toEqual({
      title: 'Something in progress',
      detail: 'Try again a little later.',
    });
  });
});
