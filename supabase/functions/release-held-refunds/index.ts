/**
 * WHAT:  The hold sweep — the cron target that finishes what the 72-hour
 *        window started. Phase 1: expired, undisputed holds get the refund
 *        the owner asked for. Phase 2: upheld disputes get the spotter paid
 *        (through the existing release core) and every resolved dispute gets
 *        its outcome push.
 * WHY:   A hold is a promise with a date on it: "your refund is sent after
 *        {date} unless a sighting is contested". Nothing else in the system
 *        acts on the clock — there is no scheduler anywhere until this — so
 *        without the sweep that promise is a lie and the money strands.
 *        Invoked hourly by Supabase Cron, and safely by hand: everything here
 *        is idempotent (refunds under the SAME per-path key the immediate
 *        exit would have used, payouts under post-payout-{id}, pushes behind
 *        conditional-update claims), so double-invocation does nothing twice.
 *
 * MONEY: the sweep decides WHEN, never HOW MUCH. Refund arithmetic lives in
 *        _shared/refundEscrow.ts (authoritative fee, range guard); the payout
 *        lives in _shared/releasePayout.ts (collusion gate, 95/5 via
 *        payout_split, mark_recovery_paid). An OPEN or UPHELD dispute blocks
 *        Phase 1 — upheld permanently: that money is being paid the other way.
 *
 * SAFETY: not user-invocable. No JWT path — the caller must present the
 *        CRON_SECRET header, and a miss is a flat 401 with no detail. Per-item
 *        failures are logged and skipped, never thrown: one broken hold must
 *        not stop the rest of the queue, and the next run retries it.
 * LINKS: supabase/migrations/20260805100000_refund_holds_and_disputes.sql;
 *        _shared/refundEscrow.ts, _shared/releasePayout.ts, _shared/push.ts;
 *        docs/decisions/ADR-0011-refund-holds-and-disputes.md (cron setup).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { refundHeldEscrow } from '../_shared/refundEscrow.ts';
import { releasePayoutForPost } from '../_shared/releasePayout.ts';
import { sendToUsers } from '../_shared/push.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  // The one gate. A missing env var fails CLOSED (nothing matches undefined).
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return errorResponse('NOT_AUTHENTICATED', 'Not allowed.', 401);
  }

  const admin = createServiceRoleClient();
  const stripe = createStripeClient();
  const summary = { refunded: 0, paid: 0, notified: 0, skipped: 0 };

  // --- Phase 1: expired, undisputed holds → the owner's refund ---------------
  // "Released" is derived, not stored: a hold whose payment is no longer
  // `held` simply stops matching this query. That is the idempotency.
  const { data: due, error: dueError } = await admin
    .from('refund_holds')
    .select('post_id, exit_path, payments!inner(status)')
    .lt('expires_at', new Date().toISOString())
    .eq('payments.status', 'held');

  if (dueError) {
    console.error('[payments] hold sweep query failed', dueError.message);
  }
  for (const hold of due ?? []) {
    const postId = hold.post_id as string;
    const exitPath = hold.exit_path as 'deactivate' | 'recovery';
    try {
      // An open dispute pauses the refund; an upheld one forecloses it —
      // that money is going to the spotter in Phase 2.
      const { count: blocking, error: blockError } = await admin
        .from('refund_disputes')
        .select('id', { count: 'exact', head: true })
        .eq('post_id', postId)
        .in('status', ['open', 'upheld']);
      if (blockError) {
        console.error('[payments] dispute check failed', { postId });
        summary.skipped += 1;
        continue;
      }
      if ((blocking ?? 0) > 0) {
        summary.skipped += 1;
        continue;
      }

      // THE SAME KEY the immediate exit would have used: if the owner's
      // original request died after Stripe but before the ledger, this
      // retries into that refund instead of minting a second one.
      const outcome = await refundHeldEscrow(admin, stripe, {
        postId,
        idempotencyKey: exitPath === 'deactivate' ? `post-refund-${postId}` : `recovery-refund-${postId}`,
        metadata: exitPath === 'recovery' ? { reason: 'recovered_no_spotter' } : undefined,
      });
      if (outcome.status !== 'refunded') {
        // no_held_payment = already released between query and here; the
        // others retry next run.
        summary.skipped += 1;
        continue;
      }

      const rpc =
        exitPath === 'deactivate' ? 'mark_post_payment_refunded' : 'mark_post_recovered_no_spotter';
      const { error: rpcError } = await admin.rpc(rpc, {
        p_payment_intent_id: outcome.paymentIntentId,
        p_refund_id: outcome.refundId,
        p_refunded_amount_pence: outcome.refundPence,
      });
      if (rpcError) {
        // Refund issued, record failed: the idempotency key + never-regress
        // RPC + charge.refunded webhook make the next run safe.
        console.error('[payments] hold sweep record failed', { postId, error: rpcError.message });
        summary.skipped += 1;
        continue;
      }
      console.log('[payments] held refund released', { postId, exitPath });
      summary.refunded += 1;
    } catch (err) {
      console.error('[payments] hold sweep item failed', { postId, error: (err as Error).message });
      summary.skipped += 1;
    }
  }

  // --- Phase 2a: upheld disputes → pay the spotter ---------------------------
  // The payable-webhook is the instant trigger (a newly-payable spotter
  // releases immediately); this is the retry loop behind it, and the path for
  // spotters who were already payable when the dispute was upheld.
  const { data: upheld, error: upheldError } = await admin
    .from('refund_disputes')
    .select('id, post_id, posts!inner(status)')
    .eq('status', 'upheld')
    .eq('posts.status', 'recovery_claimed');

  if (upheldError) {
    console.error('[payments] upheld sweep query failed', upheldError.message);
  }
  for (const dispute of upheld ?? []) {
    const postId = dispute.post_id as string;
    try {
      const outcome = await releasePayoutForPost(admin, stripe, postId);
      if (outcome.status === 'paid') {
        console.log('[payments] upheld dispute paid', { postId });
        summary.paid += 1;
      }
    } catch (err) {
      // awaiting_payee is the normal wait; real failures log and retry.
      console.error('[payments] upheld payout attempt failed', {
        postId,
        error: (err as Error).message,
      });
    }
  }

  // --- Phase 2b: outcome pushes for every resolved, unnotified dispute -------
  const { data: resolved, error: resolvedError } = await admin
    .from('refund_disputes')
    .select('id')
    .in('status', ['upheld', 'rejected'])
    .is('outcome_notified_at', null);

  if (resolvedError) {
    console.error('[payments] outcome sweep query failed', resolvedError.message);
  }
  for (const dispute of resolved ?? []) {
    try {
      const { data: claim, error: claimError } = await admin.rpc(
        'claim_dispute_outcome_notification',
        { p_dispute_id: dispute.id },
      );
      if (claimError || !(claim as { claimed?: boolean })?.claimed) {
        continue; // claimed by a concurrent run, or nothing to send
      }
      const doc = claim as {
        kind: 'dispute_upheld' | 'dispute_rejected';
        user_id: string;
        sighting_id: string;
        title: string;
        body: string;
      };
      await sendToUsers(admin, [doc.user_id], {
        title: doc.title,
        body: doc.body,
        data: { type: doc.kind, sightingId: doc.sighting_id },
        collapseKey: `${doc.kind}:${doc.sighting_id}`,
      });
      summary.notified += 1;
    } catch (err) {
      // The claim is consumed; the push is lost. Acceptable: the dispute
      // screen shows the same truth on next open, and losing a push must
      // never re-run a claim (that way lies double-sends).
      console.error('[payments] outcome push failed', {
        disputeId: dispute.id,
        error: (err as Error).message,
      });
    }
  }

  console.log('[payments] hold sweep done', summary);
  return jsonResponse(summary);
});
