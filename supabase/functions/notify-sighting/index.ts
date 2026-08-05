/**
 * WHAT:  Tells a post's owner that someone reported a sighting of their car.
 * WHY:   The sightings feature shipped with this as an honest stub ("the owner
 *        is notified" meant in-app only). This is that stub, wired.
 *        Invoked by the reporting client right after create_sighting succeeds.
 *        A client-invoked notification cannot be trusted, so the DATABASE does
 *        the authorising: claim_sighting_notification verifies the caller is
 *        the sighting's own spotter, refuses to notify someone about their own
 *        action, and is idempotent — replaying it sends nothing.
 *        HONEST LIMITATION: because the client invokes it, a report whose app
 *        is killed mid-call notifies nobody. Nothing is lost permanently — the
 *        sighting is in the owner's list either way — but a DB trigger with
 *        pg_net would close it.
 * LINKS: ../_shared/push.ts (sendToUsers);
 *        supabase/migrations/20260802140000_notification_claims.sql
 *        (claim_sighting_notification — the copy is built THERE);
 *        src/features/sightings/README.md; docs/ROADMAP.md.
 */

import { notifyUsers } from '../_shared/push.ts';
import { createServiceRoleClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

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
    if (!body.sightingId) throw new Error('sightingId required');
    sightingId = body.sightingId;
  } catch {
    return errorResponse('BAD_REQUEST', 'sightingId is required.', 400);
  }

  try {
    // The claim is the authorisation: not-yours, not-active, already-notified
    // and doesn't-exist all return the same `claimed: false`, so this endpoint
    // is not an oracle for whether a sighting exists.
    const { data: claim, error } = await admin.rpc('claim_sighting_notification', {
      p_sighting_id: sightingId,
      p_actor: actor,
    });
    if (error) {
      console.error('[notifications] sighting claim failed', error.message);
      return errorResponse('CLAIM_FAILED', 'Could not claim the sighting.', 500);
    }
    if (!claim?.claimed) {
      return jsonResponse({ claimed: false });
    }

    // Persist-then-push (THE RULE): the row is the durable half.
    const result = await notifyUsers(admin, [claim.user_id as string], {
      kind: 'sighting',
      title: claim.title as string,
      body: claim.body as string,
      data: { type: 'sighting', postId: claim.post_id as string },
      // Several spotters can report the same car in a day (3 each, per the
      // sighting rate limit). Collapse per post so the owner gets a live
      // banner, not a pile — the full list is in the app.
      collapseKey: `sighting:${claim.post_id as string}`,
    });

    console.log('[notifications] sighting notified', { sent: result.accepted });
    return jsonResponse({ claimed: true, sent: result.accepted });
  } catch (err) {
    console.error('[notifications] notify-sighting failed', (err as Error).message);
    return errorResponse('NOTIFY_FAILED', 'Could not notify the owner.', 500);
  }
});
