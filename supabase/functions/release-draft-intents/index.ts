/**
 * WHAT:  Edge Function that clears the way for a draft's price to change. Given
 *        { postId } from the authenticated owner, it cancels every OPEN
 *        PaymentIntent on that draft AT STRIPE and calls
 *        forget_cancelled_draft_intents with the ids it watched turn `canceled`.
 *        Returns { open } — how many open intents are left (0 = the price can
 *        change; more = a payment is going through).
 * WHY:   update_post_bounty refuses while the draft has an open ledger row
 *        (20261028150000), because only Stripe can tell an abandoned payment
 *        sheet from a payment in flight. Cancelling first means a charge at the
 *        old price can never land on the new one — the refund-and-absorb outcome
 *        mark_post_payment_held otherwise falls back to.
 *        A paid or processing intent cannot be cancelled, stays in the ledger,
 *        and the edit stays refused until the listing goes live.
 * LINKS: supabase/migrations/20261028150000_a_draft_reward_waits_for_its_payment.sql;
 *        supabase/functions/_shared/cancelIntents.ts (the proof);
 *        supabase/functions/delete-draft/index.ts (the sibling this mirrors);
 *        src/features/vehicles/post/api/editSectionApi.ts (saveBounty, the caller).
 */

import { cancelAndProve } from '../_shared/cancelIntents.ts';
import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { withHandler } from '../_shared/handler.ts';
import { createLog } from '../_shared/log.ts';
import { describeError } from '../_shared/redact.ts';

const log = createLog('release-draft-intents');

Deno.serve(withHandler(log, async (request) => {
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

  let postId: unknown;
  try {
    ({ postId } = await request.json());
  } catch {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }
  if (typeof postId !== 'string' || postId.length === 0) {
    return errorResponse('BAD_REQUEST', 'Missing post id.', 400);
  }

  // Ownership for a clean error; the RPC checks again under the post lock.
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id, status')
    .eq('id', postId)
    .maybeSingle();
  if (postError) {
    log.error('drafts_post_lookup_failed', { error: describeError(postError) });
    return errorResponse('LOOKUP_FAILED', 'We couldn’t save your changes. Please try again.', 500);
  }
  if (!post || post.owner_id !== userId) {
    return errorResponse('POST_NOT_FOUND', 'We couldn’t find that draft.', 404);
  }
  if (post.status !== 'draft') {
    return errorResponse('POST_NOT_EDITABLE', 'This listing can no longer be edited.', 409);
  }

  // 'failed' is open too: a retry on the same intent can still succeed.
  const { data: open, error: ledgerError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('post_id', postId)
    .in('status', ['requires_payment', 'failed']);
  if (ledgerError) {
    log.error('drafts_ledger_read_failed', { error: describeError(ledgerError) });
    return errorResponse('LOOKUP_FAILED', 'We couldn’t save your changes. Please try again.', 500);
  }
  const intentIds = (open ?? []).map((row) => row.stripe_payment_intent_id as string);
  if (intentIds.length === 0) {
    return jsonResponse({ open: 0 });
  }

  const cancelled = await cancelAndProve(createStripeClient().paymentIntents, intentIds, 'drafts');

  const { data: forgotten, error: forgetError } = await admin.rpc('forget_cancelled_draft_intents', {
    p_post_id: postId,
    p_owner_id: userId,
    p_cancelled_intent_ids: cancelled,
  });
  if (forgetError) {
    const message = forgetError.message ?? '';
    if (message.includes('NOT_DRAFT')) {
      return errorResponse('POST_NOT_EDITABLE', 'This listing can no longer be edited.', 409);
    }
    if (message.includes('NOT_OWNER')) {
      return errorResponse('POST_NOT_FOUND', 'We couldn’t find that draft.', 404);
    }
    log.error('drafts_forget_cancelled_draft_intents_failed', { message, post_id: postId });
    return errorResponse('RELEASE_FAILED', 'We couldn’t save your changes. Please try again.', 500);
  }

  const left = intentIds.length - ((forgotten as number | null) ?? 0);
  log.info('drafts_draft_intents_released', { post_id: postId, cancelled: cancelled.length, left });
  return jsonResponse({ open: left });
}));
