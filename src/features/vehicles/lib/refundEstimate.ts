/**
 * WHAT:  estimateRefundPence — the client-side ESTIMATE of what an owner gets
 *        back when they deactivate a paid listing (bounty minus the ~UK card
 *        fee, ~1.5% + 20p).
 * WHY:   Two surfaces quote the figure before the owner commits — the detail
 *        body's "Deactivate listing" section and the confirm dialog on the
 *        screen — and they must never disagree, so the arithmetic lives in one
 *        place. This is COPY ONLY: the server withholds the real Stripe fee and
 *        returns the authoritative refunded amount, which is what the
 *        post-refund toast shows.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx (the section copy);
 *        src/features/vehicles/screens/PostDetailScreen.tsx (the confirm copy +
 *          the exact-amount toast);
 *        supabase/migrations/20260729100000_post_refund_cancel.sql (the server
 *          path that computes the real figure).
 */

/** Bounty minus the estimated non-recoverable card fee, floored at zero. */
export function estimateRefundPence(bountyPence: number): number {
  return Math.max(0, bountyPence - (Math.round(bountyPence * 0.015) + 20));
}
