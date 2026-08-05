/**
 * WHAT:  The two announcements a finished recovery owes people: `payout_sent`
 *        to the spotter whose transfer just went out, and `recovery` to
 *        everyone watching the car — the sender the `recovery` kind shipped
 *        without (2026-08-02) and waited a month for.
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

/** "On its way — £X" to the spotter whose transfer just went out. */
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
