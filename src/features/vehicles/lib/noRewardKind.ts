/**
 * WHAT:  noRewardKind — for a listing with NO reward held, which of the three
 *        truths applies: its reward ENDED and went back (ADR-0020), it PAID
 *        the £5 listing fee (ADR-0014), or neither is known.
 * WHY:   The owner's deactivate copy makes a money statement either way —
 *        "your listing fee isn't refunded" or "your reward already went back".
 *        Inferring the fee from a null bounty was wrong for any listing that
 *        is neither (a hand-applied prod row, a reward whose held row went
 *        missing); the server now says it from the ledger (has_listing_fee,
 *        owner-only, 20261006110000). An older server doesn't send it, so the
 *        inference stays as the fallback rather than going silent.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx (deactivate card);
 *        src/features/vehicles/components/PostOwnerActions.tsx (the confirm);
 *        supabase/migrations/20261006110000_a_fee_is_a_fact.sql.
 */

import type { PostDetail } from '../types';

export type NoRewardKind = 'ended' | 'fee' | 'unknown';

/** Which no-reward listing this is. Only meaningful while bountyPence is null. */
export function noRewardKind(post: Pick<PostDetail, 'rewardEnded' | 'hasListingFee'>): NoRewardKind {
  if (post.rewardEnded) return 'ended';
  // The ledger's answer when the server gave one; the old inference otherwise.
  return (post.hasListingFee ?? true) ? 'fee' : 'unknown';
}
