/**
 * WHAT:  Sends the spotter alert when a post goes live — claims the post,
 *        matches enabled alert zones with PostGIS, and fans out one push.
 * WHY:   This is the missing half of the core loop: without it nobody learns a
 *        car went missing near them unless they happen to open the app.
 *        Invoked fire-and-forget by stripe-webhook after the payment is
 *        recorded. It claims `posts.alerts_sent_at` ITSELF rather than
 *        trusting the caller, because that webhook records its dedupe row
 *        AFTER the handler runs — so a Stripe retry re-runs everything, and
 *        the claim is what makes that safe without touching the money path.
 *        SERVICE-TO-SERVICE ONLY: an authenticated user must never be able to
 *        trigger a fan-out to every spotter in a 50-mile radius.
 * LINKS: ../_shared/push.ts (sendToUsers, drainPushReceipts);
 *        supabase/migrations/20260802130000_alert_matching.sql
 *        (claim_post_alerts, match_alert_zones — the copy is built THERE so
 *        its privacy is covered by npm run test:db);
 *        src/features/notifications/README.md.
 */

import { drainPushReceipts, notifyUsers } from '../_shared/push.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use POST.', 405);
  }

  // NOT admin.auth.getUser: this is machine-to-machine. Compare the bearer
  // against the service-role key so no user JWT can ever reach this.
  const bearer = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  if (bearer !== requireEnv('SUPABASE_SERVICE_ROLE_KEY')) {
    return errorResponse('NOT_AUTHORISED', 'Service role required.', 401);
  }

  let postId: string;
  try {
    const body = (await request.json()) as { postId?: string };
    if (!body.postId) throw new Error('postId required');
    postId = body.postId;
  } catch {
    return errorResponse('BAD_REQUEST', 'postId is required.', 400);
  }

  const admin = createServiceRoleClient();

  // Opportunistic receipt drain (no pg_cron here). Fire-and-forget: it must
  // never delay or fail the alert it is riding along with.
  void drainPushReceipts(admin).catch((err) =>
    console.error('[notifications] receipt drain failed', (err as Error).message),
  );

  try {
    // 1. Claim. Zero rows means already alerted OR not active — either way
    //    there is nothing to do and it is not an error.
    const { data: claim, error: claimError } = await admin.rpc('claim_post_alerts', {
      p_post_id: postId,
    });
    if (claimError) {
      console.error('[notifications] claim failed', claimError.message);
      return errorResponse('CLAIM_FAILED', 'Could not claim the post.', 500);
    }
    if (!claim?.claimed) {
      return jsonResponse({ claimed: false });
    }

    // 2. Match zones, apply the per-user cap, and get the copy (built in SQL).
    const { data: match, error: matchError } = await admin.rpc('match_alert_zones', {
      p_post_id: postId,
    });
    if (matchError) {
      console.error('[notifications] match failed', matchError.message);
      return errorResponse('MATCH_FAILED', 'Could not match alert zones.', 500);
    }

    const ownerId = claim.owner_id as string;
    // Braces to the SQL's belt (the house pattern from deactivate-post): the
    // owner exclusion is enforced in the query too, but an owner receiving
    // "a car was reported stolen near you" about their OWN theft would be a
    // uniquely bad bug, so it is re-imposed here.
    const userIds = ((match?.user_ids ?? []) as string[]).filter((id) => id !== ownerId);

    if (userIds.length === 0) {
      console.log('[notifications] alerts sent', { postId, matched: 0, sent: 0 });
      return jsonResponse({ claimed: true, matched: 0, sent: 0 });
    }

    // Persist-then-push (THE RULE): the feed row lands even for spotters
    // with push denied — the center is how they hear about it at all.
    const result = await notifyUsers(admin, userIds, {
      kind: 'alert',
      title: match.title as string,
      body: match.body as string,
      // Ids only — the client re-fetches everything else through RLS.
      data: { type: 'alert', postId },
      collapseKey: `alert:${postId}`,
    });

    // Counts and a post id only. No user ids, no tokens, no locality.
    console.log('[notifications] alerts sent', {
      postId,
      matched: userIds.length,
      sent: result.accepted,
      pruned: result.pruned,
    });
    return jsonResponse({ claimed: true, matched: userIds.length, sent: result.accepted });
  } catch (err) {
    console.error('[notifications] notify-spotters failed', (err as Error).message);
    return errorResponse('NOTIFY_FAILED', 'Could not send spotter alerts.', 500);
  }
});
