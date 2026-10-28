/**
 * WHAT:  Edge Function that DELETES an owner's own CANCELLED listing. Given
 *        { postId } from the authenticated owner, it verifies the caller owns
 *        that post and it is cancelled, CANCELS ANY STRAY UNCAPTURED
 *        PaymentIntent AT STRIPE, and then calls delete_cancelled_post with
 *        the intent ids it watched turn `canceled` — which detaches the
 *        settled ledger rows, proof-deletes the stray ones, and hard-deletes
 *        the post.
 * WHY:   Cancelling a listing left it in My Posts for ever: `cancelled` had no
 *        owner action at all. Now the owner can remove it on request (the app
 *        offers this right after a cancel, and from Manage post any time
 *        after), and retention removes what they leave behind at 30 days
 *        (purge_cancelled_posts, in the hourly sweep).
 *
 * ⚠️ THE ORDER IS THE SAFETY PROPERTY — the same one as delete-draft. A
 *        cancelled post's REAL payment is settled (bounty refunded, or fee
 *        collected), but the schema allows more than one ledger row per post:
 *        a bounty edited before paying leaves a superseded intent's row in
 *        'failed', and 20260816110000's argument stands — a 'failed' row
 *        routinely points at an intent nobody cancelled, still confirmable by
 *        anyone holding its client secret. So those are cancelled AT STRIPE
 *        first, and the RPC — inside the same transaction as its row lock —
 *        refuses (INTENT_NOT_CANCELLED) if any such row is not in the proven
 *        list. Rows whose money DID move are never in that list and are
 *        detached, not deleted.
 *
 * SAFETY: the RPC is the guarantee; this function is the JWT and the Stripe
 *        round-trip. Service role bypasses RLS, so the ownership check here
 *        exists for a clean error, and the RPC re-checks it under lock. The
 *        two "cannot succeed by retrying" codes are mapped honestly rather
 *        than to "try again": an open dispute or a payout review will not
 *        clear because the owner retried.
 * LINKS: supabase/migrations/20260921100000_a_cancelled_post_can_be_deleted.sql
 *          (delete_cancelled_post — NOT_OWNER / NOT_CANCELLED /
 *           MONEY_IN_FLIGHT / DISPUTE_OPEN / PAYMENT_REVIEW_OPEN /
 *           INTENT_NOT_CANCELLED);
 *        supabase/functions/delete-draft/index.ts (the sibling this mirrors,
 *          including the cancel-and-prove loop);
 *        src/features/vehicles/api/deletePostApi.ts (the client caller).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { withHandler } from '../_shared/handler.ts';
import { createLog } from '../_shared/log.ts';
import { describeError } from '../_shared/redact.ts';

const log = createLog('delete-post');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(withHandler(log, async (request) => {
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
  // A non-UUID cannot name a post; rejecting it here is a clean 400 instead of
  // a Postgres cast error dressed up as a 500.
  if (typeof postId !== 'string' || !UUID_RE.test(postId)) {
    return errorResponse('BAD_REQUEST', 'Missing post id.', 400);
  }

  // --- Verify ownership + cancelled state --------------------------------------
  // For a clean error, not for the guarantee — the RPC re-checks under lock.
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id, status')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    log.error('posts_delete_lookup_failed', { error: describeError(postError) });
    return errorResponse('LOOKUP_FAILED', 'We couldn’t delete that post. Please try again.', 500);
  }
  if (!post || post.owner_id !== userId) {
    // "Not found" and "not yours" are the same answer — a post id must never
    // be an existence oracle.
    return errorResponse('POST_NOT_FOUND', 'We couldn’t find that post.', 404);
  }
  if (post.status !== 'cancelled') {
    return errorResponse(
      'POST_NOT_CANCELLED',
      'Only a cancelled listing can be deleted. Deactivate it first.',
      409,
    );
  }

  const deletePost = async (proven: string[]) =>
    (
      await admin.rpc('delete_cancelled_post', {
        p_post_id: postId,
        p_owner_id: userId,
        p_cancelled_intent_ids: proven,
      })
    ).error;

  // --- Ask first, with no evidence ---------------------------------------------
  // The RPC refuses for money, holds, disputes and reviews BEFORE it looks at
  // any intent, and a refusal rolls back. So a delete that cannot happen costs
  // no Stripe calls — before this, every retry during a 72-hour hold
  // re-cancelled every abandoned intent on the post (audit run 2, lead 6). A
  // post with no stray rows is simply deleted here.
  const cancelled: string[] = [];
  let deleteError = await deletePost([]);

  if (deleteError?.message?.includes('INTENT_NOT_CANCELLED')) {
    // --- Cancel stray uncaptured intents AT STRIPE, recording what we WATCHED die
    // Only the never-captured rows: the settled ones (refunded / collected /
    // released) are detached by the RPC and their intents are terminal at
    // Stripe — cancelling those would error to no purpose. A 'held' row means
    // money still in escrow; the RPC refuses the delete outright, so it is not
    // touched here either.
    const { data: ledger, error: ledgerError } = await admin
      .from('payments')
      .select('stripe_payment_intent_id, status')
      .eq('post_id', postId)
      .in('status', ['requires_payment', 'failed']);

    if (ledgerError) {
      log.error('posts_ledger_read_failed', { error: describeError(ledgerError) });
      return errorResponse('LOOKUP_FAILED', 'We couldn’t delete that post. Please try again.', 500);
    }

    const stripe = createStripeClient();
    for (const row of ledger ?? []) {
      const intentId = row.stripe_payment_intent_id as string;
      try {
        const intent = await stripe.paymentIntents.cancel(intentId);
        // ⚠️ ONLY push what Stripe CONFIRMS is dead — the RPC treats this list
        // as evidence, exactly as delete-draft's does.
        if (intent.status === 'canceled') cancelled.push(intentId);
      } catch (err) {
        // An already-terminal intent cannot be cancelled and does not need to
        // be. Re-read it and trust only what Stripe says now.
        try {
          const current = await stripe.paymentIntents.retrieve(intentId);
          if (current.status === 'canceled') cancelled.push(intentId);
        } catch (retrieveErr) {
          // Cannot cancel it and cannot read it — so we cannot prove it is
          // dead. Say nothing about it: the RPC will find its ledger row
          // unnamed and refuse, which is the correct outcome.
          log.warn('posts_intent_state_unknown', {
            post_id: postId,
            error: describeError(retrieveErr),
            original: describeError(err),
          });
        }
      }
    }

    // --- Delete, with the evidence --------------------------------------------
    deleteError = await deletePost(cancelled);
  }

  if (deleteError) {
    const message = deleteError.message ?? '';

    // The refund is still settling — a hold window open, or escrow mid-refund.
    // Retrying LATER genuinely is the fix, so the copy says when, not "again".
    if (message.includes('MONEY_IN_FLIGHT')) {
      log.warn('posts_delete_refused', { post_id: postId, detail: 'money still settling' });
      return errorResponse(
        'MONEY_IN_FLIGHT',
        'Your refund is still being processed. You can delete this post once it’s done.',
        409,
      );
    }

    // The guard did its job: a ledger row we could not prove dead, usually an
    // intent opened on another device mid-flight. Retrying genuinely is the
    // fix — the next attempt sees and cancels it.
    if (message.includes('INTENT_NOT_CANCELLED')) {
      log.warn('posts_delete_refused', {
        post_id: postId,
        cancelled_count: cancelled.length,
        detail: 'an intent could not be proven cancelled',
      });
      return errorResponse(
        'INTENT_NOT_CANCELLED',
        'A payment on this post is still being processed. Please try again in a moment.',
        409,
      );
    }

    // Neither of these clears on retry; say what is actually happening.
    if (message.includes('DISPUTE_OPEN')) {
      log.warn('posts_delete_refused', { post_id: postId, detail: 'open dispute' });
      return errorResponse(
        'DISPUTE_OPEN',
        'A sighting on this post is being reviewed, so it can’t be deleted yet.',
        409,
      );
    }
    if (message.includes('PAYMENT_REVIEW_OPEN')) {
      log.error('posts_delete_refused', { post_id: postId, detail: 'payout review open' });
      return errorResponse(
        'PAYMENT_REVIEW_OPEN',
        'A payment on this post is being reviewed. Contact support and we’ll sort it.',
        409,
      );
    }

    if (message.includes('NOT_CANCELLED')) {
      return errorResponse(
        'POST_NOT_CANCELLED',
        'Only a cancelled listing can be deleted. Deactivate it first.',
        409,
      );
    }
    if (message.includes('NOT_OWNER')) {
      return errorResponse('POST_NOT_FOUND', 'We couldn’t find that post.', 404);
    }

    log.error('posts_delete_cancelled_post_failed', { message, post_id: postId });
    return errorResponse('DELETE_FAILED', 'We couldn’t delete that post. Please try again.', 500);
  }

  log.info('posts_cancelled_post_deleted', { post_id: postId, intents_cancelled: cancelled.length });
  return jsonResponse({ deleted: true });
}));
