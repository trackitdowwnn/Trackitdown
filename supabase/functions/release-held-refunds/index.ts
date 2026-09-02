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
import { notifyUsers } from '../_shared/push.ts';
import { announcePayoutSent, announceRecoveryToWatchers } from '../_shared/recoveryAnnounce.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  // The one gate. Two acceptable secrets, both fail CLOSED when unset:
  // the Vault-held `cron_secret` (what the pg_cron job sends — generated and
  // rotated entirely inside Postgres, never in git or a transcript) and the
  // CRON_SECRET env var (manual invocation). A header matching neither, or
  // no header, is a flat 401 with no detail.
  const admin = createServiceRoleClient();
  const header = request.headers.get('x-cron-secret');
  const envSecret = Deno.env.get('CRON_SECRET');
  let vaultSecret: string | null = null;
  try {
    const { data } = await admin.rpc('read_cron_secret');
    vaultSecret = typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    // Vault unreadable → that source simply cannot match.
  }
  const allowed = Boolean(
    header && ((envSecret && header === envSecret) || (vaultSecret && header === vaultSecret)),
  );
  if (!allowed) {
    return errorResponse('NOT_AUTHENTICATED', 'Not allowed.', 401);
  }
  const stripe = createStripeClient();
  const summary = {
    refunded: 0,
    paid: 0,
    notified: 0,
    skipped: 0,
    purged: 0,
    locationsPurged: 0,
    photosRemoved: 0,
  };

  // --- Phase 0: feed retention (ADR-0012 §8) ---------------------------------
  // 90 days, anchored HERE so retention runs wherever the sweep runs; the
  // dashboard's daily purge job is the belt. Best-effort like everything else.
  try {
    const { data: purged, error: purgeError } = await admin.rpc('purge_old_notifications');
    if (purgeError) {
      console.error('[notifications] purge failed', purgeError.message);
    } else {
      summary.purged = typeof purged === 'number' ? purged : 0;
    }
  } catch (err) {
    console.error('[notifications] purge failed', (err as Error).message);
  }

  // --- Phase 0b: sighting location retention --------------------------------
  // ⚠️ THIS ONE KEEPS A PROMISE THE PRIVACY POLICY MAKES. "The detailed
  // location history attached to a closed listing's sightings is deleted after
  // 90 days" — and until 2026-09-01 nothing performed it. Nulls the
  // capture-time GPS on photos whose post closed over 90 days ago; the photo,
  // the image and the coarse area_label all stay.
  //
  // Anchored here for the same reason as the notification purge above: pg_cron
  // schedules THIS FUNCTION, not the purge RPCs, so the hourly sweep is the
  // only thing that runs them on a clock. That also means retention stops
  // silently if this function stops firing — worth monitoring precisely because
  // what it silently stops is a published commitment about location data. A
  // pg_cron entry calling the RPC directly would decouple the two.
  //
  // Counted separately from `purged` so a log line can tell which retention job
  // did what; failure is logged and swallowed, like everything else in the
  // sweep, because a retention error must not block refunds and payouts.
  try {
    const { data: locationsPurged, error: locationError } = await admin.rpc(
      'purge_sighting_location_history',
    );
    if (locationError) {
      console.error('[sightings] location purge failed', locationError.message);
    } else {
      summary.locationsPurged = typeof locationsPurged === 'number' ? locationsPurged : 0;
    }
  } catch (err) {
    console.error('[sightings] location purge failed', (err as Error).message);
  }

  // --- Phase 0c: orphaned photo objects -------------------------------------
  // ⚠️ THE ERASURE HALF THAT SQL CANNOT DO. delete_vehicle removes rows and the
  // photo rows cascade, but the JPEGs sat in the PUBLIC post-photos bucket
  // forever — a UK GDPR gap open since 2026-08-01. 20260901160000 queues the
  // paths; only a storage-API call can remove the bytes, and this is the one
  // process that runs on a clock.
  //
  // ⚠️ THROUGH THE STORAGE API, NEVER BY DELETING storage.objects ROWS — the
  // rule delete-account's header sets out: a row delete removes the record and
  // leaves the bytes, creating an orphan that no listing can ever find again.
  //
  // ⚠️ CLAIM → REMOVE → FORGET, IN THAT ORDER, AND FORGET ONLY ON SUCCESS. If
  // the queue row were dropped at claim time, a failure in between would lose
  // the path permanently and strand the object — the exact orphan this feature
  // exists to prevent, manufactured by the thing meant to fix it. Claiming is
  // idempotent, so a failed sweep just retries next hour.
  //
  // The claim re-checks all four photo tables before handing anything back: a
  // post created from a garage vehicle snapshots the same URLs, so deleting on
  // the vehicle's word alone would blank a live listing's hero image.
  try {
    const { data: claimed, error: claimError } = await admin.rpc('claim_orphaned_photos', {
      p_limit: 100,
    });
    if (claimError) {
      console.error('[storage] orphan claim failed', claimError.message);
    } else {
      const paths = (claimed ?? []) as string[];
      if (paths.length > 0) {
        const { error: removeError } = await admin.storage.from('post-photos').remove(paths);
        if (removeError) {
          // Left queued deliberately — see the claim/forget note above.
          console.error('[storage] orphan remove failed', removeError.message);
        } else {
          const { error: forgetError } = await admin.rpc('forget_orphaned_photos', {
            p_paths: paths,
          });
          if (forgetError) {
            // The objects are gone; the queue rows are not. Next run's claim
            // finds them unreferenced again, removes nothing (already absent —
            // `remove` is a no-op on a missing object) and forgets them.
            console.error('[storage] orphan forget failed', forgetError.message);
          } else {
            summary.photosRemoved = paths.length;
          }
        }
      }
    }
  } catch (err) {
    console.error('[storage] orphan sweep failed', (err as Error).message);
  }

  // --- Phase 1: expired, undisputed holds → the owner's refund ---------------
  // "Released" is derived, not stored: a hold whose payment is no longer
  // `held` simply stops matching this query. That is the idempotency.
  const { data: due, error: dueError } = await admin
    .from('refund_holds')
    // MONEY: the !inner join filters on kind too — see refundEscrow.ts. This
    // is the HOURLY CRON, so an unfiltered fee row here is money leaving the
    // platform on a timer with no human in the loop.
    .select('post_id, exit_path, payments!inner(status, kind)')
    .lt('expires_at', new Date().toISOString())
    .eq('payments.status', 'held')
    .eq('payments.kind', 'bounty_escrow');

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
      if (exitPath === 'recovery') {
        // The post just became recovered_no_spotter — the watchers hear the
        // car went home. Claim-guarded; a replay announces nothing twice.
        await announceRecoveryToWatchers(admin, postId);
      }
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
      // Persist-then-push (THE RULE): a dispute outcome is exactly the kind
      // of news that must survive a missed banner.
      await notifyUsers(admin, [doc.user_id], {
        kind: doc.kind,
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

  // --- Phase 2c: announcements a crash orphaned -------------------------------
  // A death between the state transition (mark_recovery_paid /
  // mark_post_recovered_no_spotter) and the announce leaves the claim marker
  // NULL with nothing retrying it — the interactive path's not_claimed
  // early-return never gets there again. The pending partial indexes exist
  // for exactly this scan. RECENT-SCOPED (7 days): recoveries that predate
  // the notification center must never be announced as news.
  const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data: pendingRecovery } = await admin
      .from('posts')
      .select('id')
      .in('status', ['recovered', 'recovered_no_spotter'])
      .is('recovery_notified_at', null)
      .gte('recovered_at', recentCutoff);
    for (const post of pendingRecovery ?? []) {
      await announceRecoveryToWatchers(admin, post.id as string);
    }
    const { data: pendingPayout } = await admin
      .from('payments')
      .select('post_id')
      .eq('status', 'released')
      .is('payout_notified_at', null)
      .gte('updated_at', recentCutoff);
    for (const payment of pendingPayout ?? []) {
      await announcePayoutSent(admin, payment.post_id as string);
    }
  } catch (err) {
    console.error('[notifications] announce sweep failed', (err as Error).message);
  }

  // ⚠️ RECORDED LAST, AND ONLY ON THE WAY OUT. A row in sweep_runs means this
  // function got all the way through — which is the property worth knowing,
  // because a run that dies half way leaves retention and erasure half-done
  // while an "it was invoked" marker would call that healthy.
  //
  // This sweep now carries three jobs that fail SILENTLY if it stops: the
  // notification purge, the 90-day location purge (a promise published on the
  // website) and the orphaned-photo removal (GDPR erasure). Before this, the
  // only evidence any of them ran was a console line nobody reads.
  //
  // Swallowed like everything else here: a monitoring write must never be the
  // thing that fails a sweep. The cost of losing one row is a slightly stale
  // health reading; the cost of throwing is a refund that did not happen.
  try {
    const { error: recordError } = await admin.rpc('record_sweep_run', { p_summary: summary });
    if (recordError) {
      console.error('[ops] sweep run not recorded', recordError.message);
    }
  } catch (err) {
    console.error('[ops] sweep run not recorded', (err as Error).message);
  }

  console.log('[payments] hold sweep done', summary);
  return jsonResponse(summary);
});
