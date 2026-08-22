/**
 * WHAT:  Edge Function that opens the CHARGE for a draft post. Given { postId }
 *        from the authenticated owner, it verifies the caller OWNS that post and
 *        it is still a draft, reads the amount FROM THE DATABASE, creates a
 *        Stripe PaymentIntent (captured immediately), records the ledger row, and
 *        returns the client secret for the app's PaymentSheet.
 *
 *        TWO PRICING MODES share this one function (ADR-0014). A post carries
 *        EITHER a bounty (£10–£5,000, escrowed) OR a flat £5 listing fee
 *        (platform revenue on capture, never refunded). WHETHER THE POST HAS A
 *        BOUNTY IS the pricing mode — a NULL bounty is a free listing — so this
 *        function reads the post and follows it; there is no mode flag to pass
 *        and nothing for the client to choose here.
 * WHY:   The charge amount and the state machine must live on the server — the
 *        client never says how much to charge, or which price applies
 *        (SECURITY_AND_TRUST §4). The amount is the post's own
 *        bounty_amount_pence, or the flat fee when that is NULL; ownership is proven from the
 *        caller's JWT, not a client-supplied id. The Stripe idempotency key is
 *        `post-bounty-<postId>-<amountPence>` / `post-fee-<postId>-<amountPence>`,
 *        so a retry after a declined/cancelled PaymentSheet reuses the SAME
 *        PaymentIntent and never double-charges (the ledger fns are likewise
 *        idempotent) — while a legitimate in-draft price EDIT changes the amount
 *        and thus the key, opening a fresh intent; the stale intent is cancelled
 *        at Stripe and its ledger row superseded to 'failed', so an edit can
 *        never strand a captured charge or leave an abandoned intent able to
 *        capture. The two key PREFIXES differ so that a draft which switches
 *        pricing mode at the same numeric amount still gets a fresh intent.
 *        Escrow model per ADR-0002: separate charges & transfers, capture
 *        immediately — NO destination charge / application fee here (payout is a
 *        later, separate slice). A listing fee has no payout leg at all.
 * LINKS: supabase/functions/_shared/clients.ts, _shared/http.ts;
 *        supabase/migrations/20260726100000_post_payment.sql
 *          (record_post_payment_intent — POST_NOT_DRAFT / BOUNTY_MISMATCH);
 *        supabase/migrations/20260819100000_a_listing_can_be_free.sql
 *          (record_post_payment_intent serving BOTH prices, payments.kind, and
 *           the conditional amount CHECK that pins a fee at exactly 500);
 *        src/features/payments/api/paymentsApi.ts (the client caller);
 *        docs/decisions/ADR-0002-stripe-connect.md;
 *        docs/decisions/ADR-0014-no-bounty-listings.md;
 *        supabase/functions/README.md.
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

  // --- Resolve the pricing mode from the post, never from the client ---------
  // MONEY: the pricing mode IS whether the post has a bounty. A NULL bounty is a
  // FREE LISTING (20260819100000) and owes the flat fee; anything else owes its
  // own bounty. There is no mode flag and nothing for the client to choose.
  //
  // ⚠️ THE FEE IS A CONSTANT HERE, NOT A COLUMN. An earlier version of this file
  // read posts.listing_fee_pence — a snapshot column belonging to a £4.99 design
  // that only ever existed in the repo. Selecting it against the real database
  // errored, and every no-bounty listing died on "We couldn't start your
  // payment" for four days. The live design keeps one price and enforces it in
  // the ledger CHECK; this constant is checked against that by
  // record_post_payment_intent, which raises BOUNTY_MISMATCH on disagreement.
  const LISTING_FEE_PENCE = 500;
  const bountyPence = post.bounty_amount_pence as number | null;
  const isListingFee = bountyPence === null;
  const amountPence = isListingFee ? LISTING_FEE_PENCE : bountyPence;

  if (typeof amountPence !== 'number' || !Number.isInteger(amountPence) || amountPence <= 0) {
    // Defensive: the table CHECK makes this unreachable. If it ever fires, the
    // post's money columns are inconsistent and the right move is to refuse the
    // charge loudly rather than send Stripe an amount we cannot justify.
    console.error('[payments] post has no usable price', { postId });
    return errorResponse('LOOKUP_FAILED', 'We couldn’t start your payment. Please try again.', 500);
  }

  // The two prefixes must differ: a draft that switched pricing mode could
  // otherwise land on the same key as its abandoned attempt at the same amount
  // and reuse an intent recorded against the other ledger kind.
  const idempotencyKey = isListingFee
    ? `post-fee-${postId}-${amountPence}`
    : `post-bounty-${postId}-${amountPence}`;

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
        // The webhook matches the ledger row by intent id; these are for
        // dashboard/debugging traceability only and are never read back as
        // authority. `kind` mirrors payments.kind so a charge in the Stripe
        // dashboard can be told apart from an escrowed bounty without a join.
        metadata: { post_id: postId, kind: isListingFee ? 'listing_fee' : 'bounty_escrow' },
      },
      // Idempotency key = kind + post_id + amount: a retry after a cancelled/
      // declined sheet returns the SAME PaymentIntent (never double-charged); a
      // legitimate in-draft price edit changes the amount, so the key differs and
      // Stripe opens a fresh intent instead of rejecting the changed-amount
      // replay. See the resolution above for why the kind is part of the key.
      { idempotencyKey },
    );
  } catch (err) {
    console.error('[payments] PaymentIntent create failed', (err as Error).message);
    return errorResponse('STRIPE_ERROR', 'We couldn’t start your payment. Please try again.', 502);
  }

  // --- Record the ledger row (idempotent, server-authoritative amount) --------
  // record_post_payment_intent re-validates the amount against the post's OWN
  // price and raises BOUNTY_MISMATCH on disagreement — for BOTH modes — so the
  // branch above cannot mis-charge even if it were wrong.
  // ONE function for both prices. record_post_payment_intent re-derives the
  // mode from the post (NULL bounty -> listing_fee, else bounty_escrow), sets
  // payments.kind from the same branch so the row's lifecycle and its price can
  // never disagree, and rejects an amount that is not what the post owes.
  const { error: recordError } = await admin.rpc('record_post_payment_intent', {
    p_post_id: postId,
    p_payment_intent_id: paymentIntent.id,
    p_amount_pence: amountPence,
  });
  if (recordError) {
    // The charge intent exists but we couldn't record it. Surface a retryable
    // error; the idempotency key means the retry reuses this same intent.
    //
    // ONE function serves both prices, so the name is fixed — but the MODE is
    // logged beside it, which is the part that actually helps when reading these
    // logs to work out which pricing path broke.
    //
    // This briefly named `record_listing_fee_intent` on the fee branch, from a
    // £4.99 design that only ever existed in this repo. A log line naming a
    // function the database has not got is worse than a vague one: it sends the
    // next reader looking for something that was never there.
    console.error('[payments] record_post_payment_intent failed', recordError.message, {
      postId,
      amountPence,
      mode: isListingFee ? 'listing_fee' : 'bounty_escrow',
    });
    return errorResponse('LEDGER_ERROR', 'We couldn’t start your payment. Please try again.', 500);
  }

  return jsonResponse({ clientSecret: paymentIntent.client_secret });
});
