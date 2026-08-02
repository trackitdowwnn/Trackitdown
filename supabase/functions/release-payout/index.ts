/**
 * WHAT:  Edge Function that pays the credited spotter: transfers 95% of the
 *        bounty to their Connect account and closes the post as `recovered`.
 *        The last step of the core loop.
 * WHY:   `claim_recovery` decides WHO won but moves nothing;
 *        `recovered` means ALREADY PAID (DOMAIN.md lifecycle 5), so only a
 *        server that has seen Stripe succeed may set it.
 *
 *        ADR-0002: separate charges and transfers. The bounty has sat on the
 *        platform balance since capture; this transfers `round(bounty × 0.95)`
 *        to the spotter and the 5% remainder simply stays. NOT
 *        `application_fee_amount` — that only exists for destination charges.
 *
 * THE PAYEE IS OFTEN NOT READY, AND THAT IS NORMAL, NOT AN ERROR.
 *        A spotter has no Stripe account until they make one, and DOMAIN says
 *        to ask for it when their first sighting is credited — which is this
 *        moment, not before. So the common path on a first recovery is
 *        `PAYEE_NOT_READY`: we leave the post in `recovery_claimed`, the bounty
 *        stays safely in escrow, and the payout runs again once they have
 *        onboarded. Treating that as a failure would be wrong; the claim
 *        succeeded, only the transfer is waiting.
 *
 * MONEY: every amount is derived server-side from the ledger. The client sends
 *        a post id and nothing else. `mark_recovery_paid` independently
 *        re-derives the 95/5 split and REJECTS a mismatch, so the numbers below
 *        are checked by something that did not compute them.
 *
 *        The transfer carries an idempotency key per post, so a retry after a
 *        dropped response returns the SAME transfer instead of paying twice.
 *        That is the single most important line in this file.
 * LINKS: supabase/migrations/20260802220000_release_payout.sql (payout_split +
 *          mark_recovery_paid, and why the split is checked twice);
 *        supabase/functions/refund-recovery/index.ts (the other ending);
 *        docs/decisions/ADR-0002-stripe-connect.md; docs/DOMAIN.md.
 */

import type Stripe from 'npm:stripe@17.5.0';

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

/**
 * The canonical split, mirroring `payout_split` in SQL. Integer arithmetic —
 * `* 95 / 100`, never `* 0.95` — and the fee is the REMAINDER so the two halves
 * always add back to the bounty exactly.
 *
 * This duplication is deliberate and is not drift waiting to happen: we need
 * the number here to create the transfer, and the RPC recomputes it and refuses
 * anything else. Two independent derivations that must agree.
 */
function splitBounty(bountyPence: number): { transferPence: number; feePence: number } {
  const transferPence = Math.round((bountyPence * 95) / 100);
  return { transferPence, feePence: bountyPence - transferPence };
}

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

  let postId: unknown;
  try {
    ({ postId } = await request.json());
  } catch {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }
  if (typeof postId !== 'string' || postId.length === 0) {
    return errorResponse('BAD_REQUEST', 'Missing post id.', 400);
  }

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
    return errorResponse('POST_NOT_FOUND', 'We couldn’t find that post.', 404);
  }
  if (post.status !== 'recovery_claimed') {
    return errorResponse('POST_NOT_CLAIMED', 'This listing isn’t waiting on a payout.', 409);
  }

  // --- Who won ----------------------------------------------------------------
  const { data: credited, error: creditedError } = await admin
    .from('sightings')
    .select('id, spotter_id')
    .eq('post_id', postId)
    .eq('status', 'credited')
    .maybeSingle();

  if (creditedError) {
    console.error('[payments] credited sighting lookup failed', creditedError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t finish this. Please try again.', 500);
  }
  if (!credited) {
    // No winner — this recovery's ending is a refund, not a payout.
    return errorResponse(
      'NO_CREDITED_SIGHTING',
      'No spotter was credited for this recovery.',
      409,
    );
  }

  // --- Can they actually receive it? ------------------------------------------
  const { data: connect } = await admin
    .from('stripe_connected_accounts')
    .select('id, stripe_account_id, payouts_enabled')
    .eq('profile_id', credited.spotter_id)
    .maybeSingle();

  if (!connect || !connect.payouts_enabled) {
    // NOT an error state. The bounty stays in escrow and the post stays
    // `recovery_claimed` until they have onboarded; this runs again then.
    console.log('[payments] payout waiting on payee onboarding', { postId });
    return jsonResponse({ status: 'awaiting_payee' });
  }

  // --- The held escrow --------------------------------------------------------
  const { data: held, error: heldError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id, amount_pence')
    .eq('post_id', postId)
    .eq('status', 'held')
    .maybeSingle();

  if (heldError) {
    console.error('[payments] held payment lookup failed', heldError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t finish this. Please try again.', 500);
  }
  if (!held) {
    return errorResponse('NO_HELD_PAYMENT', 'We couldn’t find the bounty for this listing.', 409);
  }

  const paymentIntentId = held.stripe_payment_intent_id as string;
  const bountyPence = held.amount_pence as number;
  const { transferPence, feePence } = splitBounty(bountyPence);

  // Defensive: a transfer must be a positive amount no larger than the bounty.
  if (transferPence <= 0 || transferPence > bountyPence) {
    console.error('[payments] computed transfer out of range', { bountyPence, transferPence });
    return errorResponse('SPLIT_ERROR', 'We couldn’t finish this. Please try again.', 500);
  }

  // --- Transfer (idempotent — never a second payout) --------------------------
  let transfer: Stripe.Transfer;
  const stripe = createStripeClient();
  try {
    transfer = await stripe.transfers.create(
      {
        amount: transferPence,
        currency: 'gbp',
        destination: connect.stripe_account_id as string,
        // No `source_transaction`: that ties a transfer to one charge's funds
        // and waits for them to settle. Under separate charges and transfers
        // (ADR-0002) the bounty is already on the platform balance, and the
        // dispute-reversal protection comes from the connected account's
        // `losses_collector: "application"`, not from linking the charge.
        transfer_group: postId,
        metadata: { post_id: postId, sighting_id: credited.id },
      },
      // ONE payout per post, forever. A retry after a dropped response returns
      // the same transfer rather than paying the spotter twice.
      { idempotencyKey: `post-payout-${postId}` },
    );
  } catch (err) {
    console.error('[payments] transfer create failed', (err as Error).message);
    return errorResponse('STRIPE_ERROR', 'We couldn’t send the bounty. Please try again.', 502);
  }

  // --- Record it (idempotent, never-regress, split re-checked) -----------------
  const { error: rpcError } = await admin.rpc('mark_recovery_paid', {
    p_payment_intent_id: paymentIntentId,
    p_transfer_id: transfer.id,
    p_payee_account_id: connect.id,
    p_transfer_amount_pence: transferPence,
    p_platform_fee_pence: feePence,
  });
  if (rpcError) {
    // The transfer SUCCEEDED but we couldn't record it. Retryable: the
    // idempotency key reuses the same transfer and the RPC never regresses.
    console.error('[payments] mark_recovery_paid failed', rpcError.message);
    return errorResponse('LEDGER_ERROR', 'The bounty is on its way. Please check back shortly.', 500);
  }

  console.log('[payments] bounty released', { postId, transferPence, feePence });
  return jsonResponse({ status: 'paid', transferPence, feePence });
});
