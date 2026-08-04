/**
 * WHAT:  The client boundary to the bounty-escrow money Edge Functions — opens
 *        (or reuses) the escrow PaymentIntent for a draft post (charge), and
 *        deactivates a paid post with a bounty refund (deactivate). Both send
 *        only the post id; the server reads the authoritative amount and moves
 *        the money state. Translates each function's { code } errors into plain
 *        English for the caller's error line.
 * WHY:   The client never computes or sends the amount (SECURITY_AND_TRUST §4);
 *        it sends only the post id and the server reads the authoritative bounty
 *        / refund. This is the single place the app calls these functions, so the
 *        error-code→message mapping and the typed error live in one auditable
 *        spot, mirroring postApi's PostSubmissionError.
 * LINKS: supabase/functions/create-payment-intent/index.ts +
 *          supabase/functions/deactivate-post/index.ts (the codes mapped here);
 *        src/features/payments/hooks/useBountyPayment.ts (presents the sheet with
 *          the returned secret); src/features/payments/hooks/useDeactivatePost.ts
 *          (drives the refund); src/features/vehicles/post/screens/
 *          PostACarScreen.tsx (orchestrates submit → pay).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import { PaymentError, parseFunctionError } from './functionError';

// Re-exported so every existing `import { PaymentError } from './paymentsApi'`
// and `instanceof PaymentError` caller is untouched by the 2026-08-03 split.
export { PaymentError };

const log = createLogger('payments');

/**
 * Codes the create-payment-intent function returns → user-facing copy. Any
 * unmapped/unknown failure (network, 5xx) falls back to the generic line.
 */
export const CREATE_PAYMENT_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in to pay.',
  POST_NOT_FOUND: 'We couldn’t find that post.',
  POST_NOT_DRAFT: 'This post has already been submitted.',
  STRIPE_ERROR: 'We couldn’t start your payment. Please try again.',
  LEDGER_ERROR: 'We couldn’t start your payment. Please try again.',
  LOOKUP_FAILED: 'We couldn’t start your payment. Please try again.',
};

const CREATE_PAYMENT_FALLBACK = 'We couldn’t start your payment. Please try again.';

/** Codes the deactivate-post function returns → user-facing copy. */
export const DEACTIVATE_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in.',
  POST_NOT_FOUND: 'We couldn’t find that post.',
  POST_NOT_REFUNDABLE: 'This listing can’t be deactivated for a refund.',
  NO_HELD_PAYMENT: 'We couldn’t find the escrow for this listing.',
  STRIPE_ERROR: 'We couldn’t deactivate your listing. Please try again.',
  LEDGER_ERROR: 'Your refund is processing. Please check back shortly.',
  LOOKUP_FAILED: 'We couldn’t deactivate your listing. Please try again.',
  // Both belong to the owner-denial gate. REQUIRED should never surface (the
  // screen pre-flights via exitCheck); STALE is real: a sighting landed while
  // they were confirming, and the honest answer is "look again".
  ATTESTATION_REQUIRED: 'This listing has recent sightings to look at first.',
  ATTESTATION_STALE: 'A new sighting arrived while you were confirming. Please look again.',
};

const DEACTIVATE_FALLBACK = 'We couldn’t deactivate your listing. Please try again.';

/**
 * Open (or reuse) the escrow PaymentIntent for a draft post and return its
 * client secret. The Edge Function verifies ownership + draft state and reads
 * the bounty amount from the DB — this call carries only the post id. Throws a
 * PaymentError with user-facing copy on any failure.
 */
export async function createBountyPaymentIntent(postId: string): Promise<string> {
  log.debug('create-payment-intent invoke', { postId });
  const { data, error } = await supabase.functions.invoke<{ clientSecret: string }>(
    'create-payment-intent',
    { body: { postId } },
  );

  if (error) {
    const paymentError = await parseFunctionError(
      error,
      CREATE_PAYMENT_ERROR_MESSAGES,
      CREATE_PAYMENT_FALLBACK,
    );
    log.warn('create-payment-intent failed', { code: paymentError.code });
    throw paymentError;
  }
  if (!data?.clientSecret) {
    log.error('create-payment-intent returned no client secret');
    throw new PaymentError(CREATE_PAYMENT_FALLBACK, 'BAD_SHAPE');
  }

  log.info('escrow PaymentIntent ready', { postId });
  return data.clientSecret;
}

/**
 * What deactivation did with the money. Two honest answers now: refunded
 * (server-authoritative pence), or HELD — the listing is down but the refund
 * waits out the 72-hour dispute window because recent sightings exist.
 */
export type DeactivateResult =
  | {
      held: false;
      /** Amount returned to the owner = bounty − non-recoverable card fee. */
      refundedPence: number;
      /** The withheld Stripe processing fee. */
      feePence: number;
    }
  | { held: true; refundAfter: string };

/** The exit pre-flight: must the owner attest to recent sightings first? */
export interface ExitCheck {
  requiresAttestation: boolean;
  sightingIds: string[];
  windowDays: number;
  holdHours: number;
}

/**
 * Ask whether an exit-with-refund on this post needs the attestation step,
 * and for exactly which sightings. Server-derived (the one SQL definition of
 * "recent uncredited") so the client can never show fewer sightings than the
 * server would hold for.
 */
export async function exitCheck(postId: string): Promise<ExitCheck> {
  const { data, error } = await supabase.rpc('exit_check', { p_post_id: postId });
  if (error) {
    log.warn('exit_check failed', { code: error.code });
    throw new PaymentError(DEACTIVATE_FALLBACK, error.code ?? 'UNKNOWN');
  }
  const doc = data as Partial<ExitCheck> | null;
  return {
    requiresAttestation: Boolean(doc?.requiresAttestation),
    sightingIds: Array.isArray(doc?.sightingIds) ? doc.sightingIds : [],
    windowDays: typeof doc?.windowDays === 'number' ? doc.windowDays : 14,
    holdHours: typeof doc?.holdHours === 'number' ? doc.holdHours : 72,
  };
}

/**
 * Deactivate a PAID post and refund its bounty (minus the non-recoverable card
 * fee). The Edge Function verifies ownership + refund-eligibility, issues the
 * Stripe refund, and moves the post to `cancelled` — this call carries only
 * the post id, plus (when the attestation step ran) the sighting ids the owner
 * was shown. Throws a PaymentError with user-facing copy on any failure.
 */
export async function deactivatePost(
  postId: string,
  attestedSightingIds?: string[],
): Promise<DeactivateResult> {
  log.debug('deactivate-post invoke', { postId });
  const { data, error } = await supabase.functions.invoke<DeactivateResult>('deactivate-post', {
    body: attestedSightingIds ? { postId, attestedSightingIds } : { postId },
  });

  if (error) {
    const paymentError = await parseFunctionError(
      error,
      DEACTIVATE_ERROR_MESSAGES,
      DEACTIVATE_FALLBACK,
    );
    log.warn('deactivate-post failed', { code: paymentError.code });
    throw paymentError;
  }
  if (data?.held === true && typeof data.refundAfter === 'string') {
    log.info('listing deactivated + refund held', { postId });
    return data;
  }
  if (data?.held === false && typeof data.refundedPence === 'number') {
    log.info('listing deactivated + refunded', { postId, refundedPence: data.refundedPence });
    return data;
  }
  log.error('deactivate-post returned an unexpected shape');
  throw new PaymentError(DEACTIVATE_FALLBACK, 'BAD_SHAPE');
}
