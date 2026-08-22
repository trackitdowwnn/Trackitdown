/**
 * WHAT:  The client boundary to the delete-draft Edge Function. Sends only the
 *        post id and translates the function's { code } errors into plain
 *        English for the caller's error line.
 * WHY:   delete_draft_post is SERVICE-ROLE ONLY and deliberately ungranted to
 *        `authenticated`, so this cannot be an RPC call. The reason is the whole
 *        design: a draft may carry a live Stripe PaymentIntent, and every intent
 *        must be cancelled AT STRIPE before its ledger row is removed. Letting a
 *        client reach the RPC directly would hand it a way to skip that step.
 *
 *        So the Edge Function owns the ordering and this file owns the copy —
 *        one auditable place, exactly as paymentsApi.ts does for the charge
 *        path.
 *
 *        IT THROWS PaymentError, AND THAT IS ON PURPOSE. functionError.ts says
 *        it plainly: "ONE error class, deliberately — a sibling would mean every
 *        catch in the feature had to test two types to answer the same
 *        question, and the first one written would be the one someone forgot."
 *        Deleting a draft cancels PaymentIntents, so this is a money-adjacent
 *        path answering in the same { error, code } shape as its siblings; it
 *        gets the same class and the same parser rather than a near-copy of
 *        both.
 * LINKS: supabase/functions/delete-draft/index.ts (the codes mapped here);
 *        supabase/migrations/20260816110000_a_draft_delete_must_prove_the_intents_are_dead.sql;
 *        src/features/payments/api/functionError.ts (parseFunctionError);
 *        src/features/vehicles/components/PostManageSheet.tsx (the caller).
 */

import { parseFunctionError } from '@/features/payments/api/functionError';
import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('vehicles');

/**
 * Codes delete-draft returns → user-facing copy.
 *
 * Two are deliberately NOT "please try again", because that would loop someone
 * for ever on something that cannot succeed:
 *   · PAYMENT_EXISTS — money actually moved against this listing. No retry
 *     changes that, so it routes to a human.
 *   · INTENT_NOT_CANCELLED — a payment could not be PROVEN dead, usually one
 *     opened on another device mid-flight. Retrying genuinely is the fix, so
 *     the copy asks for it with a reason rather than a shrug.
 */
export const DELETE_DRAFT_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in.',
  POST_NOT_FOUND: 'We couldn’t find that draft.',
  POST_NOT_DRAFT: 'This listing has already been submitted and can’t be deleted.',
  PAYMENT_EXISTS:
    'This listing has a payment against it, so it can’t be deleted. Contact support and we’ll sort it.',
  INTENT_NOT_CANCELLED:
    'A payment on this draft is still being processed. Please try again in a moment.',
  LOOKUP_FAILED: 'We couldn’t delete that draft. Please try again.',
  DELETE_FAILED: 'We couldn’t delete that draft. Please try again.',
};

const DELETE_DRAFT_FALLBACK = 'We couldn’t delete that draft. Please try again.';

/**
 * Permanently delete an owner's own DRAFT listing. Throws PaymentError with
 * user-facing copy on any failure.
 *
 * ⚠️ IRREVERSIBLE, and the caller must have confirmed first. There is no
 * soft-delete and no `cancelled` tombstone, on purpose: a draft was never
 * published, nobody has seen it, no spotter is looking for that car and no money
 * moved. Parking it in a status would leave a permanent row in the owner's own
 * list recording that they once opened a form — which is the clutter they asked
 * to be rid of, wearing a different label.
 */
export async function deleteDraft(postId: string): Promise<void> {
  log.debug('delete-draft invoke', { postId });
  const { error } = await supabase.functions.invoke('delete-draft', {
    body: { postId },
  });

  if (error) {
    const parsed = await parseFunctionError(
      error,
      DELETE_DRAFT_ERROR_MESSAGES,
      DELETE_DRAFT_FALLBACK,
    );
    log.warn('delete-draft failed', { code: parsed.code });
    throw parsed;
  }

  log.info('draft_deleted', { postId });
}
