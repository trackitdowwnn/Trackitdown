/**
 * WHAT:  The reward-listing charge rule (ADR-0020): the owner pays the reward
 *        plus a 5% service fee, and the credited spotter receives the reward in
 *        full. `rewardCharge(reward)` returns all three numbers.
 * WHY:   The Edge Function needs the charge to create the PaymentIntent, and
 *        record_post_payment_intent recomputes it and refuses anything else —
 *        two independent derivations that must agree, exactly as the old 95/5
 *        split had in `splitBounty` + `payout_split`. Kept free of imports so
 *        Jest can test it directly (supabase/functions is outside tsconfig and
 *        expo lint; a unit test is the only thing that reads this file before
 *        it runs).
 * MONEY: integer pence only. The fee is FLOOR(5%) — `(reward * 5) / 100` in
 *        Postgres integer division — so it never exceeds 5%, and every
 *        whole-pound reward is exact. `charge = reward + fee` exactly; the
 *        payments_split_check constraint makes any other row unwritable.
 * LINKS: supabase/migrations/20260925100000_the_reward_is_the_reward.sql
 *          (record_post_payment_intent, payments_split_check);
 *        supabase/functions/create-payment-intent/index.ts (the caller);
 *        src/shared/lib/money.ts (chargeBreakdown — the client's display copy);
 *        docs/decisions/ADR-0020-the-reward-is-the-reward.md.
 */

/** The service fee as a percentage of the reward. Display and maths share it. */
export const SERVICE_FEE_PERCENT = 5;

export interface RewardCharge {
  /** What the credited spotter receives. */
  rewardPence: number;
  /** What the platform keeps on a spotter-led recovery. */
  serviceFeePence: number;
  /** What the owner is charged: reward + service fee. */
  chargePence: number;
}

/** reward + floor(5%) — the charge for a reward listing. */
export function rewardCharge(rewardPence: number): RewardCharge {
  if (!Number.isInteger(rewardPence) || rewardPence <= 0) {
    throw new Error(`rewardCharge expects positive integer pence, got ${rewardPence}`);
  }
  const serviceFeePence = Math.floor((rewardPence * SERVICE_FEE_PERCENT) / 100);
  return { rewardPence, serviceFeePence, chargePence: rewardPence + serviceFeePence };
}
