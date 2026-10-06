/**
 * WHAT:  The one implementation of "refund a reward payment": read the payment
 *        from the ledger, work out the refund (the reward minus the FIXED card
 *        fee, cardFeePence), guard the arithmetic, and issue it under the PAYMENT's
 *        idempotency key. `refundPayment` refunds one named payment (the sweep's
 *        superseded and held-refund paths); `refundHeldEscrow` finds a post's
 *        held reward and refunds that (the two owner exits);
 *        `refundSupersededForPost` sends a replaced reward home the moment a
 *        reward change captures (stripe-webhook; the sweep is its retry).
 * WHY:   This sequence existed twice, line-for-line, in `deactivate-post` and
 *        `refund-recovery`, and the refund-hold sweep would have made three.
 *        What stays WITH the callers is everything that makes them different:
 *        the state they accept, the state they record (`mark_post_payment_
 *        refunded` vs `mark_post_recovered_no_spotter` vs
 *        `reconcile_payment_refund`), and their error vocabulary.
 *
 *        ⚠️ THE KEY IS NOW PER PAYMENT, NOT PER POST (2026-10-05). It used to be
 *        the caller's `post-refund-<post>` / `recovery-refund-<post>`. Once a
 *        reward can be renewed a post has several payments over its life, and
 *        a per-post key collides inside Stripe's ~24-hour idempotency window:
 *        renew and then deactivate on the same day, and the second refund
 *        request would be answered with the FIRST refund — the old payment's.
 *        A payment can only ever be refunded once, so the payment IS the key:
 *        `payment-refund-<payment intent id>`, whichever path asks.
 *
 *        ⚠️ SO EVERY PARAMETER MUST BE A FUNCTION OF THE PAYMENT ALONE. Stripe
 *        rejects a reused key whose parameters differ, and the deactivate,
 *        recovery and sweep paths can all race on one payment. The amount
 *        (bounty minus the fixed card fee, or the full amount when
 *        `refund_fee_absorbed`) and the metadata (`post_id`, nothing per-path)
 *        are both derived here from the ledger row — never passed in. That is
 *        why the old `metadata: { reason }` option is gone: the reason a refund
 *        happened is recorded in the ledger (the hold's exit_path, the
 *        superseded status), which is the only place anything reads it.
 *
 * MONEY: the caller never says how much. The bounty comes from the ledger and
 *        the withheld fee is the fixed 1.5% + 20p the owner was quoted before
 *        paying (ADR-0021, 2026-10-06) — until then it was Stripe's actual
 *        per-charge fee, which varies by card, so every pre-payment quote had
 *        to say "about". Whatever a card costs beyond the fixed fee,
 *        Trackitdown absorbs. The amount is a pure function of the ledger row,
 *        so a retry under the same idempotency key always asks for the same
 *        refund. The range guard (0 < refund <= bounty) is the last line
 *        before money moves. Fees (`listing_fee`) are never refunded: the
 *        ledger read filters on kind.
 * LINKS: supabase/functions/deactivate-post/index.ts;
 *        supabase/functions/refund-recovery/index.ts;
 *        supabase/functions/release-held-refunds/index.ts (the sweep);
 *        supabase/functions/stripe-webhook/index.ts (refundSupersededForPost);
 *        supabase/migrations/20261005110000_a_reward_can_be_replaced.sql
 *          (refunds_due, refund_fee_absorbed, the one-held index);
 *        supabase/tests/refundEscrow.test.ts;
 *        docs/decisions/ADR-0002-stripe-connect.md (escrow model).
 */

import type Stripe from 'npm:stripe@22.4.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

/**
 * Typed outcomes instead of thrown errors: every caller maps these to its own
 * error codes and copy, and the sweep logs them without a try/catch per item.
 */
export type EscrowRefundOutcome =
  | {
      status: 'refunded';
      refundId: string;
      refundPence: number;
      feePence: number;
      paymentIntentId: string;
    }
  /** No refundable reward payment matched — for the sweep this simply means
   *  "already settled"; for the interactive callers it is an anomaly. */
  | { status: 'no_held_payment' }
  /** A database read failed. Retryable. */
  | { status: 'lookup_failed' }
  /** Stripe refused, or the amount was out of range. Retryable. */
  | { status: 'stripe_error' };

/** THE refund key. Exported so the tests pin its exact shape: changing it
 *  while a refund is in flight would mint a second refund request. */
export function refundIdempotencyKey(paymentIntentId: string): string {
  return `payment-refund-${paymentIntentId}`;
}

/**
 * The card fee an owner's refund keeps: a FIXED 1.5% + 20p of the reward
 * (2026-10-06, ADR-0021). Not Stripe's actual fee for the charge, which
 * varies by card (premium, EU and international cards cost more): the owner
 * is quoted one exact figure before paying, and that figure is what they get
 * back. Whatever a card costs beyond it, Trackitdown absorbs.
 *
 * ⚠️ MIRRORED in the app as `cardFeePence` (src/shared/lib/money.ts), which
 * quotes it before payment. supabase/tests/refundEscrow.test.ts pins that the
 * two agree for every amount, so the quote and the refund can never differ.
 */
export function cardFeePence(amountPence: number): number {
  // 1.5%, rounded half-up to the penny, in INTEGER maths (no float ever
  // touches an amount): floor((pence × 15 + 500) / 1000) is round(pence × 0.015).
  return Math.floor((amountPence * 15 + 500) / 1000) + 20;
}

/**
 * The refund for one payment, in pence. Pure, and the ONLY place the amount is
 * decided: `refundPayment` uses it, and the tests pin it.
 *   - absorbed  → the full amount (a stray capture, or a reward taken under
 *                 the pre-term Terms — the platform eats the fee);
 *   - otherwise → the amount minus the fixed card fee (cardFeePence), exactly
 *                 as quoted to the owner before they paid.
 * Returns null when the result would be out of range (0 < refund <= amount).
 */
export function refundAmountPence(amountPence: number, feeAbsorbed: boolean): number | null {
  const refund = feeAbsorbed ? amountPence : amountPence - cardFeePence(amountPence);
  if (!Number.isInteger(refund) || refund <= 0 || refund > amountPence) {
    return null;
  }
  return refund;
}

/** Which ledger states a refund may start from. */
export type RefundableStatus = 'held' | 'superseded';

/**
 * Refund one reward payment, named by its intent id. By default accepts a
 * payment that is `held` (an expired hold) or `superseded` (renewed, or a
 * stray) — never anything else, and never a listing fee. Callers that mean
 * "the post's current reward" narrow it to `['held']`, so a renewal landing
 * between their read and this one cannot turn an owner's exit into a refund of
 * the payment that was just replaced.
 */
export async function refundPayment(
  admin: SupabaseClient,
  stripe: Stripe,
  options: { paymentIntentId: string; statuses?: readonly RefundableStatus[] },
): Promise<EscrowRefundOutcome> {
  const { paymentIntentId } = options;
  const statuses = options.statuses ?? ['held', 'superseded'];

  const { data: payment, error: paymentError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id, post_id, amount_pence, refund_fee_absorbed')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .in('status', statuses)
    // MONEY: kind, not just status. A fee is never held or superseded (ADR-0018
    // and payments_superseded_is_bounty_chk), so this is the SECOND lock — kept
    // deliberately: it is what still holds if anything ever puts a fee back
    // into one of those states. Do not remove it as dead weight.
    .eq('kind', 'bounty_escrow')
    .maybeSingle();

  if (paymentError) {
    console.error('[payments] payment lookup failed', paymentError.message);
    return { status: 'lookup_failed' };
  }
  if (!payment) {
    return { status: 'no_held_payment' };
  }

  const amountPence = payment.amount_pence as number;
  const postId = (payment.post_id as string | null) ?? '';
  const feeAbsorbed = payment.refund_fee_absorbed === true;

  // --- The amount: a function of the payment alone (ADR-0021) ----------------
  // The reward minus the FIXED card fee the owner was quoted before paying —
  // never Stripe's per-charge fee, which the owner could not have known. A
  // pure function of the ledger row, so every path and every retry under the
  // payment's idempotency key asks Stripe for the same amount.
  const refundPence = refundAmountPence(amountPence, feeAbsorbed);
  if (refundPence === null) {
    console.error('[payments] computed refund out of range', { amountPence, feeAbsorbed });
    return { status: 'stripe_error' };
  }
  const feePence = amountPence - refundPence;

  // --- A refund that already exists is THE refund ----------------------------
  // The idempotency key only converges retries inside Stripe's ~24-hour window
  // and only under the SAME key. A refund issued under the old per-post keys
  // before this deployed, or more than a day ago, would otherwise be retried
  // as a NEW request — which Stripe refuses (only the fee is left to refund),
  // so the payment would sit at stripe_error until a webhook happened to
  // reconcile it. Asking Stripe first makes every path converge on the refund
  // that already moved the money, whatever key or age it has. A failed or
  // canceled refund moved nothing and is ignored. A partial refund someone
  // made by hand in the dashboard counts too — it is recorded as the refund,
  // and the remainder is theirs to settle (docs/OPERATIONS.md §8), because
  // topping it up automatically would be this code inventing an amount. If
  // the lookup itself fails,
  // the create below is still safe: the key and Stripe's refundable-amount
  // cap both stand between it and a second refund.
  try {
    const existing = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 10 });
    const settled = existing.data.find((r) => r.status === 'succeeded' || r.status === 'pending');
    if (settled) {
      if (settled.amount < refundPence) {
        // A partial refund made by hand. It is recorded as THE refund (the
        // charge.refunded webhook would record it the same way), which takes
        // the payment out of the 75-day alert — so the remainder must be
        // flagged here or it sits on the balance unseen.
        console.error('[ops] ALERT partial refund recorded — the remainder is still on the platform balance', {
          paymentIntentId,
          refundedPence: settled.amount,
          expectedPence: refundPence,
        });
      }
      return {
        status: 'refunded',
        refundId: settled.id,
        refundPence: settled.amount,
        feePence: Math.max(amountPence - settled.amount, 0),
        paymentIntentId,
      };
    }
  } catch (err) {
    console.error('[payments] existing refund lookup failed', (err as Error).message);
  }

  // --- Issue the Stripe refund (idempotent — never a second refund) -----------
  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: refundPence,
        // Dashboard context only — nothing reads this back. Per payment, never
        // per path (see the header: a reused key must reuse its parameters).
        metadata: { post_id: postId },
      },
      { idempotencyKey: refundIdempotencyKey(paymentIntentId) },
    );
  } catch (err) {
    console.error('[payments] refund create failed', (err as Error).message);
    return { status: 'stripe_error' };
  }

  return {
    status: 'refunded',
    refundId: refund.id,
    refundPence,
    feePence,
    paymentIntentId,
  };
}

/**
 * Refund every superseded payment refunds_due lists for ONE post, and record
 * each — the webhook's best effort right after a renewal captures, so the old
 * reward goes home in minutes rather than at the next hourly sweep (which
 * remains the retry: this never throws and records nothing it did not refund).
 * Going through refunds_due, not a direct select, keeps its second lock (a
 * pre-existing dispute holds a renewal's old payment back) in force here too.
 */
export async function refundSupersededForPost(
  admin: SupabaseClient,
  stripe: Stripe,
  postId: string,
): Promise<number> {
  let refunded = 0;
  try {
    // Narrowed to this post IN SQL: the system-wide oldest-first list could be
    // filled by an older backlog before this post's row appeared in it.
    const { data: due, error } = await admin.rpc('refunds_due', { p_limit: 50, p_post_id: postId });
    if (error) {
      console.error('[payments] refunds_due failed (webhook)', error.message);
      return 0;
    }
    const rows = ((due ?? []) as { payment_intent_id: string; post_id: string | null; reason: string }[])
      .filter((row) => row.post_id === postId && row.reason === 'superseded');
    for (const row of rows) {
      const outcome = await refundPayment(admin, stripe, {
        paymentIntentId: row.payment_intent_id,
        statuses: ['superseded'],
      });
      if (outcome.status !== 'refunded') {
        continue;
      }
      const { error: recordError } = await admin.rpc('reconcile_payment_refund', {
        p_payment_intent_id: outcome.paymentIntentId,
        p_refund_id: outcome.refundId,
        p_refunded_amount_pence: outcome.refundPence,
      });
      if (recordError) {
        // Refund issued, record failed: the charge.refunded webhook and the
        // sweep both reconcile it under the same per-payment key.
        console.error('[payments] superseded refund record failed', recordError.message);
        continue;
      }
      refunded += 1;
    }
  } catch (err) {
    console.error('[payments] superseded refund failed (webhook)', (err as Error).message);
  }
  return refunded;
}

/**
 * Refund a post's HELD reward — the owner exits (`deactivate-post`,
 * `refund-recovery`). The one-held index guarantees at most one match.
 */
export async function refundHeldEscrow(
  admin: SupabaseClient,
  stripe: Stripe,
  options: { postId: string },
): Promise<EscrowRefundOutcome> {
  const { data: held, error: heldError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('post_id', options.postId)
    .eq('status', 'held')
    // MONEY: the second lock, as in refundPayment.
    .eq('kind', 'bounty_escrow')
    .maybeSingle();

  if (heldError) {
    console.error('[payments] held payment lookup failed', heldError.message);
    return { status: 'lookup_failed' };
  }
  if (!held) {
    return { status: 'no_held_payment' };
  }
  return refundPayment(admin, stripe, {
    paymentIntentId: held.stripe_payment_intent_id as string,
    // Still the reward when we refund it — see refundPayment.
    statuses: ['held'],
  });
}
