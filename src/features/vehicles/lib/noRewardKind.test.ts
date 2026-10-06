/**
 * WHAT:  Tests for noRewardKind — ended beats everything; the ledger's fee
 *        answer wins when the server gives one; the old inference only when
 *        it doesn't.
 * WHY:   Each answer picks a money sentence on the owner's deactivate copy.
 *        "Your listing fee isn't refunded" to someone who never paid one is
 *        the bug this exists to stop.
 * LINKS: src/features/vehicles/lib/noRewardKind.ts.
 */

import { noRewardKind } from './noRewardKind';

describe('noRewardKind', () => {
  it.each([
    ['ended', { rewardEnded: true, hasListingFee: undefined }],
    // A fee listing that later added a reward which then lapsed: it ENDED —
    // the reward going back is the news.
    ['ended', { rewardEnded: true, hasListingFee: true }],
    ['fee', { rewardEnded: false, hasListingFee: true }],
    // The ledger says no fee was paid: never claim one.
    ['unknown', { rewardEnded: false, hasListingFee: false }],
    // An older server (or a spotter's payload): the old inference.
    ['fee', { rewardEnded: false, hasListingFee: undefined }],
  ] as const)('%s for %j', (kind, post) => {
    expect(noRewardKind(post)).toBe(kind);
  });
});
