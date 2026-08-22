/**
 * WHAT:  The payout core — everything between "this post has a credited
 *        spotter" and "the transfer exists and is recorded", as one function
 *        with two callers.
 * WHY:   Auto-release. Until now the owner had to come back and tap "Send the
 *        bounty" after the spotter onboarded — the copy admitted it, and the
 *        realistic steady state was money waiting on a tap nobody knew to
 *        make. Now the WEBHOOK releases the moment the payee becomes payable
 *        (and the create path releases immediately when Stripe activates a
 *        clean account on the spot). Two triggers plus the owner's manual
 *        retry = three callers, and three copies of money logic is how one
 *        drifts — so there is exactly one, here.
 *
 * MONEY: unchanged invariants, now in one place:
 *        - the COLLUSION GATE runs on every path. An automatic releaser
 *          without it would be the fraud check switching itself off at the
 *          exact moment money moves — this is why the gate was built first.
 *        - `post-payout-{postId}` idempotency: the owner tapping while the
 *          webhook fires cannot double-pay; Stripe returns the same transfer.
 *        - the 95/5 split is computed here and independently re-derived (and
 *          rejected on mismatch) by mark_recovery_paid.
 *        - a post that is not `recovery_claimed` is a NO-OP ('not_claimed'),
 *          which is what makes concurrent triggers safe to fire blindly.
 * LINKS: supabase/functions/release-payout/index.ts (owner-invoked caller);
 *        supabase/functions/stripe-webhook/index.ts (payable-event caller);
 *        supabase/functions/create-payout-account/index.ts (instant caller);
 *        ./collusion.ts; supabase/migrations/20260802220000_release_payout.sql.
 */

import type Stripe from 'npm:stripe@22.4.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

import { collusionGate } from './collusion.ts';
import {
  announceNotCredited,
  announcePayoutSent,
  announceRecoveryToWatchers,
} from './recoveryAnnounce.ts';

/**
 * The canonical split, mirroring `payout_split` in SQL. Integer arithmetic —
 * `* 95 / 100`, never `* 0.95` — and the fee is the REMAINDER so the two
 * halves always add back to the bounty exactly. This duplication is deliberate
 * and is not drift waiting to happen: we need the number here to create the
 * transfer, and the RPC recomputes it and refuses anything else. Two
 * independent derivations that must agree.
 */
export function splitBounty(bountyPence: number): { transferPence: number; feePence: number } {
  const transferPence = Math.round((bountyPence * 95) / 100);
  return { transferPence, feePence: bountyPence - transferPence };
}

export type ReleaseOutcome =
  | { status: 'paid'; transferPence: number; feePence: number }
  | { status: 'awaiting_payee' }
  | { status: 'held_for_review' }
  /** Post is not `recovery_claimed` — nothing to do. The no-op that makes
   *  blind concurrent triggering safe (a second trigger after success lands
   *  here, because the post is `recovered` by then). */
  | { status: 'not_claimed' }
  | {
      status: 'error';
      code:
        | 'LOOKUP_FAILED'
        | 'NO_CREDITED_SIGHTING'
        | 'NO_HELD_PAYMENT'
        | 'SPLIT_ERROR'
        | 'STRIPE_ERROR'
        | 'LEDGER_ERROR';
    };

/**
 * Release the payout for a post, if everything is true that must be. Callers
 * decide authorisation BEFORE calling (the owner function verifies ownership;
 * the webhook trusts the credited row it just made payable); this function
 * decides everything about the money.
 */
export async function releasePayoutForPost(
  admin: SupabaseClient,
  stripe: Stripe,
  postId: string,
): Promise<ReleaseOutcome> {
  // --- The one acceptable state ----------------------------------------------
  const { data: post, error: postError } = await admin
    .from('posts')
    .select('owner_id, status, bounty_amount_pence')
    .eq('id', postId)
    .maybeSingle();
  if (postError || !post) {
    if (postError) console.error('[payments] post lookup failed', postError.message);
    return { status: 'error', code: 'LOOKUP_FAILED' };
  }
  if (post.status !== 'recovery_claimed') {
    return { status: 'not_claimed' };
  }
  // MONEY: a no-bounty listing has nothing to release (ADR-0014). Already
  // unreachable twice over — claim_recovery lands a fee post on a terminal state
  // so it is never `recovery_claimed`, and its payment is `collected` rather than
  // `held` so the escrow lookup below would find nothing — but this is the money
  // boundary, so it re-checks, exactly as claim_recovery re-checks self-crediting.
  // Answering `not_claimed` rather than an error is deliberate: this is a no-op,
  // not a failure, and the webhook's blind auto-release calls it for every post a
  // newly-payable spotter touched.
  if (post.bounty_amount_pence === null) {
    return { status: 'not_claimed' };
  }

  // --- Who won ----------------------------------------------------------------
  const { data: credited, error: creditedError } = await admin
    .from('sightings')
    .select('id, spotter_id')
    .eq('post_id', postId)
    .eq('status', 'credited')
    .maybeSingle();
  if (creditedError) {
    console.error('[payments] credited sighting lookup failed', creditedError.message);
    return { status: 'error', code: 'LOOKUP_FAILED' };
  }
  if (!credited) {
    // No winner — this recovery's ending is a refund, not a payout.
    return { status: 'error', code: 'NO_CREDITED_SIGHTING' };
  }

  // --- The collusion gate (SECURITY_AND_TRUST §5) -----------------------------
  // On EVERY path, including the automatic ones — especially the automatic
  // ones. Before payee readiness on purpose: a flagged pair is told "we're
  // double-checking" up front, not after five minutes of KYC for a transfer
  // that was never going to run.
  const gate = await collusionGate(admin, stripe, {
    postId,
    ownerId: post.owner_id as string,
    spotterId: credited.spotter_id as string,
    paymentIntentId: null,
  });
  if (gate === 'held') {
    console.log('[payments] payout held for review', { postId });
    return { status: 'held_for_review' };
  }
  if (gate === 'error') {
    return { status: 'error', code: 'LOOKUP_FAILED' };
  }

  // --- Can they actually receive it? ------------------------------------------
  const { data: connect } = await admin
    .from('stripe_connected_accounts')
    .select('id, stripe_account_id, payouts_enabled')
    .eq('profile_id', credited.spotter_id)
    .maybeSingle();
  if (!connect || !connect.payouts_enabled) {
    // NOT an error. The bounty stays in escrow until they are payable; the
    // webhook trigger runs this again at that exact moment.
    console.log('[payments] payout waiting on payee onboarding', { postId });
    return { status: 'awaiting_payee' };
  }

  // --- The held escrow --------------------------------------------------------
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
    return { status: 'error', code: 'LOOKUP_FAILED' };
  }
  if (!held) {
    return { status: 'error', code: 'NO_HELD_PAYMENT' };
  }

  const paymentIntentId = held.stripe_payment_intent_id as string;
  const bountyPence = held.amount_pence as number;
  const { transferPence, feePence } = splitBounty(bountyPence);

  // Defensive: a transfer must be a positive amount no larger than the bounty.
  if (transferPence <= 0 || transferPence > bountyPence) {
    console.error('[payments] computed transfer out of range', { bountyPence, transferPence });
    return { status: 'error', code: 'SPLIT_ERROR' };
  }

  // --- Transfer (idempotent — never a second payout) --------------------------
  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create(
      {
        amount: transferPence,
        currency: 'gbp',
        destination: connect.stripe_account_id as string,
        // No `source_transaction`: that ties a transfer to one charge's funds
        // and waits for them to settle. Under separate charges and transfers
        // (ADR-0002) the bounty is already on the platform balance, and the
        // dispute-reversal protection comes from the connected account's
        // `losses_collector: "application"`, not from linking the charge.
        transfer_group: postId,
        metadata: { post_id: postId, sighting_id: credited.id },
      },
      // ONE payout per post, forever. A retry after a dropped response — or the
      // owner and the webhook racing — returns the SAME transfer.
      { idempotencyKey: `post-payout-${postId}` },
    );
  } catch (err) {
    console.error('[payments] transfer create failed', (err as Error).message);
    return { status: 'error', code: 'STRIPE_ERROR' };
  }

  // --- Record it (idempotent, never-regress, split re-checked) -----------------
  const { error: rpcError } = await admin.rpc('mark_recovery_paid', {
    p_payment_intent_id: paymentIntentId,
    p_transfer_id: transfer.id,
    p_payee_account_id: connect.id,
    p_transfer_amount_pence: transferPence,
    p_platform_fee_pence: feePence,
  });
  if (rpcError) {
    // The transfer SUCCEEDED but we couldn't record it. Retryable: the
    // idempotency key reuses the same transfer and the RPC never regresses.
    console.error('[payments] mark_recovery_paid failed', rpcError.message);
    return { status: 'error', code: 'LEDGER_ERROR' };
  }

  console.log('[payments] bounty released', { postId, transferPence, feePence });

  // The news, AFTER the money landed: "on its way" to the spotter, the
  // watchers' recovery announcement, and the ending owed to every OTHER
  // spotter who reported this car. All three best-effort and claim-guarded —
  // never a reason to report the payout as anything but paid.
  //
  // not_credited belongs HERE and only here: this is the one code path that
  // credits somebody, and firing on the completed payout (rather than at
  // claim_recovery) means nobody is ever told "another spotter was credited"
  // for a credit that then sits unpaid forever behind an un-onboarded payee.
  await announcePayoutSent(admin, postId);
  await announceRecoveryToWatchers(admin, postId);
  await announceNotCredited(admin, postId);

  return { status: 'paid', transferPence, feePence };
}

/**
 * The automatic trigger: release everything this spotter is owed. Called when
 * a payee BECOMES payable (webhook) or is payable at creation. Never throws —
 * an automatic release failing must not fail the event that triggered it; the
 * owner's manual retry remains the recovery path and every failure is logged.
 */
export async function releaseAllPendingFor(
  admin: SupabaseClient,
  stripe: Stripe,
  spotterId: string,
): Promise<void> {
  try {
    const { data: pending, error } = await admin
      .from('sightings')
      .select('post_id, posts!inner(status)')
      .eq('spotter_id', spotterId)
      .eq('status', 'credited')
      .eq('posts.status', 'recovery_claimed');
    if (error) {
      console.error('[payments] pending credit lookup failed', error.message);
      return;
    }
    for (const row of pending ?? []) {
      const outcome = await releasePayoutForPost(admin, stripe, row.post_id as string);
      console.log('[payments] auto-release attempted', {
        postId: row.post_id,
        status: outcome.status,
      });
    }
  } catch (err) {
    console.error('[payments] auto-release failed', (err as Error).message);
  }
}
