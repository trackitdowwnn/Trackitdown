/**
 * WHAT:  Creates a spotter's payee account from two CLIENT-MADE tokens — one
 *        carrying their identity, one their bank details — and records it.
 *        The credit-time path: one form, at the earn moment, fully in-app.
 * WHY:   ADR-0010. The previous generation (Express dashboard + Stripe's
 *        onboarding UI + our prefill form) still showed Stripe screens and
 *        still transited bank details through our server. This path shows
 *        nothing of Stripe's in the happy path and touches nothing sensitive:
 *        identity rides a v2 account token minted in the app with the
 *        PUBLISHABLE key, bank details ride a v1 bank token minted by the RN
 *        SDK, and this function sees two opaque ids.
 *
 *        THE SHAPE (verified against GA docs, 2026-08-04 — none of this is the
 *        Global Payouts preview):
 *        - v2 accounts.create with `account_token`, `dashboard: 'none'`,
 *          fees+losses on the application, and the recipient configuration
 *          requesting `stripe_balance.stripe_transfers`. That request also
 *          auto-requests `stripe_balance.payouts` — the capability that means
 *          "money can leave their balance for their bank".
 *        - The bank attaches through the V1 external-accounts endpoint (v2 has
 *          no external_accounts hash; v1 accepts v2 account ids), and payouts
 *          then run on Stripe's default daily schedule. No dashboard needed.
 *        - ToS: the account token carries
 *          `identity.attestations.terms_of_service.account.shown_and_accepted`,
 *          with date/IP inferred by Stripe from the CLIENT call — which is
 *          exactly why acceptance must ride the token, not this request.
 *
 * MONEY/SAFETY: no amount, no account id, no PII in the body — two token ids
 *        and nothing else. Tokens are single-use and expire in ten minutes, so
 *        even a logged body (which we never do) would be a dead credential.
 *        The payable flag is written from Stripe's answer and then owned by
 *        the webhook/reconciliation — a client cannot make itself payable.
 * LINKS: docs/decisions/ADR-0010-whitelabel-payouts.md;
 *        supabase/functions/_shared/connectAccount.ts (find/record);
 *        supabase/functions/connect-onboarding/index.ts (the legacy path,
 *          which keeps serving pre-existing Express-dashboard accounts);
 *        src/features/payments/components/PayoutDetailsForm.tsx (the form
 *          that mints both tokens).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { findConnectAccount } from '../_shared/connectAccount.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { releaseAllPendingFor } from '../_shared/releasePayout.ts';

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

  let accountToken = '';
  let bankToken = '';
  try {
    const body = (await request.json()) as { accountToken?: unknown; bankToken?: unknown };
    accountToken = typeof body.accountToken === 'string' ? body.accountToken.trim() : '';
    bankToken = typeof body.bankToken === 'string' ? body.bankToken.trim() : '';
  } catch {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }

  // Prefix checks, not just presence: a raw account number posted here by a
  // confused client must be rejected loudly, never forwarded anywhere.
  const hasAccountToken = accountToken.startsWith('accttok_');
  const hasBankToken = bankToken.startsWith('btok_');
  if (!hasBankToken || (accountToken !== '' && !hasAccountToken)) {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }

  let existing;
  try {
    existing = await findConnectAccount(admin, userId);
  } catch (err) {
    console.error('[payments] payout account lookup failed', (err as Error).message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t save your details. Please try again.', 500);
  }

  const stripe = createStripeClient();

  // --- RE-BANK: an account exists and only the bank is being replaced --------
  // The "update bank details" and payout-failed re-entry path. Identity is
  // already with Stripe; only the destination changes.
  //
  // MONEY: `default_for_currency: true` is the entire point of the call. A
  // second same-currency bank account does NOT become the payout destination
  // by being added — without the flag, this would report "bank_updated" while
  // every future bounty kept going to the account they were trying to leave.
  if (existing.accountId && !hasAccountToken) {
    try {
      await stripe.accounts.createExternalAccount(existing.accountId, {
        external_account: bankToken,
        default_for_currency: true,
      });
      console.log('[payments] payout bank replaced', { accountId: existing.accountId });
      return jsonResponse({ status: 'bank_updated' });
    } catch (err) {
      console.error('[payments] payout bank replace failed', (err as Error).message);
      return errorResponse(
        'DETAILS_REJECTED',
        'Stripe couldn’t accept that bank account. Please check it and try again.',
        400,
      );
    }
  }

  // --- CREATE: the earn-moment first run --------------------------------------
  if (existing.accountId) {
    // An account already exists and an identity token was sent anyway. Stripe
    // treats identity as immutable-ish post-verification; the honest answer is
    // "you're set up" rather than a second account splitting their history.
    return jsonResponse({ status: 'already_exists' });
  }
  if (!hasAccountToken) {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }

  let accountId: string;
  let payoutsActive = false;
  try {
    const account = await stripe.v2.core.accounts.create({
      account_token: accountToken,
      identity: { country: 'gb' },
      // No dashboard: WE are the requirements collector (with losses on the
      // application, below, that is what derives requirements_collector:
      // application). This is the whole point — no Stripe UI in the happy path.
      dashboard: 'none',
      defaults: {
        currency: 'gbp',
        responsibilities: {
          fees_collector: 'application',
          losses_collector: 'application',
        },
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
      // The link back for webhooks/reconciliation — same contract as the
      // legacy path: an account without profile_id metadata can never be
      // matched to its spotter, and the webhook refuses to guess.
      metadata: { profile_id: userId },
      include: ['configuration.recipient', 'requirements'],
    });
    accountId = account.id;

    const capabilities = account.configuration?.recipient?.capabilities;
    payoutsActive = capabilities?.stripe_balance?.payouts?.status === 'active';
  } catch (err) {
    // Stripe's message can quote rejected identity values — log the type only.
    const failure = err as { type?: string };
    console.error('[payments] payout account create failed', { type: failure.type ?? 'unknown' });
    return errorResponse(
      'DETAILS_REJECTED',
      'Stripe couldn’t accept those details. Please check them and try again.',
      400,
    );
  }

  // Recorded BEFORE the bank attach, same reasoning as the legacy creator: a
  // death between the two calls must leave an id to reuse, not an orphan.
  // onboarding_complete = true is honest here — our form IS the onboarding,
  // and it just ran to completion. Payable stays whatever Stripe said.
  const { error: recordError } = await admin.rpc('upsert_connected_account', {
    p_profile_id: userId,
    p_stripe_account_id: accountId,
    p_onboarding_complete: true,
    p_payouts_enabled: payoutsActive,
  });
  if (recordError) {
    console.error('[payments] payout account record failed', recordError.message);
    return errorResponse('LEDGER_ERROR', 'We couldn’t save your details. Please try again.', 500);
  }
  // Opens the legacy gate column too, so nothing ever routes this account into
  // the retired prefill flow.
  const { error: gateError } = await admin.rpc('mark_payout_details_submitted', {
    p_profile_id: userId,
    p_stripe_account_id: accountId,
  });
  if (gateError) {
    console.warn('[payments] payout gate mark failed', gateError.message);
  }

  // --- The bank ---------------------------------------------------------------
  try {
    await stripe.accounts.createExternalAccount(accountId, {
      external_account: bankToken,
    });
  } catch (err) {
    // The account exists and is recorded; only the bank failed. DETAILS_REJECTED
    // sends the form's bank fields back into edit, and the retry lands in the
    // RE-BANK branch above.
    console.error('[payments] payout bank attach failed', (err as Error).message);
    return errorResponse(
      'DETAILS_REJECTED',
      'Stripe couldn’t accept that bank account. Please check it and try again.',
      400,
    );
  }

  // AUTO-RELEASE, INSTANTLY: Stripe often activates a clean GB individual on
  // the spot, and the person on this screen is very likely here because a
  // bounty is waiting. If they are payable RIGHT NOW, pay them right now — the
  // collusion gate runs inside the core, and the no-op/idempotency guarantees
  // make this safe to fire blindly. Never throws.
  if (payoutsActive) {
    await releaseAllPendingFor(admin, stripe, userId);
  }

  console.log('[payments] payout account created', { accountId, payoutsActive });
  return jsonResponse({ status: 'submitted', payoutsActive });
});
