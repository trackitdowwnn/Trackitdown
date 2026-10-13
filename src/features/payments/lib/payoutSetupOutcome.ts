/**
 * WHAT:  A one-shot hand-back from the payout-setup wizard to PayoutsScreen:
 *        how the setup ended, read once when Payouts regains focus.
 * WHY:   The wizard is its own pushed screen (2026-10-13) and goes BACK when it
 *        is done, and Payouts must then do one of two things: arm its settling
 *        window ("details sent — Stripe is checking"), or offer "Continue with
 *        Stripe" when Stripe refused what our form can describe. expo-router
 *        has no documented way to hand params to the screen you return to
 *        (dismissTo's effect on an existing screen's params is unspecified in
 *        the v57 docs), so this is a module value instead: set by the wizard,
 *        consumed — and cleared — by Payouts.
 *
 *        ⚠️ KEYED TO THE USER WHO SET IT (security review, 2026-10-13). The
 *        value lives until some Payouts screen takes it, which need not be
 *        soon — the wizard is deep-linkable, so it can end with no Payouts
 *        beneath it — and by then someone else may be signed in. A stale
 *        'rejected' would show THEM "Continue with Stripe", whose button
 *        spends their prefill window for good. So a take by a different user
 *        returns nothing, and drops the value.
 *
 *        Holds an outcome word and a user id, and nothing else. Never a detail
 *        the spotter typed.
 * LINKS: ../screens/PayoutSetupScreen.tsx (sets it);
 *        ../screens/PayoutsScreen.tsx (consumes it on focus).
 */

export type PayoutSetupOutcome = 'submitted' | 'rejected';

let pending: { outcome: PayoutSetupOutcome; userId: string } | null = null;

/** Leave an outcome for `userId`'s next Payouts focus, replacing any other. */
export function setPayoutSetupOutcome(outcome: PayoutSetupOutcome, userId: string): void {
  pending = { outcome, userId };
}

/** The outcome this user left, if any — and it is gone once read, whoever
 *  reads it. */
export function takePayoutSetupOutcome(userId: string | null): PayoutSetupOutcome | null {
  const taken = pending;
  pending = null;
  return taken && userId && taken.userId === userId ? taken.outcome : null;
}
