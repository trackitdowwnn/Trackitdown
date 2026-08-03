/**
 * WHAT:  Edge Function that deactivates a PAID post and refunds its bounty.
 *        Given { postId } from the authenticated owner, it verifies the caller
 *        OWNS that post and it is in a refund-eligible paid state
 *        (active / pending_verification), finds the HELD escrow charge, computes
 *        the refund as the bounty MINUS the non-recoverable Stripe processing fee
 *        (read authoritatively from the charge's balance transaction), issues a
 *        Stripe refund, and records the money-state transition (payment
 *        held -> refunded, post -> cancelled) via the service-role RPC.
 * WHY:   The refund amount and the state machine must live on the server — the
 *        client never says how much to refund (SECURITY_AND_TRUST §4). Ownership
 *        is proven from the caller's JWT, not a client-supplied id. DOMAIN.md
 *        §lifecycle: cancelling a post refunds the bounty "minus non-recoverable
 *        card processing costs", so the platform withholds the exact Stripe fee.
 *        The Stripe refund uses an idempotency key (`post-refund-<postId>`) so a
 *        retry after a dropped response never issues a SECOND refund; the RPC is
 *        likewise idempotent + never-regress, and the charge.refunded webhook
 *        reconciles the same transition if this request dies after the refund is
 *        issued. Escrow model per ADR-0002: the charge was captured to the
 *        platform balance ('held'); a refund returns it to the owner.
 * LINKS: supabase/functions/_shared/clients.ts, _shared/http.ts;
 *        supabase/functions/create-payment-intent/index.ts (the charge sibling
 *          this mirrors);
 *        supabase/migrations/20260729100000_post_refund_cancel.sql
 *          (mark_post_payment_refunded);
 *        supabase/functions/stripe-webhook/index.ts (charge.refunded confirm);
 *        src/features/payments/api/paymentsApi.ts (the client caller);
 *        docs/decisions/ADR-0002-stripe-connect.md; docs/DOMAIN.md.
 */

import type Stripe from 'npm:stripe@22.4.0';

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

/** The paid states whose escrow can be refunded on deactivation. A draft has no
 *  escrow; a recovered/claimed post's money is already resolved. */
const REFUNDABLE_STATUSES = ['active', 'pending_verification'];

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  // --- Authenticate the caller from the forwarded JWT --------------------------
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

  // --- Parse the request ------------------------------------------------------
  let postId: unknown;
  try {
    ({ postId } = await request.json());
  } catch {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }
  if (typeof postId !== 'string' || postId.length === 0) {
    return errorResponse('BAD_REQUEST', 'Missing post id.', 400);
  }

  // --- Verify ownership + refund-eligible paid state --------------------------
  // Service role bypasses RLS; we re-impose the ownership check here so a signed-in
  // user can only deactivate THEIR OWN post.
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id, status')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    console.error('[payments] post lookup failed', postError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t deactivate your listing. Please try again.', 500);
  }
  if (!post || post.owner_id !== userId) {
    // Don't distinguish "not found" from "not yours" — both are a 404 to the caller.
    return errorResponse('POST_NOT_FOUND', 'We couldn’t find that post.', 404);
  }
  if (!REFUNDABLE_STATUSES.includes(post.status as string)) {
    return errorResponse(
      'POST_NOT_REFUNDABLE',
      'This listing can’t be deactivated for a refund.',
      409,
    );
  }

  // --- Find the HELD escrow charge for this post ------------------------------
  // A paid post must have exactly one held payment. Read the authoritative
  // amount from the ledger (never anything the client sent).
  const { data: held, error: heldError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id, amount_pence')
    .eq('post_id', postId)
    .eq('status', 'held')
    .maybeSingle();

  if (heldError) {
    console.error('[payments] held payment lookup failed', heldError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t deactivate your listing. Please try again.', 500);
  }
  if (!held) {
    // Defensive: an eligible-status post with no held escrow is an anomaly.
    return errorResponse('NO_HELD_PAYMENT', 'We couldn’t find the escrow for this listing.', 409);
  }

  const paymentIntentId = held.stripe_payment_intent_id as string;
  const amountPence = held.amount_pence as number;

  // --- Compute the non-recoverable fee from Stripe (authoritative) ------------
  // Withhold the EXACT processing fee so the platform is made whole (Stripe does
  // not return the % fee on a refund). FAIL CLOSED: read the real fee from the
  // charge's balance transaction and refund `amount - fee`. We deliberately do
  // NOT guess a fee — a guessed amount that later disagrees with a retry (same
  // idempotency key, different amount) would brick the refund at Stripe, and an
  // over-guess would over-refund. For an auto-captured, long-settled escrow the
  // balance transaction is always available; if it isn't yet, the caller retries.
  const stripe = createStripeClient();
  let feePence: number | null = null;
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    });
    const charge = intent.latest_charge as Stripe.Charge | null;
    const balanceTxn = charge?.balance_transaction as Stripe.BalanceTransaction | null;
    if (balanceTxn && typeof balanceTxn.fee === 'number') {
      feePence = balanceTxn.fee;
    }
  } catch (err) {
    console.error('[payments] fee lookup failed', (err as Error).message);
  }
  if (feePence === null) {
    // No authoritative fee → refuse rather than guess. Retryable.
    console.error('[payments] no authoritative fee available', { postId });
    return errorResponse('STRIPE_ERROR', 'We couldn’t deactivate your listing. Please try again.', 502);
  }

  // Guard: the refund must be a positive amount no larger than the bounty.
  const refundPence = amountPence - feePence;
  if (refundPence <= 0 || refundPence > amountPence) {
    console.error('[payments] computed refund out of range', { amountPence, feePence });
    return errorResponse('STRIPE_ERROR', 'We couldn’t deactivate your listing. Please try again.', 500);
  }

  // --- Issue the Stripe refund (idempotent — never a second refund) -----------
  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: refundPence,
        metadata: { post_id: postId },
      },
      // One refund per post cancellation (terminal). The key makes a retry after
      // a dropped response return the SAME refund instead of issuing a new one.
      { idempotencyKey: `post-refund-${postId}` },
    );
  } catch (err) {
    console.error('[payments] refund create failed', (err as Error).message);
    return errorResponse('STRIPE_ERROR', 'We couldn’t deactivate your listing. Please try again.', 502);
  }

  // --- Record the money-state transition (idempotent, server-authoritative) ---
  const { error: rpcError } = await admin.rpc('mark_post_payment_refunded', {
    p_payment_intent_id: paymentIntentId,
    p_refund_id: refund.id,
    p_refunded_amount_pence: refundPence,
  });
  if (rpcError) {
    // The refund succeeded but we couldn't record it. Surface a retryable error;
    // the refund idempotency key means a retry reuses the same refund and the RPC
    // is idempotent — and the charge.refunded webhook reconciles regardless.
    console.error('[payments] mark_post_payment_refunded failed', rpcError.message);
    return errorResponse('LEDGER_ERROR', 'Your refund is processing. Please check back shortly.', 500);
  }

  console.log('[payments] listing deactivated + refunded', { postId, refundPence, feePence });
  return jsonResponse({ refundedPence: refundPence, feePence });
});
