/**
 * WHAT:  readPayoutAccountState — asks Stripe, directly, whether a spotter's
 *        payee account can be paid, for either generation of account, and
 *        which of Stripe's outstanding requirements we can meet ourselves.
 *        ensureBusinessUrl — supplies the one requirement every account has
 *        and no spotter should be asked for.
 * WHY:   2026-10-13: an owner set payouts up in test mode and sat on "Your
 *        details are being checked" indefinitely. Our row's payouts_enabled is
 *        written by ONE thing — the account.updated webhook — and if that
 *        doesn't arrive, the screen never moves. This lets the app ask instead
 *        of wait.
 *
 *        THEN, THE SAME DAY: the account Stripe reported was `restricted` on
 *        two requirements, neither of them an ID check — `external_account`
 *        (no bank attached: an earlier attempt's bank failed, and the retry's
 *        was thrown away as "already set up") and `defaults.profile.business_url`
 *        (Stripe's routine "what's your website?", asked of EVERY account and
 *        never sent by create-payout-account). Both are ours to supply, so the
 *        read reports them: the bank goes back to the spotter as our own
 *        three-field form, the website the platform fills in (PLATFORM_URL).
 *        Stripe's own screen is then only for what genuinely needs it.
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
 * LINKS: ../sync-payout-account/index.ts; ../create-payout-account/index.ts;
 *        ../stripe-webhook/index.ts (account.updated, the other writer).
 */

import type Stripe from 'npm:stripe@22.4.0';

/**
 * The website Stripe asks every payee account for (owner's choice,
 * 2026-10-13). A spotter is an individual with no site of their own; a
 * marketplace supplies its own, which is what Stripe expects of a platform.
 */
export const PLATFORM_URL = 'https://trackitdown.co.uk';

/** Stripe's names for the two requirements we can meet without Stripe's UI. */
export const REQUIREMENT_BANK = 'external_account';
export const REQUIREMENT_WEBSITE = 'defaults.profile.business_url';

export interface PayoutAccountState {
  payoutsEnabled: boolean;
  /** Stripe's own "details submitted" — v1's flag. Never used to UNDO a
   *  recorded submission (upsert_connected_account keeps it once true). */
  detailsSubmitted: boolean;
  /** No bank account attached — the spotter adds one in our form. */
  needsBank: boolean;
  /** Stripe still wants the website — the platform supplies it. */
  needsWebsite: boolean;
}

/** The account's state from Stripe, or null if Stripe couldn't be read. */
export async function readPayoutAccountState(
  stripe: Stripe,
  accountId: string,
): Promise<PayoutAccountState | null> {
  let v2Payouts: string | undefined;
  let outstanding: string[] = [];
  try {
    const account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.recipient', 'requirements'],
    });
    v2Payouts = account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status;
    outstanding = (account.requirements?.entries ?? []).map((entry) => entry.description);
  } catch {
    // A legacy account, or a blip: v1 below decides.
  }
  const needs = {
    needsBank: outstanding.includes(REQUIREMENT_BANK),
    needsWebsite: outstanding.includes(REQUIREMENT_WEBSITE),
  };

  try {
    const v1 = await stripe.accounts.retrieve(accountId);
    return {
      payoutsEnabled: v2Payouts !== undefined ? v2Payouts === 'active' : Boolean(v1.payouts_enabled),
      detailsSubmitted: Boolean(v1.details_submitted),
      ...needs,
    };
  } catch {
    if (v2Payouts !== undefined) {
      return { payoutsEnabled: v2Payouts === 'active', detailsSubmitted: false, ...needs };
    }
    return null;
  }
}

/**
 * Give a v2 payee account the platform's website, so Stripe's routine
 * "business URL" requirement never lands on a spotter. True if it was set.
 * Never throws: a failure leaves the requirement where it was, and the next
 * check tries again.
 */
export async function ensureBusinessUrl(stripe: Stripe, accountId: string): Promise<boolean> {
  try {
    await stripe.v2.core.accounts.update(accountId, {
      defaults: { profile: { business_url: PLATFORM_URL } },
    });
    return true;
  } catch {
    return false;
  }
}
