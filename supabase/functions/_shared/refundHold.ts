/**
 * WHAT:  The exit gate both refund paths share: "does this refund go out now,
 *        or does it wait 72 hours while the spotters who might own it are
 *        asked?" — plus the hold creation and its pushes when the answer is
 *        wait.
 * WHY:   The owner-denial control (DOMAIN.md Disputes). `deactivate-post` and
 *        `refund-recovery` both refunded with zero sighting checks; this gate
 *        runs in both, BEFORE any Stripe call, off the ONE trigger definition
 *        (`recent_uncredited_sightings`, in SQL). The attestation contract:
 *        the client must have shown the owner exactly the sightings the
 *        server would hold for, and the server re-verifies that under lock
 *        (`create_refund_hold` raises ATTESTATION_STALE if reality grew).
 *
 * MONEY: no Stripe here. When the gate says `held`, the payment row simply
 *        stays `held` and the sweep (`release-held-refunds`) moves the money
 *        after the window — or `release-payout` moves it to the spotter if a
 *        dispute is upheld. When it says `refund_now`, the caller proceeds
 *        exactly as before this gate existed.
 * LINKS: supabase/migrations/20260805100000_refund_holds_and_disputes.sql
 *          (exit_check, create_refund_hold, the trigger definition);
 *        supabase/functions/deactivate-post/index.ts, refund-recovery/index.ts
 *          (the two callers); release-held-refunds/index.ts (the sweep);
 *        _shared/push.ts (sendToUsers).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

import { notifyUsers } from './push.ts';

export type ExitGateOutcome =
  /** No recent uncredited sightings — refund immediately, as always. */
  | { action: 'refund_now' }
  /** Sightings exist and the request carried no (or a stale) attestation:
   *  the client must show them and ask again. */
  | { action: 'attestation_required'; sightingIds: string[] }
  /** The hold is recorded, the post delisted (deactivate path), the spotters
   *  pushed. The caller reports the date and stops — no Stripe call. */
  | { action: 'held'; expiresAt: string }
  | { action: 'error'; code: 'LOOKUP_FAILED' | 'ATTESTATION_STALE' };

/**
 * Run the gate. `attestedSightingIds` is what the owner was shown when they
 * confirmed "none of these led me to the car" — null/absent means the client
 * has not run the attestation step yet.
 */
export async function gateExitRefund(
  admin: SupabaseClient,
  options: {
    postId: string;
    ownerId: string;
    exitPath: 'deactivate' | 'recovery';
    attestedSightingIds: string[] | null;
  },
): Promise<ExitGateOutcome> {
  const { postId, ownerId, exitPath, attestedSightingIds } = options;

  // The trigger set, via the one SQL definition. exit_check re-verifies
  // ownership from OUR argument (the Edge Function's verified caller) — it
  // reads auth.uid() only for direct client calls, so here we query the
  // helper's result through it with the service role and pass the owner in.
  const { data: check, error: checkError } = await admin.rpc('exit_check_for', {
    p_post_id: postId,
    p_owner_id: ownerId,
  });
  if (checkError) {
    console.error('[payments] exit check failed', checkError.message);
    return { action: 'error', code: 'LOOKUP_FAILED' };
  }
  const requires = Boolean((check as { requiresAttestation?: boolean })?.requiresAttestation);
  const sightingIds = ((check as { sightingIds?: string[] })?.sightingIds ?? []) as string[];

  if (!requires) {
    return { action: 'refund_now' };
  }
  if (!attestedSightingIds) {
    return { action: 'attestation_required', sightingIds };
  }

  const { data: hold, error: holdError } = await admin.rpc('create_refund_hold', {
    p_post_id: postId,
    p_owner_id: ownerId,
    p_exit_path: exitPath,
    p_attested_ids: attestedSightingIds,
  });
  if (holdError) {
    if (holdError.message.includes('ATTESTATION_STALE')) {
      // A sighting landed between the client's pre-flight and this call. The
      // owner has not seen it, so they cannot have attested to it — back to
      // the attestation step with the fresh set.
      return { action: 'error', code: 'ATTESTATION_STALE' };
    }
    if (holdError.message.includes('NO_HOLD_REQUIRED')) {
      // The trigger set emptied between the check and the hold (sightings
      // aged out). The honest answer is the one the owner wanted anyway.
      return { action: 'refund_now' };
    }
    console.error('[payments] create_refund_hold failed', holdError.message);
    return { action: 'error', code: 'LOOKUP_FAILED' };
  }

  const doc = hold as {
    expiresAt?: string;
    notify?: Array<{ user_id: string; sighting_id: string; title: string; body: string }>;
  };

  // The pushes ride the hold atomically (claimed in SQL — a replay sends
  // nothing). Send failures are logged, never thrown: the hold stands and
  // the dispute screen is reachable from the sighting either way.
  for (const item of doc.notify ?? []) {
    try {
      // Persist-then-push (THE RULE): the 72-hour window must reach a spotter
      // whose push permission is off — the feed row is their only signal.
      await notifyUsers(admin, [item.user_id], {
        kind: 'closed_uncredited',
        title: item.title,
        body: item.body,
        data: { type: 'closed_uncredited', sightingId: item.sighting_id },
        collapseKey: `closed_uncredited:${item.sighting_id}`,
      });
    } catch (err) {
      console.error('[payments] closed_uncredited push failed', (err as Error).message);
    }
  }

  return { action: 'held', expiresAt: doc.expiresAt ?? '' };
}
