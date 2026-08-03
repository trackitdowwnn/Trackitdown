/**
 * WHAT:  Edge Function that gives a spotter somewhere for their bounty to land:
 *        creates their Stripe Express account if they have none, then returns
 *        the credential for whichever flow fits — an **Account Session** for
 *        the embedded, in-app onboarding component if they are still setting
 *        up, or a hosted `account_update` link if they are already payable and
 *        want to change where the money goes.
 *
 *        TWO SHAPES, AND THE SERVER PICKS. The client sends no body at all, so
 *        which flow to run is decided here from the account's own state — it is
 *        never asked for. Callers get `{ status, clientSecret }` or
 *        `{ status, url }` and branch on the status.
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

import { createServiceRoleClient, createStripeClient, requireEnv } from '../_shared/clients.ts';
import { createConnectAccount, findConnectAccount } from '../_shared/connectAccount.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

/**
 * Where Stripe sends the spotter afterwards.
 *
 * THESE MUST BE HTTPS. Account Links accept http/https only; a custom scheme is
 * rejected with a flat "Not a valid URL", which is exactly what happened when
 * these were `trackitdown://payouts?…` on 2026-08-03 — the account was created
 * and only the LINK failed, so the error looked like a Stripe configuration
 * problem when it was ours. The `connect-return` function is the bounce: an
 * HTTPS page that immediately forwards to the app's scheme.
 *
 * `refresh_url` is not an error path — Stripe uses it when a link has expired
 * (they are short-lived by design), and the app answers by asking for a new
 * one. Sending them to a dead end there would strand someone mid-KYC.
 */
const RETURN_BASE = `${requireEnv('SUPABASE_URL')}/functions/v1/connect-return`;
const RETURN_URL = `${RETURN_BASE}?onboarding=complete`;
const REFRESH_URL = `${RETURN_BASE}?onboarding=refresh`;

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
  let existing;
  try {
    existing = await findConnectAccount(admin, userId);
  } catch (err) {
    console.error('[payments] connect account lookup failed', (err as Error).message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t start this. Please try again.', 500);
  }

  const stripe = createStripeClient();
  let accountId = existing.accountId ?? undefined;

  // ALREADY PAYABLE. Not "nothing to do" — people change banks, move house, and
  // have documents expire, and until 2026-08-03 this returned a bare
  // `already_enabled` with no link, which left a set-up spotter with no route
  // to their own details at all. `account_update` is Stripe's own answer: the
  // same hosted flow, opened for editing rather than for signing up.
  if (existing.payoutsEnabled && accountId) {
    try {
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: REFRESH_URL,
        return_url: RETURN_URL,
        type: 'account_update',
      });
      console.log('[payments] connect update link issued', { accountId });
      return jsonResponse({ status: 'update_available', url: link.url });
    } catch (err) {
      // Falling back to the old answer keeps a working payout account working:
      // failing here would make "manage my details" look like "payouts broke".
      console.error('[payments] connect update link failed', (err as Error).message);
      return jsonResponse({ status: 'already_enabled' });
    }
  }

  // THE GATE. Stripe lets us submit bank details and identity fields ourselves
  // — but only until the first session exists, and then never again for the
  // life of the account. So a session is NOT minted until our own form has run:
  // doing it first is what made a native form impossible, silently, on the very
  // first tap.
  //
  // Answered before the account is even created, so a spotter who has typed
  // nothing yet also cannot have the window closed on them by a stray call.
  if (!existing.detailsSubmitted) {
    return jsonResponse({ status: 'details_required' });
  }

  if (!accountId) {
    // Only reachable if the details were recorded without an account, which
    // `submit-payout-details` makes impossible — kept because "impossible"
    // states are exactly the ones that cost you an afternoon later.
    try {
      accountId = await createConnectAccount(stripe, admin, userId);
    } catch (err) {
      console.error('[payments] connect account create failed', (err as Error).message);
      return errorResponse('STRIPE_ERROR', 'We couldn’t set up payouts. Please try again.', 502);
    }
  }

  // SETUP HAPPENS INSIDE THE APP. An Account Session is the credential for
  // Stripe's embedded `ConnectAccountOnboarding` component, which renders in
  // the app rather than throwing the spotter out to a browser — the single
  // clunkiest moment in the product, at the exact point someone is deciding
  // whether to trust us with their bank details.
  //
  // WHY NOT JUST WEBVIEW THE HOSTED FLOW: because Stripe forbids it, in as many
  // words — "Stripe-hosted onboarding is only supported in web browsers. You
  // can't use it in embedded web views inside mobile or desktop applications."
  // The embedded component is the supported route, not a workaround for it.
  //
  // Sessions are short-lived and single-account, so one is minted per request
  // and never stored. The client re-invokes this function when the SDK asks for
  // a fresh secret, which is why nothing above this point has side effects on a
  // repeat call.
  try {
    const session = await stripe.accountSessions.create({
      account: accountId,
      components: { account_onboarding: { enabled: true } },
    });
    console.log('[payments] connect onboarding session issued', { accountId });
    return jsonResponse({ status: 'onboarding_session', clientSecret: session.client_secret });
  } catch (err) {
    // The hosted link still works and is still deployed, so a session failure
    // is recoverable rather than terminal: fall back to the browser flow that
    // shipped first. Worse UX, but a spotter who can be paid beats a dead end.
    console.error('[payments] connect account session failed', (err as Error).message);
    try {
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: REFRESH_URL,
        return_url: RETURN_URL,
        type: 'account_onboarding',
      });
      console.log('[payments] connect onboarding link issued (session fallback)', { accountId });
      return jsonResponse({ status: 'onboarding_required', url: link.url });
    } catch (linkErr) {
      console.error('[payments] connect account link failed', (linkErr as Error).message);
      return errorResponse('STRIPE_ERROR', 'We couldn’t set up payouts. Please try again.', 502);
    }
  }
});
