/**
 * WHAT:  Edge Function that deactivates a PAID post. Given { postId } from the
 *        authenticated owner, it verifies the caller OWNS that post and it is in
 *        an eligible paid state (active / pending_verification), then takes one
 *        of two paths depending on how the post was paid for:
 *
 *        BOUNTY POST — finds the HELD escrow charge, computes the refund as the
 *        bounty MINUS the non-recoverable Stripe processing fee (read
 *        authoritatively from the charge's balance transaction), issues a Stripe
 *        refund, and records the money-state transition (payment held ->
 *        refunded, post -> cancelled) via the service-role RPC. Subject to the
 *        owner-denial gate first (ADR-0011).
 *
 *        NO-BOUNTY (FEE) POST — takes the listing down and moves no money
 *        (ADR-0014). The fixed fee is not refundable, there is no escrow, and
 *        therefore no owner-denial gate, no 72-hour hold and no dispute window:
 *        those exist to protect a spotter's claim on a bounty that does not
 *        exist here.
 * WHY:   The refund amount and the state machine must live on the server — the
 *        client never says how much to refund (SECURITY_AND_TRUST §4). Ownership
 *        is proven from the caller's JWT, not a client-supplied id. DOMAIN.md
 *        §lifecycle: cancelling a post refunds the bounty "minus non-recoverable
 *        card processing costs", so the platform withholds the exact Stripe fee.
 *        The refund execution (fee read, guards, refunds.create) lives in
 *        _shared/refundEscrow.ts — one implementation shared with
 *        refund-recovery and the hold sweep; the key `post-refund-<postId>`
 *        stays THIS function's, so a retry after a dropped response never
 *        issues a SECOND refund. The RPC is likewise idempotent + never-regress,
 *        and the charge.refunded webhook reconciles the same transition if this
 *        request dies after the refund is issued. Escrow model per ADR-0002:
 *        the charge was captured to the platform balance ('held'); a refund
 *        returns it to the owner.
 * LINKS: supabase/functions/_shared/refundEscrow.ts (the refund execution);
 *        supabase/functions/_shared/clients.ts, _shared/http.ts;
 *        supabase/functions/create-payment-intent/index.ts (the charge sibling
 *          this mirrors);
 *        supabase/migrations/20260729100000_post_refund_cancel.sql
 *          (mark_post_payment_refunded);
 *        supabase/migrations/20260820110000_no_bounty_listing_fee.sql
 *          (cancel_fee_listing — the no-refund exit);
 *        docs/decisions/ADR-0014-no-bounty-listings.md;
 *        supabase/functions/stripe-webhook/index.ts (charge.refunded confirm);
 *        src/features/payments/api/paymentsApi.ts (the client caller);
 *        docs/decisions/ADR-0002-stripe-connect.md; docs/DOMAIN.md.
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { refundHeldEscrow } from '../_shared/refundEscrow.ts';
import { gateExitRefund } from '../_shared/refundHold.ts';

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
  let attestedSightingIds: unknown;
  try {
    ({ postId, attestedSightingIds } = await request.json());
  } catch {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }
  if (typeof postId !== 'string' || postId.length === 0) {
    return errorResponse('BAD_REQUEST', 'Missing post id.', 400);
  }
  const attested =
    Array.isArray(attestedSightingIds) &&
    attestedSightingIds.every((id) => typeof id === 'string' && id.length > 0)
      ? (attestedSightingIds as string[])
      : null;

  // --- Verify ownership + refund-eligible paid state --------------------------
  // Service role bypasses RLS; we re-impose the ownership check here so a signed-in
  // user can only deactivate THEIR OWN post.
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id, status, bounty_amount_pence')
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

  // --- NO-BOUNTY LISTINGS: take it down, move no money -------------------------
  // A fee-priced post has no escrow, so there is nothing to refund and nothing
  // for a spotter to be denied. That is why this returns BEFORE the owner-denial
  // gate: the 72-hour hold and the dispute window (ADR-0011) exist to protect a
  // spotter's claim on a bounty, and there is no bounty here to claim. Running
  // the gate anyway would delay a takedown by three days to protect nothing.
  //
  // The fee itself is NOT refunded (ADR-0014) — it bought the listing and the
  // listing was delivered. The client discloses this before payment, on the
  // pricing step; nothing here should be the first time an owner learns it.
  if (post.bounty_amount_pence === null) {
    const { error: cancelError } = await admin.rpc('cancel_fee_listing', {
      p_post_id: postId,
    });
    if (cancelError) {
      // POST_HAS_BOUNTY here means the post is fee-PRICED but carries HELD
      // escrow — a stale bounty intent captured against it after a draft
      // pricing switch. Refusing is right (this exit issues no refund), but the
      // owner is now stuck: this branch is chosen on the price columns, so they
      // can never reach the refund path either. Logged distinctly so support can
      // find it, because "Please try again" would loop forever.
      // Should be unreachable for posts created after 20260820110000 — the
      // capture handlers now re-check the amount against the post's price.
      if (cancelError.message?.includes('POST_HAS_BOUNTY')) {
        console.error('[payments] STRANDED ESCROW on a fee-priced post', { postId });
        return errorResponse(
          'ESCROW_NEEDS_REVIEW',
          'Something needs checking on this listing before it can come down. We’re on it — please contact support.',
          409,
        );
      }
      console.error('[payments] cancel_fee_listing failed', cancelError.message);
      return errorResponse(
        'LOOKUP_FAILED',
        'We couldn’t deactivate your listing. Please try again.',
        500,
      );
    }
    console.log('[payments] fee listing deactivated (no refund)', { postId });
    // Same response SHAPE as the refund path so the client needs no new branch:
    // held=false, and a zero refund is the honest number for a non-refundable fee.
    return jsonResponse({ held: false, refundedPence: 0, feePence: 0 });
  }

  // --- THE OWNER-DENIAL GATE, before any Stripe call ---------------------------
  // Recent uncredited sightings mean this refund may be claiming money a
  // spotter earned. The owner must be shown them and attest; the refund then
  // WAITS 72 hours while those spotters are told and may dispute. No recent
  // sightings → the gate answers refund_now and nothing below changes.
  const gate = await gateExitRefund(admin, {
    postId,
    ownerId: userId,
    exitPath: 'deactivate',
    attestedSightingIds: attested,
  });
  if (gate.action === 'attestation_required') {
    // 409 + the ids: the client shows exactly these sightings and asks again.
    return jsonResponse(
      {
        code: 'ATTESTATION_REQUIRED',
        error: 'This listing has recent sightings to look at first.',
        sightingIds: gate.sightingIds,
      },
      409,
    );
  }
  if (gate.action === 'error') {
    return gate.code === 'ATTESTATION_STALE'
      ? errorResponse(
          'ATTESTATION_STALE',
          'A new sighting arrived while you were confirming. Please look again.',
          409,
        )
      : errorResponse('LOOKUP_FAILED', 'We couldn’t deactivate your listing. Please try again.', 500);
  }
  if (gate.action === 'held') {
    // The listing is down (the hold delisted it); only the money waits.
    console.log('[payments] deactivate refund held', { postId, expiresAt: gate.expiresAt });
    return jsonResponse({ held: true, refundAfter: gate.expiresAt });
  }

  // --- Refund the held escrow (the one shared implementation) -----------------
  // Fee read authoritatively, arithmetic guarded, refund idempotent — see
  // _shared/refundEscrow.ts. One refund per post cancellation (terminal): the
  // key makes a retry after a dropped response return the SAME refund.
  const stripe = createStripeClient();
  const outcome = await refundHeldEscrow(admin, stripe, {
    postId,
    idempotencyKey: `post-refund-${postId}`,
  });

  if (outcome.status === 'no_held_payment') {
    // Defensive: an eligible-status post with no held escrow is an anomaly.
    return errorResponse('NO_HELD_PAYMENT', 'We couldn’t find the escrow for this listing.', 409);
  }
  if (outcome.status === 'lookup_failed') {
    return errorResponse('LOOKUP_FAILED', 'We couldn’t deactivate your listing. Please try again.', 500);
  }
  if (outcome.status === 'stripe_error') {
    return errorResponse('STRIPE_ERROR', 'We couldn’t deactivate your listing. Please try again.', 502);
  }
  const { refundId, refundPence, feePence, paymentIntentId } = outcome;

  // --- Record the money-state transition (idempotent, server-authoritative) ---
  const { error: rpcError } = await admin.rpc('mark_post_payment_refunded', {
    p_payment_intent_id: paymentIntentId,
    p_refund_id: refundId,
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
  return jsonResponse({ held: false, refundedPence: refundPence, feePence });
});
