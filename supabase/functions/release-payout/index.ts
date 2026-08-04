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

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { releasePayoutForPost } from '../_shared/releasePayout.ts';

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

  // --- The core does the money; this function only proved the caller owns it.
  // Extracted 2026-08-04 (_shared/releasePayout.ts) so the webhook's automatic
  // release and this manual retry can never drift apart.
  const stripe = createStripeClient();
  const outcome = await releasePayoutForPost(admin, stripe, postId);

  switch (outcome.status) {
    case 'paid':
      return jsonResponse({
        status: 'paid',
        transferPence: outcome.transferPence,
        feePence: outcome.feePence,
      });
    case 'awaiting_payee':
      return jsonResponse({ status: 'awaiting_payee' });
    case 'held_for_review':
      // Not an error: the claim stands, the money is safe, and a human (us)
      // decides. The reasons NEVER leave the server — telling a fraudster
      // which signal caught them is a tutorial.
      return jsonResponse({ status: 'held_for_review' });
    case 'not_claimed':
      return errorResponse('POST_NOT_CLAIMED', 'This listing isn’t waiting on a payout.', 409);
    case 'error':
      switch (outcome.code) {
        case 'NO_CREDITED_SIGHTING':
          return errorResponse(
            'NO_CREDITED_SIGHTING',
            'No spotter was credited for this recovery.',
            409,
          );
        case 'NO_HELD_PAYMENT':
          return errorResponse(
            'NO_HELD_PAYMENT',
            'We couldn’t find the bounty for this listing.',
            409,
          );
        case 'STRIPE_ERROR':
          return errorResponse('STRIPE_ERROR', 'We couldn’t send the bounty. Please try again.', 502);
        case 'LEDGER_ERROR':
          return errorResponse(
            'LEDGER_ERROR',
            'The bounty is on its way. Please check back shortly.',
            500,
          );
        default:
          return errorResponse('LOOKUP_FAILED', 'We couldn’t finish this. Please try again.', 500);
      }
  }
});
