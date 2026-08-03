/**
 * WHAT:  Edge Function that gives a spotter somewhere for their bounty to land:
 *        creates their Stripe Express account if they have none, then returns a
 *        fresh hosted onboarding link for them to open.
 * WHY:   `release-payout` will not transfer a penny unless
 *        `stripe_connected_accounts.payouts_enabled` is true, and until this
 *        function existed nothing ever created a row there. The money half of
 *        the product had a payer and no payee.
 *
 * ASKED FOR AT THE RIGHT MOMENT, NOT AT SIGNUP.
 *        DOMAIN.md is explicit: KYC is requested when a spotter's first
 *        sighting is CREDITED, not when they join. Demanding bank details and a
 *        date of birth from someone who has just downloaded a car-spotting app
 *        is how you lose them before they have spotted anything. So this is
 *        called from the payouts surface, and the natural time to reach it is
 *        the moment there is money waiting.
 *
 * MONEY: this function moves NOTHING. It creates an account and a link; the
 *        transfer is `release-payout`, and the flags that permit it are written
 *        only by Stripe's own `account.updated` webhook. A client cannot make
 *        itself payable by calling this.
 *
 * WHY THE ACCOUNT IS NOT MARKED READY HERE:
 *        returning from Stripe's flow does NOT mean verification passed —
 *        documents can be reviewed for days and can fail. So this records the
 *        account with `payouts_enabled: false` and lets the webhook be the
 *        single source of truth. Trusting the redirect would create a spotter
 *        who looks payable and is not, and `release-payout` would then fail at
 *        the transfer instead of waiting politely.
 *
 * LINKS: supabase/migrations/20260802220000_release_payout.sql
 *          (upsert_connected_account — the only writer of that table);
 *        supabase/functions/stripe-webhook/index.ts (account.updated);
 *        supabase/functions/release-payout/index.ts (what this unblocks);
 *        docs/decisions/ADR-0002-stripe-connect.md (Express, separate charges
 *          and transfers, losses_collector: application);
 *        docs/DOMAIN.md ("prompt at first credited sighting, not at signup").
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

/**
 * Where Stripe sends the spotter afterwards. Both are the app's own scheme, so
 * the hosted flow hands control straight back to the screen that started it.
 *
 * `refresh_url` is not an error path — Stripe uses it when a link has expired
 * (they are short-lived by design), and the app answers by asking for a new
 * one. Sending them to a dead end there would strand someone mid-KYC.
 */
const RETURN_URL = 'trackitdown://payouts?onboarding=complete';
const REFRESH_URL = 'trackitdown://payouts?onboarding=refresh';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }

  const admin = createServiceRoleClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }
  const userId = userData.user.id;

  // The account is always the CALLER's. Deliberately no id in the request body:
  // a payee id that arrived over the wire is a payee id someone could change.
  const { data: existing, error: lookupError } = await admin
    .from('stripe_connected_accounts')
    .select('stripe_account_id, payouts_enabled')
    .eq('profile_id', userId)
    .maybeSingle();

  if (lookupError) {
    console.error('[payments] connect account lookup failed', lookupError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t start this. Please try again.', 500);
  }

  // Already done. Say so rather than sending them back through KYC they have
  // finished — and rather than creating a SECOND Express account for the same
  // person, which Stripe permits and which would split their history.
  if (existing?.payouts_enabled) {
    return jsonResponse({ status: 'already_enabled' });
  }

  const stripe = createStripeClient();
  let accountId = existing?.stripe_account_id as string | undefined;

  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        // NO `type: 'express'`. ADR-0002 chose controller properties over the
        // legacy account types, and Stripe rejects a request carrying both.
        //
        // ⚠️ DEVIATION FROM ADR-0002's LETTER, NOT ITS INTENT: the ADR names
        // the v2 Accounts fields (`dashboard`, `fees_collector`,
        // `losses_collector`), which need the v2 Accounts API — a newer
        // pinned `apiVersion` and stripe SDK than `_shared/clients.ts` uses
        // (17.5.0 / 2024-06-20). Upgrading the SDK under the whole escrow path
        // to create one account is a bad trade, so this uses the v1 controller
        // form, which expresses the SAME three decisions: Express dashboard,
        // platform collects fees, platform carries losses. Revisit together
        // with any SDK bump.
        country: 'GB',
        // UK-only, GBP-only (ROADMAP's v1 fence). A spotter is paid, never
        // charged, so only transfers are requested.
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        // Platform bears negative balances — required with an Express
        // dashboard, and under separate charges and transfers it is what lets
        // Stripe reverse a spotter's transfer if the bounty is disputed later.
        // The transfer is not tied to the original charge, so nothing else
        // would.
        controller: {
          losses: { payments: 'application' },
          fees: { payer: 'application' },
          stripe_dashboard: { type: 'express' },
        },
        // THE LINK BACK. `account.updated` arrives with no reference to our
        // user unless we put one here, and the webhook refuses to guess — so
        // without this metadata a completed onboarding could never be matched
        // to the spotter it belongs to.
        metadata: { profile_id: userId },
      });
      accountId = account.id;
    } catch (err) {
      console.error('[payments] connect account create failed', (err as Error).message);
      return errorResponse('STRIPE_ERROR', 'We couldn’t set up payouts. Please try again.', 502);
    }

    // Recorded BEFORE the link is handed out, and deliberately not-yet-payable.
    // If this write were skipped and the user abandoned the flow, the next call
    // would create a second account for the same person; recording it first
    // means the id is ours to reuse.
    const { error: upsertError } = await admin.rpc('upsert_connected_account', {
      p_profile_id: userId,
      p_stripe_account_id: accountId,
      p_onboarding_complete: false,
      p_payouts_enabled: false,
    });
    if (upsertError) {
      console.error('[payments] connect account record failed', upsertError.message);
      return errorResponse('LEDGER_ERROR', 'We couldn’t set up payouts. Please try again.', 500);
    }
  }

  // Account Links are single-use and expire in minutes, so one is minted per
  // request rather than stored. Never log or persist it: it is a bearer URL
  // into someone's identity documents.
  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: REFRESH_URL,
      return_url: RETURN_URL,
      type: 'account_onboarding',
    });
    console.log('[payments] connect onboarding link issued', { accountId });
    return jsonResponse({ status: 'onboarding_required', url: link.url });
  } catch (err) {
    console.error('[payments] connect account link failed', (err as Error).message);
    return errorResponse('STRIPE_ERROR', 'We couldn’t set up payouts. Please try again.', 502);
  }
});
