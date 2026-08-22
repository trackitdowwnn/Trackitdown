/**
 * WHAT:  Tells a spotter the owner confirmed their sighting — "the owner
 *        confirmed your sighting of the blue Ford", plus the badge they just
 *        earned, if any. The tap opens /my-sightings.
 * WHY:   A spotter reports a car and then, in the ordinary case, NOTHING ever
 *        happens to them. `credited` fires for the one who wins the bounty and
 *        `not_credited` for the runners-up once a car goes home — but the far
 *        commoner event, an owner looking at your photo and saying "yes, that
 *        is my car", was silent. That moment is the one this whole feature
 *        exists to create, and a moment nobody is told about is not a loop.
 *
 *        ⚠️ THIS FILE IS WRITTEN, NOT RECOVERED. A `notify-sighting-confirmed`
 *        has been deployed since 2026-08-14 from a checkout that no longer
 *        exists; this repository never had its source, and the kind sat in
 *        push_sends_kind_chk with the client unable to route it. Writing the
 *        sender ourselves is what makes the payload KNOWABLE — the alternative
 *        was guessing at a shape and risking a client that rejects real pushes.
 *
 *        Invoked by the OWNER's client right after mark_sighting_helpful. A
 *        client-invoked notification cannot be trusted, so the DATABASE
 *        authorises: claim_sighting_confirmed_notification re-verifies the
 *        caller owns the post, requires the sighting to be `helpful`, and is
 *        idempotent via a conditional update on confirmed_notified_at. Every
 *        refusal returns the identical {claimed:false}, so this is no oracle.
 *
 * SAFETY: THE COPY IS BUILT IN SQL AND MUST STAY THERE. Copy assembled in the
 *        claim RPC is covered by `npm run test:db`; copy assembled here is
 *        covered by nothing this project runs. It also bounds the owner-supplied
 *        make/colour to 32 chars (20260815100000) — unbounded, one owner's 4 KB
 *        "make" makes Expo reject the push with MessageTooBig and the spotter is
 *        simply never told.
 *
 *        Fires for a CAPPED or COLLUSION-FLAGGED confirmation too. The sighting
 *        genuinely was confirmed, and withholding the news would leak that
 *        something about the pair had been judged. The badge line simply does
 *        not appear, because the counter did not move.
 *
 *        NOTHING IS SENT FOR not_mine. A rejection is news the spotter reads on
 *        their own record when they choose to look, not an interruption telling
 *        someone they were wrong.
 * LINKS: ../_shared/push.ts (notifyUsers — persist-then-push);
 *        supabase/migrations/20260814130000_sighting_confirmed_notification.sql
 *          (claim_sighting_confirmed_notification — the copy is built THERE);
 *        supabase/migrations/20260815100000_bound_owner_text_on_applied_migrations.sql
 *          (the 32-char bound on make/colour);
 *        src/features/notifications/lib/pushRoute.ts (→ /my-sightings);
 *        supabase/functions/notify-credited/index.ts (the sibling this mirrors).
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
    const { data: claim, error } = await admin.rpc('claim_sighting_confirmed_notification', {
      p_sighting_id: sightingId,
      p_actor: actor,
    });
    if (error) {
      console.error('[notifications] sighting-confirmed claim failed', error.message);
      return errorResponse('CLAIM_FAILED', 'Could not claim the confirmation.', 500);
    }
    if (!claim?.claimed) {
      // Not the owner, not confirmed, already notified, no such sighting — all
      // ONE answer by design.
      return jsonResponse({ claimed: false });
    }

    // Persist-then-push (THE RULE): a spotter with push denied still finds this
    // in the notification centre, which for most of them is the only place they
    // will ever see that an owner looked.
    const result = await notifyUsers(admin, [claim.user_id as string], {
      kind: 'sighting_confirmed',
      title: claim.title as string,
      body: claim.body as string,
      // ⚠️ sightingId, and it is the ONLY id here. The route is /my-sightings —
      // the spotter's own record — because the audience is the SPOTTER: they
      // cannot open the post's owner-side sighting detail, and the RPC behind it
      // would refuse them. Carrying a postId would be handing them a listing
      // they were never shown.
      data: { type: 'sighting_confirmed', sightingId: claim.sighting_id as string },
      // One confirmation per sighting, ever — the claim column enforces that.
      // The collapse key is belt and braces against a replayed delivery.
      collapseKey: `sighting_confirmed:${claim.sighting_id as string}`,
    });

    console.log('[notifications] sighting confirmed notified', { sent: result.accepted });
    return jsonResponse({ claimed: true, sent: result.accepted });
  } catch (err) {
    console.error('[notifications] notify-sighting-confirmed failed', (err as Error).message);
    return errorResponse('NOTIFY_FAILED', 'Could not notify the spotter.', 500);
  }
});
