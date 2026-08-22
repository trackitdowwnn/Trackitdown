/**
 * WHAT:  The one implementation of "refund a post's held escrow": find the held
 *        charge, read the non-recoverable Stripe fee authoritatively, guard the
 *        arithmetic, and issue the refund under the caller's idempotency key.
 * WHY:   This sequence existed twice, line-for-line, in `deactivate-post` and
 *        `refund-recovery` — and the refund-hold sweep would have made three.
 *        Three copies of the money arithmetic is how one of them drifts. What
 *        stays WITH the callers is everything that makes them different: the
 *        state they accept, the state they produce (`mark_post_payment_refunded`
 *        vs `mark_post_recovered_no_spotter`), their error vocabulary, and —
 *        critically — their idempotency key. The key is an argument, never
 *        derived here: `post-refund-<id>` and `recovery-refund-<id>` are
 *        distinct on purpose (one post could be cancelled and later recovered;
 *        a shared key would return the FIRST refund for the second request),
 *        and the sweep must reuse the exact key the immediate path would have
 *        used so a partial failure retries into the SAME Stripe refund.
 *
 * MONEY: the caller never says how much. The bounty comes from the ledger, the
 *        withheld fee from Stripe's own balance transaction, and this FAILS
 *        CLOSED if that fee cannot be read — a guessed amount that later
 *        disagrees with a retry under the same idempotency key bricks the
 *        refund at Stripe, and an over-guess over-refunds. The range guard
 *        (0 < refund <= bounty) is the last line before money moves.
 * LINKS: supabase/functions/deactivate-post/index.ts;
 *        supabase/functions/refund-recovery/index.ts;
 *        supabase/functions/release-held-refunds/index.ts (the sweep);
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
  /** No payment in `held` for this post — for the sweep this simply means
   *  "already released"; for the interactive callers it is an anomaly. */
  | { status: 'no_held_payment' }
  /** A database read failed. Retryable. */
  | { status: 'lookup_failed' }
  /** Stripe refused, or the authoritative fee was unavailable. Retryable. */
  | { status: 'stripe_error' };

export async function refundHeldEscrow(
  admin: SupabaseClient,
  stripe: Stripe,
  options: {
    postId: string;
    /** The CALLER's key — see the header for why it is never derived here. */
    idempotencyKey: string;
    metadata?: Record<string, string>;
  },
): Promise<EscrowRefundOutcome> {
  const { postId, idempotencyKey } = options;

  // --- The held escrow --------------------------------------------------------
  // A paid post has exactly one held payment. The authoritative amount comes
  // from the ledger, never from anything a client sent.
  const { data: held, error: heldError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id, amount_pence')
    .eq('post_id', postId)
    // MONEY: kind, not just status. `payments` carries BOTH shapes since
    // 20260819100000 — an escrowed bounty and a £5 listing fee — and that
    // migration's own header says the four refund/payout selectors would be
    // narrowed to bounty_escrow "in the same change". They never were: that
    // half was written somewhere this repo has never seen. Without it a fee
    // reaching 'held' is refunded automatically, by an hourly cron, days
    // later, with nobody watching — the exact failure that migration was
    // written to prevent. A fee is revenue on capture: never refunded, never
    // transferred, no payout leg.
    .eq('status', 'held')
    .eq('kind', 'bounty_escrow')
    .maybeSingle();

  if (heldError) {
    console.error('[payments] held payment lookup failed', heldError.message);
    return { status: 'lookup_failed' };
  }
  if (!held) {
    return { status: 'no_held_payment' };
  }

  const paymentIntentId = held.stripe_payment_intent_id as string;
  const amountPence = held.amount_pence as number;

  // --- The authoritative Stripe fee (never guessed) ---------------------------
  // Stripe does not return the processing fee on a refund, so the platform is
  // made whole by withholding the EXACT fee from the charge's balance
  // transaction. For an auto-captured, long-settled escrow it is always
  // available; if it isn't yet, the caller retries.
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
    console.error('[payments] no authoritative fee available', { postId });
    return { status: 'stripe_error' };
  }

  // Guard: the refund must be a positive amount no larger than the bounty.
  const refundPence = amountPence - feePence;
  if (refundPence <= 0 || refundPence > amountPence) {
    console.error('[payments] computed refund out of range', { amountPence, feePence });
    return { status: 'stripe_error' };
  }

  // --- Issue the Stripe refund (idempotent — never a second refund) -----------
  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: refundPence,
        metadata: { post_id: postId, ...options.metadata },
      },
      { idempotencyKey },
    );
  } catch (err) {
    console.error('[payments] refund create failed', (err as Error).message);
    return { status: 'stripe_error' };
  }

  return { status: 'refunded', refundId: refund.id, refundPence, feePence, paymentIntentId };
}
