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
  /**
   * Stripe is waiting on the SPOTTER for something only its own screen can
   * collect — typically a photo ID after the typed details didn't verify
   * (2026-10-14). Not the bank or website: those are ours to meet above. The
   * screen must say "we need one more thing from you", never "being checked".
   */
  needsAction: boolean;
}

/** The parts of a v2 requirement entry this reads (older API answers may lack them). */
type RequirementEntry = {
  description: string;
  awaiting_action_from?: string;
  minimum_deadline?: { status?: string };
};

/**
 * WHO IS WAITING ON WHOM. A requirement is the spotter's to act on when Stripe
 * says it is awaiting the `user` (with a platform-collected account, that is
 * us — and through us, them) and it is due NOW (`currently_due` / `past_due`;
 * an `eventually_due` one blocks nothing yet). `awaiting_action_from: stripe`
 * is Stripe reviewing — genuinely "being checked".
 */
function spotterMustAct(entry: RequirementEntry): boolean {
  if (entry.description === REQUIREMENT_BANK || entry.description === REQUIREMENT_WEBSITE) {
    return false;
  }
  const due = entry.minimum_deadline?.status;
  return entry.awaiting_action_from === 'user' && (due === 'currently_due' || due === 'past_due');
}

/** The account's state from Stripe, or null if Stripe couldn't be read. */
export async function readPayoutAccountState(
  stripe: Stripe,
  accountId: string,
): Promise<PayoutAccountState | null> {
  let v2Payouts: string | undefined;
  let entries: RequirementEntry[] = [];
  try {
    const account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.recipient', 'requirements'],
    });
    v2Payouts = account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status;
    entries = account.requirements?.entries ?? [];
  } catch {
    // A legacy account, or a blip: v1 below decides.
  }
  const outstanding = entries.map((entry) => entry.description);
  const needs = {
    needsBank: outstanding.includes(REQUIREMENT_BANK),
    needsWebsite: outstanding.includes(REQUIREMENT_WEBSITE),
    needsAction: entries.some(spotterMustAct),
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
