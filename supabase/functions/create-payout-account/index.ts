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
 *        src/features/payments/screens/PayoutSetupScreen.tsx (the /payout-setup
 *          wizard, which replaced PayoutDetailsForm on 2026-10-13: the steps
 *          that mint both tokens).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { findConnectAccount } from '../_shared/connectAccount.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { ensureProfile, PRODUCT_DESCRIPTION } from '../_shared/payoutAccountState.ts';
import { releaseAllPendingFor } from '../_shared/releasePayout.ts';
import { withHandler } from '../_shared/handler.ts';
import { createLog } from '../_shared/log.ts';
import { describeError } from '../_shared/redact.ts';

const log = createLog('create-payout-account');

/**
 * "Paid into account ending 5678" (2026-10-15, PR7): the last four of the
 * bank Stripe just attached, as Stripe reports it. Best effort — the bank is
 * attached either way, and sync-payout-account refreshes it later. Never
 * logs the digits.
 *
 * ⚠️ NEVER THROWS. It runs inside the attach's try, whose catch answers
 * DETAILS_REJECTED — a blip here must not tell someone their bank was refused.
 */
async function recordAttachedBank(
  admin: ReturnType<typeof createServiceRoleClient>,
  accountId: string,
  attached: { last4?: string | null },
): Promise<void> {
  if (!attached.last4) return;
  try {
    const { error } = await admin.rpc('record_bank_last4', {
      p_stripe_account_id: accountId,
      p_last4: attached.last4,
    });
    if (error) {
      log.warn('payments_bank_last4_record_failed', { account_id: accountId });
    }
  } catch {
    log.warn('payments_bank_last4_record_failed', { account_id: accountId });
  }
}

Deno.serve(withHandler(log, async (request) => {
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
    log.error('payments_payout_account_lookup_failed', { error: describeError(err) });
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
      const attached = await stripe.accounts.createExternalAccount(existing.accountId, {
        external_account: bankToken,
        default_for_currency: true,
      });
      log.info('payments_payout_bank_replaced', { account_id: existing.accountId });
      await recordAttachedBank(admin, existing.accountId, attached);
      // So Payouts can tell "a payout failed — add new details" apart from
      // "new details added — resending" (2026-10-14). Best effort: the bank
      // is replaced either way, and that is what Stripe pays to.
      const { error: stampError } = await admin.rpc('record_bank_replaced', {
        p_stripe_account_id: existing.accountId,
      });
      if (stampError) {
        log.warn('payments_bank_replaced_stamp_failed', { error: describeError(stampError) });
      }
      return jsonResponse({ status: 'bank_updated' });
    } catch (err) {
      log.error('payments_payout_bank_replace_failed', { error: describeError(err) });
      return errorResponse(
        'DETAILS_REJECTED',
        'Stripe couldn’t accept that bank account. Please check it and try again.',
        400,
      );
    }
  }

  // --- CREATE: the earn-moment first run --------------------------------------
  if (existing.accountId) {
    // An account already exists and the full setup was sent again. NOT a
    // second account (that would split their history) — but ⚠️ NOT "nothing
    // changed" either (2026-10-13). That answer threw the bank away, and the
    // commonest way here is exactly a first run whose BANK failed after the
    // account was made: the retry's good bank was discarded, the account sat
    // `restricted` on `external_account`, and the spotter was sent to an ID
    // check for a bank account. So the bank is attached, as RE-BANK does, and
    // the platform's website supplied. Identity stays as first given: Stripe
    // treats it as settled once verification has started.
    try {
      const attached = await stripe.accounts.createExternalAccount(existing.accountId, {
        external_account: bankToken,
        default_for_currency: true,
      });
      await recordAttachedBank(admin, existing.accountId, attached);
    } catch (err) {
      log.error('payments_payout_bank_attach_existing_failed', { error: describeError(err) });
      return errorResponse(
        'DETAILS_REJECTED',
        'Stripe couldn’t accept that bank account. Please check it and try again.',
        400,
      );
    }
    await ensureProfile(stripe, existing.accountId);
    log.info('payments_payout_setup_re_run_attached_bank', { account_id: existing.accountId });
    return jsonResponse({ status: 'submitted', payoutsActive: existing.payoutsEnabled });
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
        // Stripe asks EVERY payee account for a website or a description
        // (2026-10-13: it held payouts `restricted` on this alone). A spotter
        // has no website; a description of what they're paid for is the
        // answer, rather than one platform URL Stripe can refuse (2026-10-14).
        profile: { product_description: PRODUCT_DESCRIPTION },
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
    log.error('payments_payout_account_create_failed', { type: failure.type ?? 'unknown' });
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
    log.error('payments_payout_account_record_failed', { error: describeError(recordError) });
    return errorResponse('LEDGER_ERROR', 'We couldn’t save your details. Please try again.', 500);
  }
  // Opens the legacy gate column too, so nothing ever routes this account into
  // the retired prefill flow.
  const { error: gateError } = await admin.rpc('mark_payout_details_submitted', {
    p_profile_id: userId,
    p_stripe_account_id: accountId,
  });
  if (gateError) {
    log.warn('payments_payout_gate_mark_failed', { error: describeError(gateError) });
  }

  // --- The bank ---------------------------------------------------------------
  try {
    const attached = await stripe.accounts.createExternalAccount(accountId, {
      external_account: bankToken,
    });
    await recordAttachedBank(admin, accountId, attached);
  } catch (err) {
    // The account exists and is recorded; only the bank failed. DETAILS_REJECTED
    // sends the form's bank fields back into edit, and the retry lands in the
    // RE-BANK branch above.
    log.error('payments_payout_bank_attach_failed', { error: describeError(err) });
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

  log.info('payments_payout_account_created', {
    account_id: accountId,
    payouts_active: payoutsActive,
  });
  return jsonResponse({ status: 'submitted', payoutsActive });
}));
