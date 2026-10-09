/**
 * WHAT:  Tells a post's owner that a spotter took back a sighting of their
 *        car — and why, if the spotter chose to say (one fixed sentence).
 * WHY:   Owner request (2026-10-09): a withdrawn sighting simply vanished from
 *        the owner's listing, so an owner already told "Your blue BMW was
 *        spotted" was never told it had been taken back.
 *        Invoked by the spotter's app right after withdraw_sighting succeeds.
 *        A client-invoked notification cannot be trusted, so the DATABASE does
 *        the authorising: claim_sighting_withdrawn_notification verifies the
 *        caller is the sighting's own spotter, that it really is withdrawn,
 *        that the owner heard about it in the first place, and is idempotent
 *        — replaying it sends nothing. The copy is built there too.
 *        The push carries the post id only: a tap opens the owner's listing
 *        (the withdrawn sighting itself is no longer shown to them).
 *        HONEST LIMITATION, as notify-sighting's: a spotter whose app dies
 *        mid-call leaves the owner untold; the sighting is gone from their
 *        listing either way.
 * LINKS: ../_shared/push.ts (notifyUsers);
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql
 *          (claim_sighting_withdrawn_notification — the gate and the copy);
 *        ../notify-sighting/index.ts (the model);
 *        src/features/notifications/lib/pushRoute.ts (where a tap goes).
 */

import { notifyUsers } from '../_shared/push.ts';
import { createServiceRoleClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST.', 405);
  }

  const admin = createServiceRoleClient();

  const jwt = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: auth } = await admin.auth.getUser(jwt);
  const actor = auth?.user?.id;
  if (!actor) {
    return errorResponse('NOT_AUTHENTICATED', 'Sign in required.', 401);
  }

  let sightingId: string;
  try {
    const body = (await request.json()) as { sightingId?: string };
    // One spelling of the id, as notify-sighting accepts (review of #147).
    const id = typeof body.sightingId === 'string' ? body.sightingId.toLowerCase() : '';
    if (!CANONICAL_UUID.test(id)) throw new Error('sightingId required');
    sightingId = id;
  } catch {
    return errorResponse('BAD_REQUEST', 'sightingId is required.', 400);
  }

  try {
    // The claim is the authorisation: every refusal returns the same
    // `claimed: false`, so this endpoint is no oracle for sighting ids.
    const { data: claim, error } = await admin.rpc('claim_sighting_withdrawn_notification', {
      p_sighting_id: sightingId,
      p_actor: actor,
    });
    if (error) {
      console.error('[notifications] withdrawn claim failed', error.message);
      return errorResponse('CLAIM_FAILED', 'Could not claim the sighting.', 500);
    }
    if (!claim?.claimed) {
      return jsonResponse({ claimed: false });
    }

    // Persist-then-push (THE RULE): the row is the durable half. The post id
    // only — the tap opens the listing; nothing about the spotter rides it.
    const result = await notifyUsers(admin, [claim.user_id as string], {
      kind: 'sighting_withdrawn',
      title: claim.title as string,
      body: claim.body as string,
      data: { type: 'sighting_withdrawn', postId: claim.post_id as string },
      collapseKey: `sighting_withdrawn:${claim.post_id as string}`,
    });

    console.log('[notifications] sighting withdrawn notified', { sent: result.accepted });
    return jsonResponse({ claimed: true, sent: result.accepted });
  } catch (err) {
    console.error('[notifications] notify-sighting-withdrawn failed', (err as Error).message);
    return errorResponse('NOTIFY_FAILED', 'Could not notify the owner.', 500);
  }
});
