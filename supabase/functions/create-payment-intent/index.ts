/**
 * WHAT:  Edge Function that opens the CHARGE for a draft post. Given { postId }
 *        from the authenticated owner, it verifies the caller OWNS that post and
 *        it is still a draft, reads the amount FROM THE DATABASE, creates a
 *        Stripe PaymentIntent (captured immediately), records the ledger row, and
 *        returns the client secret for the app's PaymentSheet.
 *
 *        TWO PRICING MODES share this one function (ADR-0014). A post carries
 *        EITHER a reward (£10–£5,000, escrowed) OR a flat £5 listing fee
 *        (platform revenue on capture, never refunded). WHETHER THE POST HAS A
 *        BOUNTY IS the pricing mode — a NULL bounty is a free listing — so this
 *        function reads the post and follows it; the client never chooses.
 *
 *        ADR-0020 (2026-09-25): a reward listing is charged the reward PLUS a
 *        5% service fee (`_shared/serviceFee.ts`), so the spotter receives the
 *        reward in full. The client must send `pricing: 'fee_on_top'`. That
 *        field is not a choice — the server still derives the price — it is
 *        the app build saying "I showed the owner the fee-on-top total". A
 *        build that predates ADR-0020 showed the bare reward, so it is refused
 *        with UPGRADE_REQUIRED rather than charged 5% more than it displayed.
 *        The £5 listing fee is unchanged and needs no such acknowledgement.
 * WHY:   The charge amount and the state machine must live on the server — the
 *        client never says how much to charge, or which price applies
 *        (SECURITY_AND_TRUST §4). The amount is derived from the post's own
 *        bounty_amount_pence (reward + 5%), or the flat fee when that is NULL;
 *        ownership is proven from the
 *        caller's JWT, not a client-supplied id. The Stripe idempotency key is
 *        `post-reward-<postId>-<chargePence>` / `post-fee-<postId>-<amountPence>`,
 *        so a retry after a declined/cancelled PaymentSheet reuses the SAME
 *        PaymentIntent and never double-charges (the ledger fns are likewise
 *        idempotent) — while a legitimate in-draft price EDIT changes the amount
 *        and thus the key, opening a fresh intent; the stale intent is cancelled
 *        at Stripe and its ledger row superseded to 'failed', so an edit can
 *        never strand a captured charge or leave an abandoned intent able to
 *        capture. The two key PREFIXES differ so that a draft which switches
 *        pricing mode at the same numeric amount still gets a fresh intent.
 *        (`post-reward-` replaced `post-bounty-` with ADR-0020: under the old
 *        prefix a £525 reward charged the old way and a £500 reward charged
 *        the new way both keyed on 52500, and Stripe would have handed back an
 *        intent recorded under the other split.)
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
 *        supabase/migrations/20260925100000_the_reward_is_the_reward.sql
 *          (fee on top: the reward listing's charge, recorded as fee_on_top);
 *        supabase/functions/_shared/serviceFee.ts (the charge rule);
 *        docs/decisions/ADR-0020-the-reward-is-the-reward.md;
 *        supabase/functions/README.md.
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';
import { rewardCharge } from '../_shared/serviceFee.ts';

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
  let pricing: unknown;
  try {
    ({ postId, pricing } = await request.json());
  } catch {
    return errorResponse('BAD_REQUEST', 'Malformed request.', 400);
  }
  if (typeof postId !== 'string' || postId.length === 0) {
    return errorResponse('BAD_REQUEST', 'Missing post id.', 400);
  }

  // --- Verify ownership + draft state, read the AUTHORITATIVE amount -----------
  // Service role bypasses RLS; we re-impose the ownership check here so a signed-in
  // user can only pay for THEIR OWN draft. The amount is derived from the post's
  // own price (reward + 5%, or the flat fee) — never anything the client sent.
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
  // reward plus the 5% service fee (ADR-0020). The client chooses nothing here —
  // the `pricing` it sends is an acknowledgement, checked below, not a choice.
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

  if (
    !isListingFee &&
    (typeof bountyPence !== 'number' || !Number.isInteger(bountyPence) || bountyPence <= 0)
  ) {
    // Defensive: the table CHECK makes this unreachable. If it ever fires, the
    // post's money columns are inconsistent and the right move is to refuse the
    // charge loudly rather than send Stripe an amount we cannot justify.
    console.error('[payments] post has no usable price', { postId });
    return errorResponse('LOOKUP_FAILED', 'We couldn’t start your payment. Please try again.', 500);
  }

  // MONEY (ADR-0020): a reward listing is charged reward + 5%. The build must
  // confirm it showed that total — see the header. Checked AFTER the post is
  // read so a free listing (whose £5 never changed) is never refused.
  if (!isListingFee && pricing !== 'fee_on_top') {
    return errorResponse(
      'UPGRADE_REQUIRED',
      'Update the app to post a listing with a reward.',
      426,
    );
  }

  const charge = isListingFee ? null : rewardCharge(bountyPence as number);
  const amountPence = charge ? charge.chargePence : LISTING_FEE_PENCE;

  // The two prefixes must differ: a draft that switched pricing mode could
  // otherwise land on the same key as its abandoned attempt at the same amount
  // and reuse an intent recorded against the other ledger kind.
  const idempotencyKey = isListingFee
    ? `post-fee-${postId}-${amountPence}`
    : `post-reward-${postId}-${amountPence}`;

  // --- Has an earlier attempt ALREADY been paid? ------------------------------
  // ⚠️ ASK STRIPE, NOT THE LEDGER. The ledger only learns a payment succeeded
  // when the webhook lands, and the payment sheet can report "failed" or
  // "cancelled" for a payment that in fact went through (a dropped connection
  // after confirm). If the owner then retries — at the same price or an edited
  // one — the draft is still a draft, and opening a second intent next to a
  // paid one is a double charge: the late webhook lifts the first row to
  // `held` while the owner pays the second, and every later money path then
  // finds two held rows for one post.
  //
  // So every intent this post still has open (requires_payment) or recently
  // failed (a decline can be followed by a success on the same intent) is read
  // from Stripe first. If any has moved money, this refuses — the listing is
  // paid for, and the webhook is about to make it live.
  const stripe = createStripeClient();
  const { data: openRows, error: openError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('post_id', postId)
    .in('status', ['requires_payment', 'failed']);
  if (openError) {
    console.error('[payments] open intent lookup failed', openError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t start your payment. Please try again.', 500);
  }
  const openIntentIds = (openRows ?? []).map((row) => row.stripe_payment_intent_id as string);
  const MONEY_MOVING = new Set(['succeeded', 'processing', 'requires_capture']);
  for (const id of openIntentIds) {
    let status: string;
    try {
      status = (await stripe.paymentIntents.retrieve(id)).status;
    } catch (err) {
      // Unknown is not "safe to charge again". Refuse and let them retry.
      console.error('[payments] open intent retrieve failed', (err as Error).message);
      return errorResponse('STRIPE_ERROR', 'We couldn’t start your payment. Please try again.', 502);
    }
    if (MONEY_MOVING.has(status)) {
      console.log('[payments] earlier attempt already paid', { postId, status });
      return errorResponse(
        'PAYMENT_ALREADY_TAKEN',
        'Your payment has already gone through. Your listing will be live in a moment.',
        409,
      );
    }
  }

  // --- Create (or reuse) the escrow PaymentIntent -----------------------------
  const createIntent = (key: string) =>
    stripe.paymentIntents.create(
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
        // A reward charge also carries its split, so the dashboard shows which
        // part is the reward and which the fee — traceability only.
        // ⚠️ Only on the reward branch: its `post-reward-` keys are new with
        // ADR-0020. Adding fields to the fee branch would change the parameters
        // behind an existing `post-fee-` key, and Stripe rejects a replayed key
        // whose parameters differ — every £5 retry across the deploy would fail.
        metadata: charge
          ? {
              post_id: postId,
              kind: 'bounty_escrow',
              reward_pence: String(charge.rewardPence),
              service_fee_pence: String(charge.serviceFeePence),
            }
          : { post_id: postId, kind: 'listing_fee' },
      },
      // Idempotency key = kind + post_id + amount: a retry after a cancelled/
      // declined sheet returns the SAME PaymentIntent (never double-charged); a
      // legitimate in-draft price edit changes the amount, so the key differs and
      // Stripe opens a fresh intent instead of rejecting the changed-amount
      // replay. See the resolution above for why the kind is part of the key.
      { idempotencyKey: key },
    );

  let paymentIntent;
  try {
    paymentIntent = await createIntent(idempotencyKey);
    // ⚠️ A KEY CAN HAND BACK A CANCELLED INTENT (review 2026-09-25). Edit the
    // reward £100 → £200 → £100 inside Stripe's ~24h key window: the £100 key
    // returns the intent this very function cancelled when the price moved to
    // £200. It cannot be paid, so the owner would be handed a dead secret for a
    // day. Open a fresh one under a key that counts this post's attempts — a
    // number that only grows, so it never collides with a key already spent.
    if (paymentIntent.status === 'canceled') {
      const { count } = await admin
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('post_id', postId);
      paymentIntent = await createIntent(`${idempotencyKey}-a${count ?? 0}`);
    }
  } catch (err) {
    console.error('[payments] PaymentIntent create failed', (err as Error).message);
    return errorResponse('STRIPE_ERROR', 'We couldn’t start your payment. Please try again.', 502);
  }

  // --- Stop every OTHER intent before this one can be paid --------------------
  // Whatever differs from the intent just returned — an edited price, the
  // pre-ADR-0020 price, or a same-price intent whose idempotency key expired —
  // is cancelled at Stripe now, so only one payable intent ever exists for a
  // post. record_post_payment_intent then supersedes their ledger rows.
  //
  // ⚠️ A CANCEL THAT FAILS STOPS THE CHARGE. It used to be logged and ignored,
  // which is how an intent that had just succeeded could be superseded and
  // then land on a 'failed' row. Now a failed cancel is re-read: already
  // cancelled is fine, anything else means an intent we could not stop, and
  // no second secret is handed out next to it. (The new intent, unrecorded and
  // never returned, cannot be paid.)
  for (const id of openIntentIds) {
    if (id === paymentIntent.id) {
      continue;
    }
    try {
      await stripe.paymentIntents.cancel(id);
    } catch (err) {
      let status: string | null = null;
      try {
        status = (await stripe.paymentIntents.retrieve(id)).status;
      } catch {
        // Fall through with status unknown — treated as "could not stop it".
      }
      if (status !== 'canceled') {
        console.error('[payments] stale intent could not be stopped', {
          postId,
          status,
          error: (err as Error).message,
        });
        return errorResponse('STRIPE_ERROR', 'We couldn’t start your payment. Please try again.', 502);
      }
    }
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

  // The breakdown goes back with the secret so the app can refuse to open the
  // payment sheet if the total differs from what it showed the owner. Display
  // confirmation only — the charge above is already fixed.
  return jsonResponse({
    clientSecret: paymentIntent.client_secret,
    amountPence,
    rewardPence: charge ? charge.rewardPence : null,
    serviceFeePence: charge ? charge.serviceFeePence : LISTING_FEE_PENCE,
  });
});
