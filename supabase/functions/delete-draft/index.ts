/**
 * WHAT:  Edge Function that DELETES an owner's own draft listing. Given
 *        { postId } from the authenticated owner, it verifies the caller owns
 *        that post and it is still a draft, CANCELS EVERY OPEN PaymentIntent AT
 *        STRIPE, and only then calls delete_draft_post with the intent ids it
 *        watched turn `canceled`.
 * WHY:   A draft was a one-way door: the wizard could save one, My Posts listed
 *        it, and nothing could remove it. The draft someone started by mistake,
 *        or on a car they have since got back, stayed for ever.
 *
 *        ⚠️ THIS FUNCTION EXISTS BECAUSE ITS SOURCE WAS LOST. delete_draft_post
 *        and a deployed `delete-draft` have been live since 2026-08-16, built in
 *        a checkout that no longer exists; this repository never had the code.
 *        It is written from the RPC's contract (20260816110000) rather than
 *        recovered, so read that migration before changing anything here — the
 *        ordering below is not a style choice, it is the whole safety argument.
 *
 * ⚠️ THE ORDER IS THE SAFETY PROPERTY. Cancel at Stripe FIRST, delete SECOND.
 *        A draft can carry a live PaymentIntent: the owner pressed "Post & pay",
 *        create-payment-intent opened one and wrote the ledger row, and then
 *        they dismissed the sheet. That intent is still confirmable by anyone
 *        holding its client secret. Deleting the ledger row first would leave a
 *        charge that can still succeed into a post that no longer exists, with
 *        no row for the webhook to land on — the platform holding money with
 *        nothing recording whose it is.
 *
 *        And the RPC does not take our word for it. It re-checks, inside the
 *        same transaction as its row lock, that EVERY surviving payments row is
 *        named in the list we pass, and raises INTENT_NOT_CANCELLED otherwise.
 *        So an intent opened on another device while this was in flight is not
 *        in our list, and the delete does not happen.
 *
 * ⚠️ A 'failed' ROW IS NOT DEAD, and skipping those is the exact bug
 *        20260816110000 was written to fix. mark_post_payment_held advances
 *        'failed' -> 'held' deliberately, because one PaymentIntent is reused
 *        per post and a decline followed by a successful retry fires `succeeded`
 *        on the SAME intent. create-payment-intent also writes 'failed' after a
 *        BEST-EFFORT cancel that swallows every Stripe error. So we cancel every
 *        row we find, whatever its status.
 *
 * SAFETY: STORAGE IS DELIBERATELY NOT SWEPT. Photo objects are keyed by CONTENT
 *        (`<user-id>/<hash>-<n>.jpg`), not by post, so two listings that used
 *        the same photo share one object and removing it here would blank an
 *        image on a DIFFERENT, live listing. They stay in the owner's own folder
 *        and are swept wholesale by delete-account.
 * LINKS: supabase/migrations/20260816110000_a_draft_delete_must_prove_the_intents_are_dead.sql
 *          (delete_draft_post — NOT_OWNER / NOT_DRAFT / PAYMENT_EXISTS /
 *           INTENT_NOT_CANCELLED, and why the proof is required);
 *        supabase/functions/create-payment-intent/index.ts (what writes the
 *          ledger rows this cancels);
 *        supabase/functions/deactivate-post/index.ts (the sibling this mirrors);
 *        src/features/vehicles/api/draftApi.ts (the client caller).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

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

  // --- Verify ownership + draft state -----------------------------------------
  // Service role bypasses RLS; the ownership check is re-imposed here so a
  // signed-in user can only delete THEIR OWN draft. The RPC checks again — this
  // is for a clean error, not for the guarantee.
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id, status')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    console.error('[drafts] post lookup failed', postError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t delete that draft. Please try again.', 500);
  }
  if (!post || post.owner_id !== userId) {
    // "Not found" and "not yours" are the same answer — a post id must never be
    // an existence oracle.
    return errorResponse('POST_NOT_FOUND', 'We couldn’t find that draft.', 404);
  }
  if (post.status !== 'draft') {
    return errorResponse(
      'POST_NOT_DRAFT',
      'This listing has already been submitted and can’t be deleted.',
      409,
    );
  }

  // --- Cancel every open intent AT STRIPE, and record what we WATCHED die ------
  // Every row, whatever its status — see the 'failed' note in the header.
  const { data: ledger, error: ledgerError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id, status')
    .eq('post_id', postId);

  if (ledgerError) {
    console.error('[drafts] ledger read failed', ledgerError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t delete that draft. Please try again.', 500);
  }

  const stripe = createStripeClient();
  const cancelled: string[] = [];

  for (const row of ledger ?? []) {
    const intentId = row.stripe_payment_intent_id as string;
    try {
      const intent = await stripe.paymentIntents.cancel(intentId);
      // ⚠️ ONLY push what Stripe CONFIRMS is dead. This list is evidence, and
      // the RPC treats it as such — a hopeful entry would let a still-live
      // intent's ledger row be deleted, which is the one outcome this whole
      // function is arranged to prevent.
      if (intent.status === 'canceled') cancelled.push(intentId);
    } catch (err) {
      // An already-terminal intent cannot be cancelled and does not need to be:
      // `succeeded` means money moved (the RPC will refuse the delete on the
      // ledger status anyway), and an already-`canceled` one is dead. Re-read
      // it and trust only what Stripe says now.
      try {
        const current = await stripe.paymentIntents.retrieve(intentId);
        if (current.status === 'canceled') cancelled.push(intentId);
      } catch (retrieveErr) {
        // Cannot cancel it and cannot read it — so we cannot prove it is dead.
        // Say nothing about it: the RPC will find its ledger row unnamed and
        // refuse, which is the correct outcome and the reason the proof exists.
        console.warn('[drafts] intent state unknown', {
          postId,
          message: (retrieveErr as Error).message,
          original: (err as Error).message,
        });
      }
    }
  }

  // --- Delete, with the evidence ----------------------------------------------
  const { error: deleteError } = await admin.rpc('delete_draft_post', {
    p_post_id: postId,
    p_owner_id: userId,
    p_cancelled_intent_ids: cancelled,
  });

  if (deleteError) {
    const message = deleteError.message ?? '';

    // The owner is not stuck and must not be told to "try again" for something
    // that will never succeed: money that actually moved means this draft is
    // not a draft any more in every sense that matters.
    if (message.includes('PAYMENT_EXISTS')) {
      console.error('[drafts] delete refused — money has moved', { postId });
      return errorResponse(
        'PAYMENT_EXISTS',
        'This listing has a payment against it, so it can’t be deleted. Contact support and we’ll sort it.',
        409,
      );
    }

    // The guard did its job: a ledger row we could not prove dead. Retrying is
    // genuinely worth it — the usual cause is an intent opened on another
    // device mid-flight, which the next attempt will see and cancel.
    if (message.includes('INTENT_NOT_CANCELLED')) {
      console.warn('[drafts] delete refused — an intent could not be proven cancelled', {
        postId,
        cancelledCount: cancelled.length,
      });
      return errorResponse(
        'INTENT_NOT_CANCELLED',
        'A payment on this draft is still being processed. Please try again in a moment.',
        409,
      );
    }

    if (message.includes('NOT_DRAFT')) {
      return errorResponse(
        'POST_NOT_DRAFT',
        'This listing has already been submitted and can’t be deleted.',
        409,
      );
    }
    if (message.includes('NOT_OWNER')) {
      return errorResponse('POST_NOT_FOUND', 'We couldn’t find that draft.', 404);
    }

    console.error('[drafts] delete_draft_post failed', message, { postId });
    return errorResponse('DELETE_FAILED', 'We couldn’t delete that draft. Please try again.', 500);
  }

  console.log('[drafts] draft deleted', { postId, intentsCancelled: cancelled.length });
  return jsonResponse({ deleted: true });
});
