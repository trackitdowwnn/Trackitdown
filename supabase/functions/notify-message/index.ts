/**
 * WHAT:  Tells the other participant in a thread that a message arrived.
 * WHY:   Chat shipped with this as an honest stub. This is that stub, wired.
 *        Invoked by the sending client right after send_message succeeds; the
 *        DATABASE authorises (claim_message_notification verifies the caller
 *        is the message's own sender, refuses system messages, and is
 *        idempotent).
 *        // SAFETY: message CONTENT never transits push. The body is the
 *        sender's FIRST NAME plus post context, built in SQL and covered by
 *        npm run test:db — a push crosses third-party infrastructure (Expo,
 *        then FCM/APNs) and SECURITY_AND_TRUST.md §3 forbids content there.
 *        The payload carries only the thread id; the app fetches the thread
 *        through RLS after the tap.
 * LINKS: ../_shared/push.ts (sendToUsers);
 *        supabase/migrations/20260802140000_notification_claims.sql
 *        (claim_message_notification); src/features/chat/README.md;
 *        docs/ROADMAP.md (the pinned payload contract).
 */

import { sendToUsers } from '../_shared/push.ts';
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

  let messageId: string;
  try {
    const body = (await request.json()) as { messageId?: string };
    if (!body.messageId) throw new Error('messageId required');
    messageId = body.messageId;
  } catch {
    return errorResponse('BAD_REQUEST', 'messageId is required.', 400);
  }

  try {
    const { data: claim, error } = await admin.rpc('claim_message_notification', {
      p_message_id: messageId,
      p_actor: actor,
    });
    if (error) {
      console.error('[notifications] message claim failed', error.message);
      return errorResponse('CLAIM_FAILED', 'Could not claim the message.', 500);
    }
    if (!claim?.claimed) {
      return jsonResponse({ claimed: false });
    }

    const result = await sendToUsers(admin, [claim.user_id as string], {
      title: claim.title as string,
      body: claim.body as string,
      data: { type: 'message', threadId: claim.thread_id as string },
      // Chat allows 20 messages per minute per thread and there is no per-user
      // push cap on this path (push_sends is the ALERT ledger). Collapsing per
      // thread is what stops a fast typist buzzing someone 20 times — the
      // recipient still sees every message in the thread.
      collapseKey: `message:${claim.thread_id as string}`,
    });

    // Counts only. No thread id: it correlates two identities (docs/LOGGING.md).
    console.log('[notifications] message notified', { sent: result.accepted });
    return jsonResponse({ claimed: true, sent: result.accepted });
  } catch (err) {
    console.error('[notifications] notify-message failed', (err as Error).message);
    return errorResponse('NOTIFY_FAILED', 'Could not notify the recipient.', 500);
  }
});
