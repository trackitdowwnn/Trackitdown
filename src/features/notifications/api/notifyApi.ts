/**
 * WHAT:  Fire-and-forget triggers for the two notifications a user's own
 *        action causes — a sighting they reported, a message they sent.
 * WHY:   One door, so no feature grows its own functions.invoke and its own
 *        idea of what to do when a push fails. These are deliberately VOID and
 *        never throw: a notification is a side effect of the user's action,
 *        never a reason to fail it. Someone who reports a sighting has done
 *        their bit the moment the row lands — whether the owner's phone buzzes
 *        is not their problem to see an error about.
 *        Authorisation lives in the DATABASE, not here: the claim RPCs behind
 *        these functions verify the caller actually wrote the row, so a forged
 *        id from a patched client notifies nobody.
 *        HONEST LIMITATION: client-invoked, so an app killed mid-call notifies
 *        nobody. Nothing is lost permanently (both are visible in-app); a DB
 *        trigger with pg_net would close it.
 * LINKS: supabase/functions/notify-sighting/index.ts,
 *        supabase/functions/notify-message/index.ts;
 *        src/features/sightings/api/sightingApi.ts and
 *        src/features/chat/api/chatApi.ts (the callers).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('notifications');

function dispatch(
  fn: 'notify-sighting' | 'notify-message' | 'notify-credited',
  body: Record<string, string>,
): void {
  // The try/catch is NOT redundant with the .catch(): if invoke throws
  // SYNCHRONOUSLY (a misconfigured client), no promise is ever created, so
  // .catch() is never attached and the error would propagate straight into
  // the caller's action — turning a successful send into a failed one.
  try {
    void supabase.functions
      .invoke(fn, { body })
      .then(({ error }) => {
        // Warn only — there is nothing the user could do about it, and the
        // in-app surfaces already reflect what happened.
        if (error) log.warn('notify_dispatch_failed', { fn });
      })
      .catch(() => {
        // Offline or the function isn't deployed yet. Silent by design.
      });
  } catch {
    log.warn('notify_dispatch_failed', { fn });
  }
}

/** Tell the post's owner their car was sighted. */
export function notifySighting(sightingId: string): void {
  dispatch('notify-sighting', { sightingId });
}

/** Tell the other participant a message arrived. Content never travels. */
export function notifyMessage(messageId: string): void {
  dispatch('notify-message', { messageId });
}

/** Tell the credited spotter they earned the bounty — the earn moment. The
 *  amount is computed server-side (payout_split, in the claim RPC); this
 *  carries only the post id. */
export function notifyCredited(postId: string): void {
  dispatch('notify-credited', { postId });
}
