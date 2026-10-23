/**
 * WHAT:  Tests for deletionReason — every blocker code reads as one line that
 *        says what to do, and an unknown code still reads as a reason.
 * WHY:   A code the server adds before the app knows it must not render as a
 *        blank line beside no button — that would look like a broken screen.
 * LINKS: ./deletionReasons.ts.
 */

import { deletionReason } from './deletionReasons';

describe('deletionReason', () => {
  it.each([
    ['LIVE_LISTING', 1, 'A listing has a reward or a recovery in progress. Close it first.'],
    ['LIVE_LISTING', 3, '3 listings have a reward or a recovery in progress. Close them first.'],
    ['MONEY_HELD', 1, 'Money from a listing is still being returned to you.'],
    ['REWARD_ON_ITS_WAY', 1, 'A reward is waiting for you. Set up payouts to receive it.'],
    ['DISPUTE_OPEN', 1, 'A dispute is still being decided.'],
    ['REVIEW_OPEN', 2, 'A payment is still being reviewed.'],
  ])('%s ×%i', (code, count, words) => {
    expect(deletionReason({ code, count })).toBe(words);
  });

  it('an unknown code is still a reason', () => {
    expect(deletionReason({ code: 'SOMETHING_NEW', count: 1 })).toBe(
      'Something on your account is still in progress.',
    );
  });
});
