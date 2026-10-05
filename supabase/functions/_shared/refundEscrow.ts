/**
 * WHAT:  The one implementation of "refund a reward payment": read the payment
 *        from the ledger, read the non-recoverable Stripe fee authoritatively,
 *        guard the arithmetic, and issue the refund under the PAYMENT's
 *        idempotency key. `refundPayment` refunds one named payment (the sweep's
 *        superseded and held-refund paths); `refundHeldEscrow` finds a post's
 *        held reward and refunds that (the two owner exits).
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
 *        (bounty minus the exact fee, or the full amount when
 *        `refund_fee_absorbed`) and the metadata (`post_id`, nothing per-path)
 *        are both derived here from the ledger row — never passed in. That is
 *        why the old `metadata: { reason }` option is gone: the reason a refund
 *        happened is recorded in the ledger (the hold's exit_path, the
 *        superseded status), which is the only place anything reads it.
 *
 * MONEY: the caller never says how much. The bounty comes from the ledger, the
 *        withheld fee from Stripe's own balance transaction, and this FAILS
 *        CLOSED if that fee cannot be read — a guessed amount that later
 *        disagrees with a retry under the same idempotency key bricks the
 *        refund at Stripe, and an over-guess over-refunds. The range guard
 *        (0 < refund <= bounty) is the last line before money moves. Fees
 *        (`listing_fee`) are never refunded: the ledger read filters on kind.
 * LINKS: supabase/functions/deactivate-post/index.ts;
 *        supabase/functions/refund-recovery/index.ts;
 *        supabase/functions/release-held-refunds/index.ts (the sweep);
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
  /** Stripe refused, or the authoritative fee was unavailable. Retryable. */
  | { status: 'stripe_error' };

/** THE refund key. Exported so the tests pin its exact shape: changing it
 *  while a refund is in flight would mint a second refund request. */
export function refundIdempotencyKey(paymentIntentId: string): string {
  return `payment-refund-${paymentIntentId}`;
}

/**
 * The refund for one payment, in pence. Pure, and the ONLY place the amount is
 * decided: `refundPayment` uses it, and the tests pin it.
 *   - absorbed  → the full amount (a stray capture, or a reward taken under
 *                 the pre-term Terms — the platform eats the fee);
 *   - otherwise → the amount minus Stripe's exact fee (the owner bears the
 *                 non-refundable card cost, as disclosed before they paid).
 * Returns null when the result would be out of range (0 < refund <= amount).
 */
export function refundAmountPence(
  amountPence: number,
  feePence: number,
  feeAbsorbed: boolean,
): number | null {
  const refund = feeAbsorbed ? amountPence : amountPence - feePence;
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

  // --- The authoritative Stripe fee (never guessed) ---------------------------
  // Stripe does not return the processing fee on a refund, so the platform is
  // made whole by withholding the EXACT fee from the charge's balance
  // transaction. It is read even when the fee is absorbed: an unreadable charge
  // is a reason to wait, not to refund blind.
  let feePence: number | null = null;
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    });
    const charge = intent.latest_charge as Stripe.Charge | null;
    const balanceTxn = charge?.balance_transaction as Stripe.BalanceTransaction | null;
    if (balanceTxn && typeof balanceTxn.fee === 'number') {
      feePence = balanceTxn.fee;
    }
  } catch (err) {
    console.error('[payments] fee lookup failed', (err as Error).message);
  }
  if (feePence === null) {
    console.error('[payments] no authoritative fee available', { paymentIntentId });
    return { status: 'stripe_error' };
  }

  const refundPence = refundAmountPence(amountPence, feePence, feeAbsorbed);
  if (refundPence === null) {
    console.error('[payments] computed refund out of range', { amountPence, feePence, feeAbsorbed });
    return { status: 'stripe_error' };
  }

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
    feePence: feeAbsorbed ? 0 : feePence,
    paymentIntentId,
  };
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
