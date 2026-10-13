/**
 * WHAT:  readPayoutAccountState — asks Stripe, directly, whether a spotter's
 *        payee account can be paid, for either generation of account.
 * WHY:   2026-10-13: an owner set payouts up in test mode and sat on "Your
 *        details are being checked" indefinitely. Our row's payouts_enabled is
 *        written by ONE thing — the account.updated webhook — and if that
 *        doesn't arrive (an endpoint not scoped to connected accounts, or an
 *        event Stripe sends differently for v2 accounts), the screen never
 *        moves. This lets the app ask instead of wait.
 *
 *        TWO GENERATIONS. Accounts made by create-payout-account are Accounts
 *        v2 with the recipient configuration, and "can be paid" is the
 *        `stripe_balance.payouts` capability being active — the same test
 *        create-payout-account uses at creation. Legacy Express accounts (from
 *        connect-onboarding) have no recipient configuration; for them it is
 *        v1's `payouts_enabled`, the flag the webhook copies. v2 first, v1 when
 *        v2 has nothing to say.
 *
 *        Type-only imports, so the Jest suite can drive it with a fake client
 *        (supabase/tests/payoutAccountState.test.ts, the push.test.ts pattern).
 * LINKS: ../sync-payout-account/index.ts (the caller);
 *        ../create-payout-account/index.ts (the same capability test);
 *        ../stripe-webhook/index.ts (account.updated, the other writer).
 */

import type Stripe from 'npm:stripe@22.4.0';

export interface PayoutAccountState {
  payoutsEnabled: boolean;
  /** Stripe's own "details submitted" — v1's flag. Never used to UNDO a
   *  recorded submission (upsert_connected_account keeps it once true). */
  detailsSubmitted: boolean;
}

/** The account's state from Stripe, or null if Stripe couldn't be read. */
export async function readPayoutAccountState(
  stripe: Stripe,
  accountId: string,
): Promise<PayoutAccountState | null> {
  let v2Payouts: string | undefined;
  try {
    const account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.recipient'],
    });
    v2Payouts = account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status;
  } catch {
    // A legacy account, or a blip: v1 below decides.
  }

  try {
    const v1 = await stripe.accounts.retrieve(accountId);
    return {
      payoutsEnabled: v2Payouts !== undefined ? v2Payouts === 'active' : Boolean(v1.payouts_enabled),
      detailsSubmitted: Boolean(v1.details_submitted),
    };
  } catch {
    if (v2Payouts !== undefined) {
      return { payoutsEnabled: v2Payouts === 'active', detailsSubmitted: false };
    }
    return null;
  }
}
