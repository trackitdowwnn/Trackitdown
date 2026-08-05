/**
 * WHAT:  The pre-payout collusion gate — decides whether a credited payout may
 *        proceed, must be held for manual review, or has already been reviewed.
 * WHY:   SECURITY_AND_TRUST §5: an owner can post a bounty, "sight" their own
 *        car from a second account, credit it, and transfer 95% of their own
 *        escrow back to themselves — laundering with our card fees as the only
 *        cost. The same-PROFILE version is already impossible
 *        (CANNOT_CREDIT_OWN_SIGHTING in claim_recovery); this gate exists for
 *        the two-account version of the same person.
 *
 *        THE SIGNALS, and why exactly these three:
 *        - shared_device: the device_links ledger records a push token moving
 *          between accounts — the same handset signed into both. This is THE
 *          signal for the laziest (and therefore most common) fraud shape.
 *        - shared_card: the card fingerprint behind THIS bounty's escrow charge
 *          matches a card the spotter has used to pay for their own posts.
 *          Fingerprints are Stripe's own cross-account card identity.
 *        - matching_email: the two accounts' emails normalise to the same
 *          address (case, +tags, and gmail's ignored dots). Catches
 *          oliver+a@gmail vs o.liver@gmail.
 *        NOT a signal, deliberately: signup IP. We store none, the only source
 *        (auth audit logs) is undocumented schema, and UK mobile carriers CGNAT
 *        thousands of users onto one IP — the false-positive rate would drown
 *        the true positives at any volume we will ever have.
 *
 *        FAIL CLOSED. If any signal cannot be evaluated (our DB, Stripe, the
 *        auth API), the answer is 'error' — a retryable LOOKUP_FAILED — never
 *        "assume innocent". Auto-release (ADR-0010) will call this from a
 *        webhook; a fail-open gate plus an outage would be a fraud check that
 *        silently switches itself off, which is worse than no check because it
 *        is trusted.
 *
 *        Honest limits, on the record: two phones, two cards and two unrelated
 *        emails defeat all three signals. This gate raises the cost of fraud
 *        from zero to "maintain genuinely separate identities"; it does not
 *        make fraud impossible. At v1 volume every hold is read by a human.
 * LINKS: supabase/migrations/20260803140000_payout_collusion_check.sql
 *          (payout_reviews, device_links, shared_device_exists,
 *          flag_payout_for_review);
 *        supabase/functions/release-payout/index.ts (the caller);
 *        docs/SECURITY_AND_TRUST.md §5; docs/decisions/ADR-0010.
 */

import type Stripe from 'npm:stripe@22.4.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export type CollusionVerdict = 'clear' | 'held' | 'error';

interface GateInput {
  postId: string;
  ownerId: string;
  spotterId: string;
  /** Unused today (resolved from the ledger); kept so the auto-release caller
   *  can pass what it already holds and skip a read. */
  paymentIntentId: string | null;
}

/**
 * Normalise an email far enough to catch trivial aliasing, no further.
 * Lowercase; strip a +tag; for gmail domains also strip dots (gmail ignores
 * them, so o.liver and oliver are one inbox). Anything cleverer belongs to a
 * human reading the review row.
 */
export function normaliseEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 0) {
    return lower;
  }
  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) {
    local = local.slice(0, plus);
  }
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

/** The card fingerprint behind a PaymentIntent's charge, or null. */
async function chargeFingerprint(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<string | null> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge'],
  });
  const charge = intent.latest_charge as Stripe.Charge | null;
  return charge?.payment_method_details?.card?.fingerprint ?? null;
}

/**
 * Run the gate. 'clear' → proceed to transfer; 'held' → a review row exists
 * (new or unresolved or rejected) and the caller answers `held_for_review`;
 * 'error' → something could not be evaluated, retry later.
 */
export async function collusionGate(
  admin: SupabaseClient,
  stripe: Stripe,
  input: GateInput,
): Promise<CollusionVerdict> {
  try {
    // --- An existing review outranks everything -------------------------------
    const { data: review, error: reviewError } = await admin
      .from('payout_reviews')
      .select('resolution')
      .eq('post_id', input.postId)
      .maybeSingle();
    if (reviewError) {
      console.error('[payments] collusion review lookup failed', reviewError.message);
      return 'error';
    }
    if (review) {
      // Approved by a human → the gate never re-runs; the signals were judged.
      // Pending or rejected → held. 'rejected' deliberately does NOT refund:
      // in the shape this catches, the refund-claimant is the fraudster.
      return review.resolution === 'approved' ? 'clear' : 'held';
    }

    const reasons: string[] = [];

    // --- Signal 1: same handset, ever ----------------------------------------
    const { data: sharedDevice, error: deviceError } = await admin.rpc(
      'shared_device_exists',
      { p_user_a: input.ownerId, p_user_b: input.spotterId },
    );
    if (deviceError) {
      console.error('[payments] collusion device check failed', deviceError.message);
      return 'error';
    }
    if (sharedDevice === true) {
      reasons.push('shared_device');
    }

    // --- Signal 2: same person's inbox ----------------------------------------
    const [ownerUser, spotterUser] = await Promise.all([
      admin.auth.admin.getUserById(input.ownerId),
      admin.auth.admin.getUserById(input.spotterId),
    ]);
    if (ownerUser.error || spotterUser.error) {
      console.error('[payments] collusion email check failed');
      return 'error';
    }
    const ownerEmail = ownerUser.data.user?.email;
    const spotterEmail = spotterUser.data.user?.email;
    if (
      ownerEmail &&
      spotterEmail &&
      normaliseEmail(ownerEmail) === normaliseEmail(spotterEmail)
    ) {
      reasons.push('matching_email');
    }

    // --- Signal 3: same card --------------------------------------------------
    // The card behind THIS post's escrow vs cards the spotter has paid with on
    // their own posts. Bounded to the three most recent so a payout costs at
    // most four Stripe reads.
    const { data: held, error: heldError } = await admin
      .from('payments')
      .select('stripe_payment_intent_id')
      .eq('post_id', input.postId)
      .eq('status', 'held')
      .maybeSingle();
    if (heldError) {
      console.error('[payments] collusion payment lookup failed', heldError.message);
      return 'error';
    }
    if (held) {
      const { data: spotterPayments, error: spotterPaymentsError } = await admin
        .from('payments')
        .select('stripe_payment_intent_id, posts!inner(owner_id)')
        .eq('posts.owner_id', input.spotterId)
        .in('status', ['held', 'released', 'refunded'])
        .order('created_at', { ascending: false })
        .limit(3);
      if (spotterPaymentsError) {
        console.error(
          '[payments] collusion spotter payments lookup failed',
          spotterPaymentsError.message,
        );
        return 'error';
      }

      if (spotterPayments && spotterPayments.length > 0) {
        const ownerFingerprint = await chargeFingerprint(
          stripe,
          held.stripe_payment_intent_id as string,
        );
        if (ownerFingerprint) {
          for (const payment of spotterPayments) {
            const fingerprint = await chargeFingerprint(
              stripe,
              payment.stripe_payment_intent_id as string,
            );
            if (fingerprint && fingerprint === ownerFingerprint) {
              reasons.push('shared_card');
              break;
            }
          }
        }
      }
    }

    // --- Verdict --------------------------------------------------------------
    if (reasons.length === 0) {
      return 'clear';
    }
    const { error: flagError } = await admin.rpc('flag_payout_for_review', {
      p_post_id: input.postId,
      p_owner_id: input.ownerId,
      p_spotter_id: input.spotterId,
      p_reasons: reasons,
    });
    if (flagError) {
      console.error('[payments] collusion flag write failed', flagError.message);
      return 'error';
    }
    // Machine words only — never emails, tokens, or fingerprints.
    console.log('[payments] payout flagged for review', {
      postId: input.postId,
      reasons,
    });
    return 'held';
  } catch (err) {
    // Includes Stripe retrieve failures. Fail closed — see the header.
    console.error('[payments] collusion gate failed', (err as Error).message);
    return 'error';
  }
}
