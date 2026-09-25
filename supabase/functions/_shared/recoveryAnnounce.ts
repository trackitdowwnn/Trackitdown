/**
 * WHAT:  The announcements money owes people. Since ADR-0021 (2026-09-25)
 *        that includes the OWNER — `refund_sent` and `reward_delivered` — and
 *        a sweep-side sender for the spotter's credited push
 *        (announceRefundSent / announceRewardDelivered / announceCredited,
 *        below). The original three a finished recovery owes:
 *        `payout_sent` to the spotter whose transfer just went out, `recovery`
 *        to everyone watching the car — the sender the `recovery` kind shipped
 *        without (2026-08-02) and waited a month for — and `not_credited` to
 *        the spotters who reported this car and were not the one credited.
 *        That third one closed the loop's last silent corner (2026-08-06): on
 *        a crowd product most spotters LOSE, and until then losing was
 *        indistinguishable from being ignored.
 * WHY:   Both fire AFTER the money/state landed, from every path that can
 *        finish a recovery (the release core; the no-spotter refund; the hold
 *        sweep), and both are claims-first: the SQL claim owns idempotency
 *        (recovery_notified_at / payout_notified_at conditional updates) and
 *        the copy, so a race between two paths sends once, ever. Persist-
 *        then-push via notifyUsers — THE RULE — so the center rows land even
 *        for push-less users.
 *
 * MONEY: nothing here moves money, and both are best-effort by contract:
 *        never throw. An announcement failing must not fail the payout or
 *        refund that triggered it — the claim stays unconsumed on a claim
 *        error, and the hourly sweep's Phase 2c scans the pending claim
 *        markers (recent-scoped), so even a crash BETWEEN the state
 *        transition and the announce only delays the news, never loses it.
 * LINKS: supabase/migrations/20260806100000_notification_center.sql (the two
 *        claims and their copy); ./push.ts (notifyUsers);
 *        ./releasePayout.ts, ../refund-recovery/index.ts,
 *        ../release-held-refunds/index.ts (the callers).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

import { notifyUsers } from './push.ts';

/** "£X on its way" to the spotter whose transfer just went out. */
export async function announcePayoutSent(admin: SupabaseClient, postId: string): Promise<void> {
  try {
    const { data: claim, error } = await admin.rpc('claim_payout_sent_notification', {
      p_post_id: postId,
    });
    if (error || !(claim as { claimed?: boolean })?.claimed) {
      if (error) console.error('[notifications] payout_sent claim failed', error.message);
      return;
    }
    const doc = claim as { user_id: string; post_id: string; title: string; body: string };
    await notifyUsers(admin, [doc.user_id], {
      kind: 'payout_sent',
      title: doc.title,
      body: doc.body,
      data: { type: 'payout_sent', postId: doc.post_id },
      collapseKey: `payout_sent:${doc.post_id}`,
    });
  } catch (err) {
    console.error('[notifications] payout_sent announce failed', (err as Error).message);
  }
}

/**
 * "A car you reported was found" to the spotters who reported it and did NOT
 * win — the loop's silent corner until 2026-08-06. The claim refuses unless a
 * sighting was actually credited, so the `recovered_no_spotter` paths (where
 * `closed_uncredited` already spoke) call this harmlessly and send nothing.
 */
export async function announceNotCredited(admin: SupabaseClient, postId: string): Promise<void> {
  try {
    const { data: claim, error } = await admin.rpc('claim_not_credited_notifications', {
      p_post_id: postId,
    });
    if (error || !(claim as { claimed?: boolean })?.claimed) {
      if (error) console.error('[notifications] not_credited claim failed', error.message);
      return;
    }
    const doc = claim as { user_ids: string[]; post_id: string; title: string; body: string };
    if ((doc.user_ids ?? []).length === 0) {
      return; // claim consumed, no runners-up — the common single-spotter case
    }
    await notifyUsers(admin, doc.user_ids, {
      kind: 'not_credited',
      title: doc.title,
      body: doc.body,
      data: { type: 'not_credited', postId: doc.post_id },
      collapseKey: `not_credited:${doc.post_id}`,
    });
  } catch (err) {
    console.error('[notifications] not_credited announce failed', (err as Error).message);
  }
}

/**
 * "£X refunded" to the OWNER, once their escrow refund has landed (ADR-0021).
 * Called after every refund writer — deactivate-post, refund-recovery, the
 * hold sweep's Phase 1 and the charge.refunded webhook — and swept by Phase 2c.
 * The claim refuses anything that is not a landed escrow refund, so every
 * caller may fire it blindly.
 */
export async function announceRefundSent(admin: SupabaseClient, postId: string): Promise<void> {
  try {
    const { data: claim, error } = await admin.rpc('claim_refund_sent_notification', {
      p_post_id: postId,
    });
    if (error || !(claim as { claimed?: boolean })?.claimed) {
      if (error) console.error('[notifications] refund_sent claim failed', error.message);
      return;
    }
    const doc = claim as { user_id: string; post_id: string; title: string; body: string };
    await notifyUsers(admin, [doc.user_id], {
      kind: 'refund_sent',
      title: doc.title,
      body: doc.body,
      data: { type: 'refund_sent', postId: doc.post_id },
      collapseKey: `refund_sent:${doc.post_id}`,
    });
  } catch (err) {
    console.error('[notifications] refund_sent announce failed', (err as Error).message);
  }
}

/**
 * "£X sent to your spotter" to the OWNER, once the transfer went out
 * (ADR-0021) — most often days after they credited someone, when the spotter
 * finally finished payout setup and the webhook released it.
 */
export async function announceRewardDelivered(
  admin: SupabaseClient,
  postId: string,
): Promise<void> {
  try {
    const { data: claim, error } = await admin.rpc('claim_reward_delivered_notification', {
      p_post_id: postId,
    });
    if (error || !(claim as { claimed?: boolean })?.claimed) {
      if (error) console.error('[notifications] reward_delivered claim failed', error.message);
      return;
    }
    const doc = claim as { user_id: string; post_id: string; title: string; body: string };
    await notifyUsers(admin, [doc.user_id], {
      kind: 'reward_delivered',
      title: doc.title,
      body: doc.body,
      data: { type: 'reward_delivered', postId: doc.post_id },
      collapseKey: `reward_delivered:${doc.post_id}`,
    });
  } catch (err) {
    console.error('[notifications] reward_delivered announce failed', (err as Error).message);
  }
}

/**
 * The credited push to the SPOTTER, sent by the sweep when the owner's phone
 * never did. The usual sender is notify-credited, invoked from the OWNER's app
 * the moment they credit someone — so an app killed at that moment used to
 * mean the spotter was never told they earned anything. This goes through the
 * SAME claim (claim_credited_notification, which verifies the actor owns the
 * post and sends once, ever), so racing the owner's phone is harmless.
 */
export async function announceCredited(
  admin: SupabaseClient,
  postId: string,
  ownerId: string,
): Promise<void> {
  try {
    const { data: claim, error } = await admin.rpc('claim_credited_notification', {
      p_post_id: postId,
      p_actor: ownerId,
    });
    if (error || !(claim as { claimed?: boolean })?.claimed) {
      if (error) console.error('[notifications] credited backstop claim failed', error.message);
      return;
    }
    const doc = claim as {
      user_id: string;
      post_id: string;
      kind: 'credited' | 'credited_no_reward';
      title: string;
      body: string;
    };
    // The KIND comes from the claim — a £5 listing's credit is credited_no_reward.
    await notifyUsers(admin, [doc.user_id], {
      kind: doc.kind,
      title: doc.title,
      body: doc.body,
      data: { type: doc.kind, postId: doc.post_id },
      collapseKey: `credited:${doc.post_id}`,
    });
  } catch (err) {
    console.error('[notifications] credited backstop failed', (err as Error).message);
  }
}

/** "A car you were watching was recovered" to the watchers. */
export async function announceRecoveryToWatchers(
  admin: SupabaseClient,
  postId: string,
): Promise<void> {
  try {
    const { data: claim, error } = await admin.rpc('claim_recovery_notifications', {
      p_post_id: postId,
    });
    if (error || !(claim as { claimed?: boolean })?.claimed) {
      if (error) console.error('[notifications] recovery claim failed', error.message);
      return;
    }
    const doc = claim as { user_ids: string[]; post_id: string; title: string; body: string };
    if ((doc.user_ids ?? []).length === 0) {
      return; // claim consumed, nobody watching — nothing to send
    }
    await notifyUsers(admin, doc.user_ids, {
      kind: 'recovery',
      title: doc.title,
      body: doc.body,
      data: { type: 'recovery', postId: doc.post_id },
      collapseKey: `recovery:${doc.post_id}`,
    });
  } catch (err) {
    console.error('[notifications] recovery announce failed', (err as Error).message);
  }
}
