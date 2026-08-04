/**
 * WHAT:  Edge Function that resolves a `recovery_claimed` post where the owner
 *        credited NOBODY: refunds the escrowed bounty (minus the
 *        non-recoverable Stripe fee) and advances the post to the terminal
 *        `recovered_no_spotter`.
 * WHY:   `claim_recovery` stops at `recovery_claimed` on purpose —
 *        `recovered_no_spotter` means ALREADY REFUNDED (DOMAIN.md lifecycle 6)
 *        and SQL cannot know whether Stripe succeeded. This is the half that
 *        knows. It is the "I found it myself" ending, which is likely the
 *        common one early on, and until it existed a claimed recovery had no
 *        way to finish at all.
 *
 *        Near-identical to `deactivate-post`, and deliberately a SEPARATE
 *        function rather than a flag on it. They differ in the two things that
 *        matter: the state they accept (`recovery_claimed` vs the live paid
 *        states) and the state they produce (`recovered_no_spotter` vs
 *        `cancelled`). Merging them would put a branch on the money path whose
 *        wrong side silently cancels a recovered post — losing the distinction
 *        the 30-day "recently recovered" window and the owner's history both
 *        rest on.
 *
 * MONEY: the client never says how much to refund. The bounty is read from the
 *        ledger and the withheld fee from Stripe's own balance transaction, so
 *        the platform is made whole for costs Stripe does not return on a
 *        refund (DOMAIN.md: "minus non-recoverable card processing costs").
 *        FAIL CLOSED if that fee cannot be read — a guessed amount that later
 *        disagrees with a retry under the same idempotency key bricks the
 *        refund at Stripe, and an over-guess over-refunds.
 *
 *        The idempotency key is per POST and distinct from deactivate-post's
 *        (`recovery-refund-` vs `post-refund-`): the same post could in
 *        principle be cancelled and then recovered, and reusing one key would
 *        make Stripe return the FIRST refund for the second request.
 *
 * SAFETY: refuses a post with a credited sighting — that money is a spotter's.
 *         Checked here AND again inside mark_post_recovered_no_spotter, because
 *         this check happens before the refund and the DB one after it.
 * LINKS: supabase/functions/_shared/refundEscrow.ts (the refund execution);
 *        supabase/functions/deactivate-post/index.ts (the sibling this mirrors);
 *        supabase/migrations/20260802210000_mark_recovered_no_spotter.sql;
 *        supabase/migrations/20260802200000_claim_recovery.sql;
 *        docs/DOMAIN.md (lifecycle 6, bounty rules); docs/decisions/ADR-0002.
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { refundHeldEscrow } from '../_shared/refundEscrow.ts';
import { gateExitRefund } from '../_shared/refundHold.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  // --- Authenticate the caller from the forwarded JWT -------------------------
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

  // --- Ownership + the one acceptable state -----------------------------------
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id, status')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    console.error('[payments] post lookup failed', postError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t finish this. Please try again.', 500);
  }
  if (!post || post.owner_id !== userId) {
    // "Not found" and "not yours" are the same answer to the caller.
    return errorResponse('POST_NOT_FOUND', 'We couldn’t find that post.', 404);
  }
  if (post.status !== 'recovery_claimed') {
    return errorResponse(
      'POST_NOT_CLAIMED',
      'This listing isn’t waiting on a recovery.',
      409,
    );
  }

  // --- SAFETY: a credited sighting means this money is a spotter's ------------
  const { count: creditedCount, error: creditedError } = await admin
    .from('sightings')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId)
    .eq('status', 'credited');

  if (creditedError) {
    console.error('[payments] credited-sighting check failed', creditedError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t finish this. Please try again.', 500);
  }
  if ((creditedCount ?? 0) > 0) {
    // Not a refund at all — this post is owed a payout.
    return errorResponse(
      'RECOVERY_HAS_CREDITED_SIGHTING',
      'You credited a spotter for this recovery, so the bounty goes to them.',
      409,
    );
  }

  // --- THE OWNER-DENIAL GATE, before any Stripe call ---------------------------
  // "I found it another way" with recent uncredited sightings is exactly the
  // exit an owner denying a spotter would take. Attestation + a 72-hour hold
  // while those spotters are told; no recent sightings → refund now, as ever.
  const gate = await gateExitRefund(admin, {
    postId,
    ownerId: userId,
    exitPath: 'recovery',
    attestedSightingIds: attested,
  });
  if (gate.action === 'attestation_required') {
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
      : errorResponse('LOOKUP_FAILED', 'We couldn’t finish this. Please try again.', 500);
  }
  if (gate.action === 'held') {
    console.log('[payments] recovery refund held', { postId, expiresAt: gate.expiresAt });
    return jsonResponse({ held: true, refundAfter: gate.expiresAt });
  }

  // --- Refund the held escrow (the one shared implementation) -----------------
  // Fee read authoritatively, arithmetic guarded, refund idempotent — see
  // _shared/refundEscrow.ts. Key distinct from deactivate-post's
  // `post-refund-<id>`: one post could be cancelled and then recovered, and a
  // shared key would return the FIRST refund for the second request.
  const stripe = createStripeClient();
  const outcome = await refundHeldEscrow(admin, stripe, {
    postId,
    idempotencyKey: `recovery-refund-${postId}`,
    metadata: { reason: 'recovered_no_spotter' },
  });

  if (outcome.status === 'no_held_payment') {
    return errorResponse('NO_HELD_PAYMENT', 'We couldn’t find the escrow for this listing.', 409);
  }
  if (outcome.status === 'lookup_failed') {
    return errorResponse('LOOKUP_FAILED', 'We couldn’t finish this. Please try again.', 500);
  }
  if (outcome.status === 'stripe_error') {
    return errorResponse('STRIPE_ERROR', 'We couldn’t finish this. Please try again.', 502);
  }
  const { refundId, refundPence, feePence, paymentIntentId } = outcome;

  // --- Record it (idempotent, never-regress) ----------------------------------
  const { error: rpcError } = await admin.rpc('mark_post_recovered_no_spotter', {
    p_payment_intent_id: paymentIntentId,
    p_refund_id: refundId,
    p_refunded_amount_pence: refundPence,
  });
  if (rpcError) {
    // The refund SUCCEEDED but we couldn't record it. Retryable: the
    // idempotency key reuses the same refund and the RPC never regresses.
    console.error('[payments] mark_post_recovered_no_spotter failed', rpcError.message);
    return errorResponse('LEDGER_ERROR', 'Your refund is processing. Please check back shortly.', 500);
  }

  console.log('[payments] recovery closed with no spotter', { postId, refundPence, feePence });
  return jsonResponse({ held: false, refundedPence: refundPence, feePence });
});
