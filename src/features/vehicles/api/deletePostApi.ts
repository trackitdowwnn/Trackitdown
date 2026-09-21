/**
 * WHAT:  The client boundary to the delete-post Edge Function. Sends only the
 *        post id and translates the function's { code } errors into plain
 *        English for the caller's error line.
 * WHY:   delete_cancelled_post is SERVICE-ROLE ONLY and deliberately ungranted
 *        to `authenticated`: the Edge Function is where "who is asking" is
 *        proven from a JWT, so this cannot be an RPC call. Mirrors draftApi.ts
 *        exactly — same shape, same PaymentError, same one-place-for-copy rule
 *        (functionError.ts: "ONE error class, deliberately").
 *
 *        Two codes deliberately do NOT say "please try again", because a retry
 *        cannot make them succeed:
 *          · DISPUTE_OPEN — a spotter's dispute is being reviewed; the delete
 *            unblocks when it resolves, not when the owner retries.
 *          · PAYMENT_REVIEW_OPEN — a payout review is open; that is a human's
 *            queue, so it routes to support.
 *        MONEY_IN_FLIGHT names its own fix: the refund finishing (the 72-hour
 *        hold window at most). INTENT_NOT_CANCELLED is the one where retrying
 *        genuinely IS the fix — a payment the server could not prove dead,
 *        usually one opened on another device mid-flight — so its copy asks
 *        for the retry with a reason.
 * LINKS: supabase/functions/delete-post/index.ts (the codes mapped here);
 *        supabase/migrations/20260921100000_a_cancelled_post_can_be_deleted.sql;
 *        src/shared/lib/functionError.ts (parseFunctionError);
 *        src/features/vehicles/screens/PostDetailScreen.tsx (the caller).
 */

import { parseFunctionError } from '@/shared/lib/functionError';
import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('vehicles');

/** Codes delete-post returns → user-facing copy. */
export const DELETE_POST_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in.',
  POST_NOT_FOUND: 'We couldn’t find that post.',
  POST_NOT_CANCELLED: 'Only a cancelled listing can be deleted. Deactivate it first.',
  MONEY_IN_FLIGHT:
    'Your refund is still being processed. You can delete this post once it’s done.',
  DISPUTE_OPEN: 'A sighting on this post is being reviewed, so it can’t be deleted yet.',
  INTENT_NOT_CANCELLED:
    'A payment on this post is still being processed. Please try again in a moment.',
  PAYMENT_REVIEW_OPEN:
    'A payment on this post is being reviewed. Contact support and we’ll sort it.',
  LOOKUP_FAILED: 'We couldn’t delete that post. Please try again.',
  DELETE_FAILED: 'We couldn’t delete that post. Please try again.',
};

const DELETE_POST_FALLBACK = 'We couldn’t delete that post. Please try again.';

/**
 * Permanently delete an owner's own CANCELLED listing. Throws PaymentError
 * with user-facing copy on any failure.
 *
 * ⚠️ IRREVERSIBLE, and the caller must have confirmed first: the post, its
 * sightings, its chats and its photos all go. The money record stays — the
 * server detaches the ledger row rather than deleting it. A cancelled post the
 * owner never deletes goes on its own at 30 days (purge_cancelled_posts), so
 * this is "now", not "ever".
 */
export async function deleteCancelledPost(postId: string): Promise<void> {
  log.debug('delete-post invoke', { postId });
  const { error } = await supabase.functions.invoke('delete-post', {
    body: { postId },
  });

  if (error) {
    const parsed = await parseFunctionError(
      error,
      DELETE_POST_ERROR_MESSAGES,
      DELETE_POST_FALLBACK,
    );
    log.warn('delete-post failed', { code: parsed.code });
    throw parsed;
  }

  log.info('cancelled_post_deleted', { postId });
}
