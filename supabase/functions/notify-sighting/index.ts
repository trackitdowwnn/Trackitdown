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
 *        The push opens the sighting itself (/sighting/[id]), not the post.
 * LINKS: ../_shared/push.ts (notifyUsers);
 *        src/features/notifications/lib/pushRoute.ts (where a tap goes);
 *        supabase/migrations/20260922120000_pushes_say_the_news_first.sql
 *        (claim_sighting_notification's current definition — the copy is
 *        built THERE; first added in 20260802140000_notification_claims.sql);
 *        src/features/sightings/README.md; docs/ROADMAP.md.
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
    // ⚠️ ONE SPELLING (review of #147): this id is pushed to the owner and
    // stored on their row, and Postgres's uuid cast accepts upper case,
    // braces and no hyphens — any of which the app's strict schema or its
    // exact id match would reject, leaving a tap that opens nothing. Only
    // the canonical lower-case form goes past here.
    const id = typeof body.sightingId === 'string' ? body.sightingId.toLowerCase() : '';
    if (!CANONICAL_UUID.test(id)) throw new Error('sightingId required');
    sightingId = id;
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
      // sightingId opens THIS sighting rather than the post (2026-10-09). The
      // app accepted it before the server sent it (pushPayload's strict
      // schema was widened first, in #145) — but only builds that took that
      // OTA: it went out on the `preview` update branch alone. A build
      // running an older embedded bundle rejects the field and its tap opens
      // nothing, so publish to any other channel before relying on it
      // there. It is the sighting the owner already owns — nothing about the
      // spotter. The stored row gets the same object, so a tapped push still
      // marks its row read (exact match).
      data: { type: 'sighting', postId: claim.post_id as string, sightingId },
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
