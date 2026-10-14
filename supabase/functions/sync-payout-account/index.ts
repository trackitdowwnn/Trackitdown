/**
 * WHAT:  sync-payout-account — asks Stripe for the CALLER's payee account
 *        state and records it; if they have just become payable, sends any
 *        reward they're already owed.
 * WHY:   2026-10-13: "Your details are being checked" never moved for an
 *        account Stripe had already finished with, because the only writer of
 *        payouts_enabled was the account.updated webhook and it didn't arrive.
 *        The Payouts screen now calls this whenever it opens on a not-yet-ready
 *        account, so a missed webhook costs nothing.
 *
 *        ⚠️ READ-ONLY AT STRIPE. Unlike connect-onboarding's reconcile, this
 *        can never mint an Account Session or a link: minting one as a side
 *        effect of opening a screen is exactly the "warm it up" ping
 *        payments/README.md warns closes the prefill window for good. It reads
 *        the account and nothing else.
 *
 *        The caller's own account only (their JWT), recorded through
 *        upsert_connected_account — which never undoes a recorded "details
 *        submitted" (20261013130000). The release is the same idempotent,
 *        collusion-gated core the webhook calls.
 * LINKS: ../_shared/payoutAccountState.ts (the read);
 *        ../_shared/applyPayoutAccountState.ts (record + release, shared with
 *          the webhook's v2 account events);
 *        ../stripe-webhook/index.ts (account.updated, the push version);
 *        src/features/payments/api/payoutsApi.ts (syncMyPayoutAccount).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { findConnectAccount } from '../_shared/connectAccount.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { applyPayoutAccountState } from '../_shared/applyPayoutAccountState.ts';
import { ensureProfile, readPayoutAccountState } from '../_shared/payoutAccountState.ts';
import { releaseAllPendingFor } from '../_shared/releasePayout.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  const jwt = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }
  const admin = createServiceRoleClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }
  const userId = userData.user.id;

  let existing;
  try {
    existing = await findConnectAccount(admin, userId);
  } catch (err) {
    console.error('[payments] payout sync lookup failed', (err as Error).message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t check your payouts. Please try again.', 500);
  }
  if (!existing.accountId) {
    return jsonResponse({ status: 'none' });
  }

  const stripe = createStripeClient();
  const fresh = await readPayoutAccountState(stripe, existing.accountId);
  if (!fresh) {
    // Stripe unreadable: the row stands, and the screen says what it said.
    console.warn('[payments] payout sync read failed', { accountId: existing.accountId });
    return jsonResponse({
      status: 'unchanged',
      payoutsEnabled: existing.payoutsEnabled,
      needsBank: false,
      needsAction: false,
    });
  }

  // Record it, and if they have just become payable, pay what they're owed —
  // the same step the webhook's v2 account events take (one definition).
  const applied = await applyPayoutAccountState(
    admin,
    {
      profileId: userId,
      accountId: existing.accountId,
      onboardingComplete: existing.onboardingComplete,
      payoutsEnabled: existing.payoutsEnabled,
    },
    fresh,
    (profileId) => releaseAllPendingFor(admin, stripe, profileId),
  );
  if (!applied.ok) {
    console.error('[payments] payout sync write failed', applied.error);
    return errorResponse('LEDGER_ERROR', 'We couldn’t check your payouts. Please try again.', 500);
  }

  // Stripe's routine "website or description" requirement is the platform's to
  // answer, never the spotter's (accounts made before create-payout-account
  // sent it). Set here, quietly; Stripe re-evaluates and the next check sees
  // the result.
  if (fresh.needsProfile) {
    const set = await ensureProfile(stripe, existing.accountId);
    console.log('[payments] payout account description supplied', { accountId: existing.accountId, set });
  }

  // `needsBank`: no bank attached — the app asks for one in its own form
  // rather than sending the spotter to Stripe's screen for it.
  // `needsAction` (2026-10-14): Stripe is waiting on THEM for something only
  // its own screen collects (a photo ID) — the app says so instead of "being
  // checked". Additive: an app that predates it ignores the field.
  return jsonResponse({
    status: 'synced',
    payoutsEnabled: fresh.payoutsEnabled,
    needsBank: fresh.needsBank,
    needsAction: fresh.needsAction,
  });
});
