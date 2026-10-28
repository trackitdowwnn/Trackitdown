/**
 * WHAT:  sync-post-payment — asks Stripe whether the CALLER's post's payment
 *        has gone through, and if it has, records it exactly as the
 *        payment_intent.succeeded webhook would: mark_post_payment_held, then
 *        the same follow-ups (spotters alerted, a replaced reward refunded,
 *        the owner told it is live).
 * WHY:   2026-10-14 (payments plan, PR6). A listing went live ONLY when the
 *        webhook arrived. When it was slow — or the endpoint misconfigured —
 *        the card was charged and the listing sat in draft while the
 *        confirmation screen said "goes live by itself". The payout side
 *        already asks Stripe instead of only waiting (sync-payout-account);
 *        this is the same for the side that pays.
 *
 *        NOTHING THE WEBHOOK WOULDN'T DO. The caller names a post and nothing
 *        else; the server proves they own it, reads ONLY the intents already
 *        recorded for it, and believes Stripe's status — never the app's. An
 *        intent Stripe says succeeded is recorded through the same idempotent,
 *        never-regress function the webhook calls, so the webhook arriving
 *        later (or first) changes nothing.
 * LINKS: ../_shared/afterCapture.ts; ../stripe-webhook/index.ts
 *          (payment_intent.succeeded — the push version);
 *        src/features/vehicles/post/api/postApi.ts (syncPostPayment);
 *        supabase/migrations/20261014120000 (the live push's claim).
 */

import { followUpCapture } from '../_shared/afterCapture.ts';
import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { withHandler } from '../_shared/handler.ts';
import { createLog } from '../_shared/log.ts';
import { describeError } from '../_shared/redact.ts';

const log = createLog('sync-post-payment');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most this many waiting intents are checked per call (an edit can leave a few). */
const MAX_INTENTS = 3;

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

  let postId = '';
  try {
    const body = (await request.json()) as { postId?: unknown };
    postId = typeof body.postId === 'string' ? body.postId.trim() : '';
  } catch {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }
  if (!UUID.test(postId)) {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }

  // Theirs, or nothing: someone else's post and no post read the same.
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id')
    .eq('id', postId)
    .maybeSingle();
  if (postError) {
    log.error('payments_post_payment_sync_lookup_failed', { error: describeError(postError) });
    return errorResponse('LOOKUP_FAILED', 'We couldn’t check your payment. Please try again.', 500);
  }
  if (!post || post.owner_id !== userId) {
    return errorResponse('NOT_FOUND', 'We couldn’t find that listing.', 404);
  }

  // The intents recorded for this post that are still waiting on Stripe.
  const { data: waiting, error: waitingError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('post_id', postId)
    .eq('status', 'requires_payment')
    .order('created_at', { ascending: false })
    .limit(MAX_INTENTS);
  if (waitingError) {
    log.error('payments_post_payment_sync_lookup_failed', { error: describeError(waitingError) });
    return errorResponse('LOOKUP_FAILED', 'We couldn’t check your payment. Please try again.', 500);
  }

  const stripe = createStripeClient();
  let captured = 0;
  for (const row of waiting ?? []) {
    const intentId = row.stripe_payment_intent_id as string;
    let status: string;
    try {
      status = (await stripe.paymentIntents.retrieve(intentId)).status;
    } catch (err) {
      // A blip: the screen keeps looking, and the webhook is still coming.
      log.warn('payments_post_payment_sync_read_failed', { type: (err as { type?: string }).type });
      continue;
    }
    if (status !== 'succeeded') continue;

    const { error } = await admin.rpc('mark_post_payment_held', { p_payment_intent_id: intentId });
    if (error) {
      log.error('payments_post_payment_sync_record_failed', { error: describeError(error) });
      return errorResponse('LEDGER_ERROR', 'We couldn’t check your payment. Please try again.', 500);
    }
    log.info('payments_charge_captured_sync', { payment_intent_id: intentId });
    captured += 1;
    await followUpCapture(admin, stripe, intentId);
  }

  return jsonResponse({ status: captured > 0 ? 'captured' : 'unchanged' });
}));
