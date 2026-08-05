/**
 * WHAT:  Tells a spotter their sighting was credited — "You've earned £X.
 *        Tell us where to send it." The tap opens /payouts.
 * WHY:   DOMAIN: payout setup is prompted at CREDIT time, and this push IS the
 *        prompt. Without it the credit moment is silent: the owner confirms,
 *        the spotter hears nothing, and the realistic steady state is a
 *        credited spotter who never learns they earned money.
 *
 *        Invoked by the OWNER's client right after claim_recovery credits a
 *        sighting. A client-invoked notification cannot be trusted, so the
 *        DATABASE authorises: claim_credited_notification re-verifies the
 *        caller owns the post, requires the credited sighting to exist, and is
 *        idempotent — replaying it sends nothing. Every refusal is the same
 *        {claimed:false}, so this endpoint is no oracle.
 *
 *        HONEST LIMITATION, same as notify-sighting: the owner's app dying
 *        between the credit and this call means the spotter is not pushed.
 *        Nothing is lost permanently — the credit stands and /payouts shows
 *        it — and the pg_net trigger remains the named fix.
 * LINKS: ../_shared/push.ts (sendToUsers);
 *        supabase/migrations/20260804100000_credited_notification.sql
 *          (claim_credited_notification — the copy is built THERE);
 *        src/features/notifications/lib/pushRoute.ts (credited → /payouts);
 *        docs/DOMAIN.md (prompt at first credited sighting).
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

  let postId: string;
  try {
    const body = (await request.json()) as { postId?: string };
    if (!body.postId) throw new Error('postId required');
    postId = body.postId;
  } catch {
    return errorResponse('BAD_REQUEST', 'postId is required.', 400);
  }

  try {
    const { data: claim, error } = await admin.rpc('claim_credited_notification', {
      p_post_id: postId,
      p_actor: actor,
    });
    if (error) {
      console.error('[notifications] credited claim failed', error.message);
      return errorResponse('CLAIM_FAILED', 'Could not claim the credit.', 500);
    }
    if (!claim?.claimed) {
      return jsonResponse({ claimed: false });
    }

    // Persist-then-push (THE RULE): a spotter with push denied learns they
    // earned money from the center — previously they learned it never.
    const result = await notifyUsers(admin, [claim.user_id as string], {
      kind: 'credited',
      title: claim.title as string,
      body: claim.body as string,
      data: { type: 'credited', postId: claim.post_id as string },
      // One credit per post, ever — the collapse key is belt and braces
      // against a replayed delivery, not against volume.
      collapseKey: `credited:${claim.post_id as string}`,
    });

    console.log('[notifications] credited notified', { sent: result.accepted });
    return jsonResponse({ claimed: true, sent: result.accepted });
  } catch (err) {
    console.error('[notifications] notify-credited failed', (err as Error).message);
    return errorResponse('NOTIFY_FAILED', 'Could not notify the spotter.', 500);
  }
});
