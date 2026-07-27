/**
 * WHAT:  Edge Function that opens the bounty escrow charge for a draft post.
 *        Given { postId } from the authenticated owner, it verifies the caller
 *        OWNS that post and it is still a draft, reads the bounty amount FROM
 *        THE DATABASE, creates a Stripe PaymentIntent (captured immediately to
 *        the platform balance = escrow), records the ledger row, and returns the
 *        client secret for the app's PaymentSheet.
 * WHY:   The charge amount and the state machine must live on the server — the
 *        client never says how much to charge (SECURITY_AND_TRUST §4). The
 *        amount is the post's own bounty_amount_pence; ownership is proven from
 *        the caller's JWT, not a client-supplied id. The Stripe idempotency key
 *        is `post-bounty-<postId>-<amountPence>`, so a retry after a declined/
 *        cancelled PaymentSheet reuses the SAME PaymentIntent and never double-
 *        charges (the ledger fn is likewise idempotent) — while a legitimate
 *        in-draft bounty EDIT changes the amount and thus the key, opening a
 *        fresh intent; the stale intent is cancelled at Stripe and its ledger row
 *        superseded to 'failed', so an edit can never strand a captured charge or
 *        leave an abandoned intent able to capture. Escrow model per
 *        ADR-0002: separate charges &
 *        transfers, capture immediately — NO destination charge / application
 *        fee here (payout is a later, separate slice).
 * LINKS: supabase/functions/_shared/clients.ts, _shared/http.ts;
 *        supabase/migrations/20260726100000_post_payment.sql
 *          (record_post_payment_intent — POST_NOT_DRAFT / BOUNTY_MISMATCH);
 *        src/features/payments/api/paymentsApi.ts (the client caller);
 *        docs/decisions/ADR-0002-stripe-connect.md; supabase/functions/README.md.
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
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in to pay.', 401);
  }

  const admin = createServiceRoleClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in to pay.', 401);
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

  // --- Verify ownership + draft state, read the AUTHORITATIVE amount -----------
  // Service role bypasses RLS; we re-impose the ownership check here so a signed-in
  // user can only pay for THEIR OWN draft. The amount is the post's own bounty —
  // never anything the client sent.
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id, status, bounty_amount_pence')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    console.error('[payments] post lookup failed', postError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t start your payment. Please try again.', 500);
  }
  if (!post || post.owner_id !== userId) {
    // Don't distinguish "not found" from "not yours" — both are a 404 to the caller.
    return errorResponse('POST_NOT_FOUND', 'We couldn’t find that post.', 404);
  }
  if (post.status !== 'draft') {
    return errorResponse(
      'POST_NOT_DRAFT',
      'This post has already been submitted for verification.',
      409,
    );
  }

  const amountPence = post.bounty_amount_pence as number;

  // --- Supersede a stale open intent at a DIFFERENT amount ---------------------
  // If the bounty was edited since an abandoned attempt, an open PaymentIntent at
  // the OLD amount is still live at Stripe. Cancel it (its ledger row is
  // superseded to 'failed' by record_post_payment_intent below) so no abandoned
  // intent can later capture escrow at the stale amount. Best-effort: an
  // already-terminal/cancelled intent just no-ops. Same-amount rows are the
  // in-flight retry — left alone so createPaymentIntent's idempotency key reuses
  // them.
  const stripe = createStripeClient();
  const { data: staleRows } = await admin
    .from('payments')
    .select('stripe_payment_intent_id, amount_pence')
    .eq('post_id', postId)
    .eq('status', 'requires_payment');
  for (const row of staleRows ?? []) {
    if (row.amount_pence !== amountPence) {
      try {
        await stripe.paymentIntents.cancel(row.stripe_payment_intent_id);
      } catch (err) {
        // Already cancelled/terminal, or a transient Stripe error — the ledger
        // supersede below still fires; a stray success would land on a 'failed'
        // row, but the amount no longer matches the post so it's out of the
        // normal path. Log and continue rather than block the new charge.
        console.warn('[payments] stale intent cancel failed', (err as Error).message);
      }
    }
  }

  // --- Create (or reuse) the escrow PaymentIntent -----------------------------
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountPence,
        currency: 'gbp',
        // Capture immediately to the platform balance (ADR-0002 escrow hold — a
        // manual-capture authorization would expire long before recovery).
        capture_method: 'automatic',
        automatic_payment_methods: { enabled: true },
        // The webhook matches the ledger row by intent id; post_id in metadata
        // is for dashboard/debugging traceability.
        metadata: { post_id: postId },
      },
      // Idempotency key = post_id + amount: a retry after a cancelled/declined
      // sheet returns the SAME PaymentIntent (never double-charged); a legitimate
      // in-draft bounty edit changes the amount, so the key differs and Stripe
      // opens a fresh intent instead of rejecting the changed-amount replay.
      { idempotencyKey: `post-bounty-${postId}-${amountPence}` },
    );
  } catch (err) {
    console.error('[payments] PaymentIntent create failed', (err as Error).message);
    return errorResponse('STRIPE_ERROR', 'We couldn’t start your payment. Please try again.', 502);
  }

  // --- Record the ledger row (idempotent, server-authoritative amount) --------
  const { error: recordError } = await admin.rpc('record_post_payment_intent', {
    p_post_id: postId,
    p_payment_intent_id: paymentIntent.id,
    p_amount_pence: amountPence,
  });
  if (recordError) {
    // The charge intent exists but we couldn't record it. Surface a retryable
    // error; the idempotency key means the retry reuses this same intent.
    console.error('[payments] record_post_payment_intent failed', recordError.message);
    return errorResponse('LEDGER_ERROR', 'We couldn’t start your payment. Please try again.', 500);
  }

  return jsonResponse({ clientSecret: paymentIntent.client_secret });
});
