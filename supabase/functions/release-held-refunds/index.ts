/**
 * WHAT:  The hold sweep — the cron target that finishes what the 72-hour
 *        window started, and the one process in the system that runs on a
 *        clock, so every timed job hangs off it. Phase 0/0b/0c: retention
 *        (notification purge, 90-day location purge, orphaned photo bytes in
 *        both buckets). Phase 0d-warn/0d: the cancelled-post deletion warning
 *        and the 30-day purge it precedes. Phase 1: every refund refunds_due
 *        names — expired, undisputed holds get the refund the owner asked
 *        for, and superseded payments (a renewed reward, a stray capture) go
 *        home. Phase 1b: reward money 75+ days old is emailed to the operator
 *        (Stripe's 90-day platform-balance limit). Phase 1c: the 60-day
 *        reward term's notices and reminders (ADR-0020). Phase 2: upheld disputes
 *        get the spotter paid (through the existing release core) and every
 *        resolved dispute gets its outcome push. Phase 4: the ADR-0019 "still
 *        missing?" liveness ask.
 * WHY:   A hold is a promise with a date on it: "your refund is sent after
 *        {date} unless a sighting is contested". Nothing else in the system
 *        acts on the clock — there is no scheduler anywhere until this — so
 *        without the sweep that promise is a lie and the money strands.
 *        Invoked hourly by Supabase Cron, and safely by hand: everything here
 *        is idempotent (refunds under the payment's own key,
 *        payment-refund-{pi} — the SAME key the immediate exit used — payouts
 *        under post-payout-{id}, pushes and alerts behind conditional-update
 *        claims), so double-invocation does nothing twice.
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
 *        supabase/migrations/20261005110000_a_reward_can_be_replaced.sql
 *          (refunds_due, claim_money_deadline_alerts);
 *        _shared/refundEscrow.ts, _shared/releasePayout.ts, _shared/push.ts,
 *        _shared/opsAlert.ts;
 *        docs/decisions/ADR-0011-refund-holds-and-disputes.md (cron setup).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { refundPayment } from '../_shared/refundEscrow.ts';
import { sendOpsAlert } from '../_shared/opsAlert.ts';
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
    sightingPhotosRemoved: 0,
    deletionWarningsSent: 0,
    cancelledPostsPurged: 0,
    cancelledPostsSkipped: 0,
    stillMissingAsked: 0,
    deadlineAlerts: 0,
    deadlineAlertsEmailed: null as boolean | null,
    rewardTermNotices: 0,
    rewardReminders: 0,
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

  // The SIGHTING-photos twin (20260921110000): same claim → remove → forget
  // contract, different bucket and queue. Exists because post deletion is
  // routine now (Phase 0d + the owner's delete) and sighting_photos rows
  // cascade with their post — without this, every deleted post stranded the
  // spotters' JPEGs in the private bucket forever. Paths are per-sighting,
  // never content-shared, so there is no cross-listing hazard here; the
  // claim's reference re-check is an assertion, not the gate it is above.
  try {
    const { data: claimedSighting, error: sightingClaimError } = await admin.rpc(
      'claim_orphaned_sighting_photos',
      { p_limit: 100 },
    );
    if (sightingClaimError) {
      console.error('[storage] sighting orphan claim failed', sightingClaimError.message);
    } else {
      const paths = (claimedSighting ?? []) as string[];
      if (paths.length > 0) {
        const { error: removeError } = await admin.storage.from('sighting-photos').remove(paths);
        if (removeError) {
          // Left queued deliberately — the claim/forget note above.
          console.error('[storage] sighting orphan remove failed', removeError.message);
        } else {
          const { error: forgetError } = await admin.rpc('forget_orphaned_sighting_photos', {
            p_paths: paths,
          });
          if (forgetError) {
            // Objects gone, queue rows not: next run re-claims, `remove` is a
            // no-op on missing objects, and the forget retries.
            console.error('[storage] sighting orphan forget failed', forgetError.message);
          } else {
            summary.sightingPhotosRemoved = paths.length;
          }
        }
      }
    }
  } catch (err) {
    console.error('[storage] sighting orphan sweep failed', (err as Error).message);
  }

  // --- Phase 0d-warn: the warning before the purge ----------------------------
  // Owners of cancelled posts 27+ days past closing are told, once, that the
  // post is deleted in about 3 days (kind `deletion_soon`, unmutable — a
  // data-retention notice about their own content). The purge below refuses
  // any post whose warning is under 72 hours old, so this phase running FIRST
  // is a courtesy, not the guarantee — the guarantee is in SQL.
  //
  // ⚠️ THE CLAIM IS BURNED BEFORE THE SEND, like still_missing and for the
  // same shape of reason: a lost push costs one reminder on a post that was
  // already told its fate in the delete confirm, while a claim that survived
  // failure would need a success-conditional un-stamp that every retry path
  // then has to get right. The 72-hour purge wait still runs from the stamp,
  // so even a lost push buys the owner the full notice window.
  try {
    const { data: warns, error: warnError } = await admin.rpc(
      'claim_cancelled_deletion_warnings',
      { p_limit: 200 },
    );
    if (warnError) {
      console.error('[posts] deletion-warning claim failed', warnError.message);
    } else {
      const rows = (warns ?? []) as {
        post_id: string;
        user_id: string;
        title: string;
        body: string;
      }[];
      for (const row of rows) {
        // Per-item, like every other queue here: one owner's failed push must
        // not stop the rest.
        try {
          await notifyUsers(admin, [row.user_id], {
            kind: 'deletion_soon',
            title: row.title,
            body: row.body,
            data: { type: 'deletion_soon', postId: row.post_id },
            // One warning per post, ever — a duplicate delivery replaces
            // rather than stacks.
            collapseKey: `deletion-soon-${row.post_id}`,
          });
          summary.deletionWarningsSent += 1;
        } catch (err) {
          console.error('[posts] deletion warning send failed', (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error('[posts] deletion warning sweep failed', (err as Error).message);
  }

  // --- Phase 0d: cancelled-post retention ------------------------------------
  // A cancelled post the owner never deleted goes at 30 days — the watchlist
  // tombstone window, fully lapsed. The RPC routes every post through
  // delete_cancelled_post, so all the money guards apply per post and a
  // blocked one (a hold still open, a dispute in review, a stray uncaptured
  // intent only the owner's own delete can prove dead) is skipped and retried
  // next run, never forced. `skipped` is surfaced in the summary on purpose:
  // a post the guards refuse EVERY hour is invisible otherwise, and a
  // persistently non-zero count here is the signal to go look (sweep_health
  // shows this summary). Photo bytes follow through Phase 0c: the cascading
  // photo rows queue their storage paths on delete.
  try {
    const { data: purgeResult, error: postsPurgeError } = await admin.rpc(
      'purge_cancelled_posts',
    );
    if (postsPurgeError) {
      console.error('[posts] cancelled-post purge failed', postsPurgeError.message);
    } else {
      const doc = purgeResult as { purged?: number; skipped?: number } | null;
      summary.cancelledPostsPurged = typeof doc?.purged === 'number' ? doc.purged : 0;
      summary.cancelledPostsSkipped = typeof doc?.skipped === 'number' ? doc.skipped : 0;
      if (summary.cancelledPostsSkipped > 0) {
        console.warn('[posts] cancelled-post purge skipped blocked posts', {
          skipped: summary.cancelledPostsSkipped,
        });
      }
    }
  } catch (err) {
    console.error('[posts] cancelled-post purge failed', (err as Error).message);
  }

  // --- Phase 1: every refund that is due → the owner ------------------------
  // ONE SQL definition of "due" (refunds_due, 20261005110000): expired holds
  // with a held reward and no open/upheld dispute (an open dispute pauses the
  // refund; an upheld one forecloses it — that money goes to the spotter in
  // Phase 2), and superseded payments (renewed, or a stray capture) owed back
  // at once. It replaces a PostgREST join that leaned on a relationship the two
  // tables never declared. "Released" is still derived, not stored: a refunded
  // payment stops matching. That is the idempotency.
  //
  // MONEY: refunds_due filters status AND kind = bounty_escrow, and
  // refundPayment re-checks both — a fee can never leave here. This is the
  // HOURLY CRON: anything that slipped through would move money with no human
  // in the loop, which is why both locks stay.
  const { data: due, error: dueError } = await admin.rpc('refunds_due', { p_limit: 50 });
  if (dueError) {
    console.error('[payments] refunds_due failed', dueError.message);
  }
  // The reason picks the terminal record — recorded in the ledger, never
  // re-derived: a deactivation cancels, a recovery finishes the recovery, a
  // superseded payment is recorded with its post left exactly as it is.
  // ⚠️ EXHAUSTIVE ON PURPOSE. A reason this code does not know (a future one
  // added to refunds_due before this is redeployed) is SKIPPED, never mapped
  // to a default: sending a held reward to reconcile would cancel its post.
  const TERMINAL_RPC: Record<string, string> = {
    deactivate: 'mark_post_payment_refunded',
    recovery: 'mark_post_recovered_no_spotter',
    superseded: 'reconcile_payment_refund',
  };
  for (const row of (due ?? []) as {
    payment_intent_id: string;
    post_id: string | null;
    reason: string;
  }[]) {
    const paymentIntentId = row.payment_intent_id;
    const postId = row.post_id;
    const rpc = TERMINAL_RPC[row.reason];
    if (!rpc) {
      console.error('[payments] refunds_due returned an unknown reason — skipped', {
        paymentIntentId,
        reason: row.reason,
      });
      summary.skipped += 1;
      continue;
    }
    try {
      // THE SAME KEY every path uses for this payment (`payment-refund-<pi>`):
      // if the owner's original request died after Stripe but before the
      // ledger, this retries into that refund instead of minting a second one.
      // The status the row was listed in is the only one accepted: a hold's
      // reward must still be held, a superseded payment still superseded.
      const outcome = await refundPayment(admin, stripe, {
        paymentIntentId,
        statuses: row.reason === 'superseded' ? ['superseded'] : ['held'],
      });
      if (outcome.status !== 'refunded') {
        // no_held_payment = settled between the query and here; the others
        // retry next run.
        summary.skipped += 1;
        continue;
      }

      const { error: rpcError } = await admin.rpc(rpc, {
        p_payment_intent_id: outcome.paymentIntentId,
        p_refund_id: outcome.refundId,
        p_refunded_amount_pence: outcome.refundPence,
      });
      if (rpcError) {
        // Refund issued, record failed: the idempotency key + never-regress
        // RPC + charge.refunded webhook make the next run safe.
        console.error('[payments] refund record failed', {
          paymentIntentId,
          reason: row.reason,
          error: rpcError.message,
        });
        summary.skipped += 1;
        continue;
      }
      console.log('[payments] due refund released', { postId, reason: row.reason });
      summary.refunded += 1;
      if (row.reason === 'recovery' && postId) {
        // The post just became recovered_no_spotter — the watchers hear the
        // car went home. Claim-guarded; a replay announces nothing twice.
        await announceRecoveryToWatchers(admin, postId);
      }
    } catch (err) {
      console.error('[payments] refund item failed', {
        paymentIntentId,
        error: (err as Error).message,
      });
      summary.skipped += 1;
    }
  }

  // --- Phase 1b: reward money getting old → tell a person -------------------
  // Stripe caps funds on the platform balance at 90 days (lead support,
  // 2026-10-05) and may offboard an account that breaches it persistently.
  // Anything captured 75+ days ago that is still held or owed back — a legacy
  // reward with no term yet, an unresolved dispute or payout review, a spotter
  // who never onboarded — is claimed at most once a day per payment and
  // emailed. Ids and states only (claim_money_deadline_alerts builds the rows;
  // no plate, name or amount). Best-effort like everything else here.
  try {
    const { data: aging, error: agingError } = await admin.rpc('claim_money_deadline_alerts', {
      p_limit: 50,
    });
    if (agingError) {
      console.error('[payments] deadline alert claim failed', agingError.message);
    } else if (Array.isArray(aging) && aging.length > 0) {
      summary.deadlineAlerts = aging.length;
      const lines = (aging as Record<string, unknown>[]).map(
        (row) =>
          `• payment ${row.paymentId} (post ${row.postId ?? 'deleted'}): ${row.paymentStatus}, post ${row.postStatus ?? '—'}, ` +
          `${row.daysHeld} days held, resolve by ${row.resolveBy}. ` +
          `Open disputes: ${row.openDisputes}. Payout review: ${row.payoutReview ?? 'none'}. ` +
          `Refund hold until: ${row.refundHoldUntil ?? 'none'}.`,
      );
      const sent = await sendOpsAlert(
        `${aging.length} reward payment(s) approaching Stripe's 90-day limit`,
        [
          'Reward money must leave the platform balance before day 90 (Stripe lead support, 2026-10-05).',
          '',
          ...lines,
          '',
          'What to do: docs/OPERATIONS.md → money deadlines.',
        ],
      );
      summary.deadlineAlertsEmailed = sent;
      if (!sent) {
        // The claim was taken before the send. Hand it back so the next run
        // tries again in an hour, instead of losing a day of the window.
        const { error: releaseError } = await admin.rpc('release_money_deadline_alerts', {
          p_payment_ids: (aging as { paymentId: string }[]).map((row) => row.paymentId),
        });
        if (releaseError) {
          console.error('[payments] deadline alert release failed', releaseError.message);
        }
      }
    }
  } catch (err) {
    console.error('[payments] deadline alerts failed', (err as Error).message);
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

  // --- Phase 1c: the reward term — notices and reminders (ADR-0020) ---------
  // Every reward runs for 60 days (Stripe caps platform-balance holds at 90).
  // Owners are TOLD before any reward ends: rewards held before the term
  // existed get their date once (claim_reward_term_notices — at least 14 days'
  // notice, capped at capture + 80 days), and every reward gets "ends on
  // {date}" 10 and 3 days out (claim_reward_reminders). Both claims build the
  // copy in SQL (car and date, never plate or amount) and are burned BEFORE
  // the send, like Phase 4: the listing's own reward banner is the door, so a
  // lost push costs a reminder, not the notice. Moves no money.
  //
  // ⚠️ OFF UNTIL SWITCHED ON (REWARD_TERM_NOTICES_ENABLED=true). These pushes
  // promise an automatic refund at the end of the term (the expiry, PR5) and
  // point at a Renew button only the updated app has. Deploying this code
  // must not start sending them: turn the switch on once BOTH are live (the
  // OTA verified with `eas update:list`, and PR5 deployed). Until then the
  // claims are not even called, so nothing is stamped and nothing is lost.
  const termNoticesOn = Deno.env.get('REWARD_TERM_NOTICES_ENABLED') === 'true';
  for (const claim of termNoticesOn
    ? (['claim_reward_term_notices', 'claim_reward_reminders'] as const)
    : []) {
    try {
      const { data: rows, error: claimError } = await admin.rpc(claim, { p_limit: 200 });
      if (claimError) {
        console.error('[payments] reward term claim failed', { claim, error: claimError.message });
        continue;
      }
      for (const row of (rows ?? []) as {
        payment_id: string;
        post_id: string;
        user_id: string;
        title: string;
        body: string;
      }[]) {
        try {
          await notifyUsers(admin, [row.user_id], {
            kind: 'reward_ending',
            title: row.title,
            body: row.body,
            data: { type: 'reward_ending', postId: row.post_id },
            // One live notice per LISTING: the 3-day reminder replaces the
            // 10-day one on the lock screen, across renewals too. The post id,
            // not the payment id — a ledger id must never travel through
            // Expo/APNs/FCM (SECURITY_AND_TRUST §3 allows post/thread ids).
            collapseKey: `reward-ending-${row.post_id}`,
          });
          if (claim === 'claim_reward_term_notices') {
            summary.rewardTermNotices += 1;
          } else {
            summary.rewardReminders += 1;
          }
        } catch (err) {
          console.error('[payments] reward term send failed', (err as Error).message);
        }
      }
    } catch (err) {
      console.error('[payments] reward term phase failed', { claim, error: (err as Error).message });
    }
  }

  // --- Phase 4: the liveness check (ADR-0019) --------------------------------
  // "Is your {car} still missing?" to owners who have gone quiet. The 2026-08-05
  // loop trace found that nothing in the system ever asks: a post sits `active`
  // forever, escrow sits `held` forever, and an owner who recovered their car
  // off-platform strands a spotter's effort and real money without ever meaning
  // to.
  //
  // ⚠️ THIS MOVES NO MONEY AND CHANGES NO STATUS, and that separation is the
  // whole design: all this does is ask a question whose answers both lead
  // somewhere a person already drives. The claim caps itself at three asks per
  // case. (The one timer that DOES return money is the reward term —
  // ADR-0020, which supersedes ADR-0019's "no cron moves money" for exactly
  // that case: an owner's own reward, back to that owner, on a date they were
  // told. This ask stays money-free.)
  //
  // ⚠️ THE CLAIM IS BURNED BEFORE THE SEND, which is the OPPOSITE of the rule
  // claim_credited_notification was rewritten for on 2026-09-02 — deliberately.
  // There, a failed send meant the spotter never learned they were credited, so
  // the claim had to survive. Here the ask has already landed where it matters:
  // `still_missing_asked_at` is what raises the in-app banner, and the banner
  // is the door. A lost push costs a reminder, not the question.
  try {
    const { data: asks, error: askError } = await admin.rpc('claim_still_missing_checks', {
      p_limit: 200,
    });
    if (askError) {
      console.error('[posts] still-missing claim failed', askError.message);
    } else {
      const rows = (asks ?? []) as {
        post_id: string;
        user_id: string;
        title: string;
        body: string;
      }[];
      for (const row of rows) {
        // Per-item, like every other queue here: one owner's failed push must
        // not stop the rest.
        try {
          await notifyUsers(admin, [row.user_id], {
            kind: 'still_missing',
            title: row.title,
            body: row.body,
            data: { type: 'still_missing', postId: row.post_id },
            // One live ask per post: a second banner for the same car replaces
            // the first rather than stacking beside it.
            collapseKey: `still-missing-${row.post_id}`,
          });
          summary.stillMissingAsked += 1;
        } catch (err) {
          console.error('[posts] still-missing send failed', (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error('[posts] still-missing sweep failed', (err as Error).message);
  }

  // ⚠️ RECORDED LAST, AND ONLY ON THE WAY OUT. A row in sweep_runs means this
  // function got all the way through — which is the property worth knowing,
  // because a run that dies half way leaves retention and erasure half-done
  // while an "it was invoked" marker would call that healthy.
  //
  // This sweep now carries SIX jobs that fail SILENTLY if it stops: the
  // notification purge, the 90-day location purge (a promise published on the
  // website), the orphaned-photo removal (GDPR erasure), the ADR-0019
  // liveness check (2026-09-02), and — since 2026-09-21 — the 30-day
  // cancelled-post purge and the deletion warning that precedes it. Before
  // this, the only evidence any of them ran was a console line nobody reads.
  //
  // ⚠️ Six is more than this function was designed to carry, and it still has
  // no ALERTING — sweep_health() must be asked, it never speaks. That is review
  // finding #10 and it is still open.
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
