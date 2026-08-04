/**
 * WHAT:  Finds or creates a spotter's Stripe Express account, and records it.
 * WHY:   TWO functions now need an account to exist — the one that collects
 *        payout details through our own form, and the one that hands off to
 *        Stripe. Two copies of `accounts.create` is how one person ends up with
 *        two Express accounts, their history split across both and only one of
 *        them payable. So there is exactly one copy, here.
 *
 *        IDEMPOTENT BY LOOKUP, NOT BY KEY: the account id is recorded before it
 *        is used for anything, so a caller that dies mid-flow leaves an id to
 *        reuse rather than an orphan Stripe account nobody can find again.
 * LINKS: supabase/functions/submit-payout-details/index.ts;
 *        supabase/functions/connect-onboarding/index.ts;
 *        supabase/migrations/20260802220000_release_payout.sql
 *          (upsert_connected_account — the only writer of that table);
 *        docs/decisions/ADR-0002-stripe-connect.md.
 */

import type Stripe from 'npm:stripe@22.4.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

/** What the caller needs to know, without leaking Stripe's whole object. */
export interface ConnectAccountLookup {
  accountId: string | null;
  payoutsEnabled: boolean;
  /** Stripe's "they finished the form" flag, as our row last heard it. */
  onboardingComplete: boolean;
  /** Whether they have already given us details through our own form. */
  detailsSubmitted: boolean;
}

/** Read the caller's own payee row. Absent is normal — most people have none. */
export async function findConnectAccount(
  admin: SupabaseClient,
  userId: string,
): Promise<ConnectAccountLookup> {
  const { data, error } = await admin
    .from('stripe_connected_accounts')
    .select('stripe_account_id, payouts_enabled, onboarding_complete, details_submitted_at')
    .eq('profile_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`connect account lookup failed: ${error.message}`);
  }
  return {
    accountId: (data?.stripe_account_id as string | undefined) ?? null,
    payoutsEnabled: Boolean(data?.payouts_enabled),
    onboardingComplete: Boolean(data?.onboarding_complete),
    detailsSubmitted: Boolean(data?.details_submitted_at),
  };
}

/**
 * Create the Express account for this spotter and record it.
 *
 * Call ONLY when `findConnectAccount` returned no id — creating a second one is
 * silent, permitted by Stripe, and splits a person's history in two.
 */
export async function createConnectAccount(
  stripe: Stripe,
  admin: SupabaseClient,
  userId: string,
): Promise<string> {
  const account = await stripe.accounts.create({
    // NO `type: 'express'`. ADR-0002 chose controller properties over the
    // legacy account types, and Stripe rejects a request carrying both.
    //
    // STILL THE v1 CONTROLLER FORM, NOW DELIBERATELY TRANSITIONAL: the SDK bump
    // (22.4.0, 2026-08-03) makes `stripe.v2.core.accounts` available, and
    // ADR-0010 decides new payee accounts move to the v2 `recipient`
    // configuration with `dashboard: none`. That build is the next phase; until
    // it lands, this remains the ONLY account creator, and accounts it creates
    // are the ones the hosted/embedded fallback exists for. Do not "quickly"
    // port this to v2 in passing — the v2 shape changes who collects
    // requirements, which is a product change, not a refactor.
    country: 'GB',
    // UK-only, GBP-only (ROADMAP's v1 fence). A spotter is paid, never charged,
    // so only transfers are requested.
    capabilities: { transfers: { requested: true } },
    business_type: 'individual',
    // Platform bears negative balances — required with an Express dashboard, and
    // under separate charges and transfers it is what lets Stripe reverse a
    // spotter's transfer if the bounty is disputed later. The transfer is not
    // tied to the original charge, so nothing else would.
    controller: {
      losses: { payments: 'application' },
      fees: { payer: 'application' },
      stripe_dashboard: { type: 'express' },
    },
    // THE LINK BACK. `account.updated` arrives with no reference to our user
    // unless we put one here, and the webhook refuses to guess — so without this
    // metadata a completed onboarding could never be matched to the spotter it
    // belongs to.
    metadata: { profile_id: userId },
  });

  // Recorded BEFORE it is used for anything, and deliberately not-yet-payable.
  // If this write were skipped and the user abandoned the flow, the next call
  // would create a SECOND account for the same person; recording it first makes
  // the id ours to reuse.
  const { error } = await admin.rpc('upsert_connected_account', {
    p_profile_id: userId,
    p_stripe_account_id: account.id,
    p_onboarding_complete: false,
    p_payouts_enabled: false,
  });
  if (error) {
    throw new Error(`connect account record failed: ${error.message}`);
  }
  return account.id;
}
