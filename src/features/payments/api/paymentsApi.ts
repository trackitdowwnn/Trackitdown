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

import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

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
};

const DEACTIVATE_FALLBACK = 'We couldn’t deactivate your listing. Please try again.';

/** Error carrying a plain-English `message` (shown to the user) plus a `code`
 *  for logging/tests. Thrown by createBountyPaymentIntent / deactivatePost. */
export class PaymentError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
  }
}

/** Pull the { error, code } body out of a non-2xx Edge Function response and map
 *  it to user-facing copy via the supplied `messages` map (+ `fallback`). */
async function parseFunctionError(
  error: unknown,
  messages: Record<string, string>,
  fallback: string,
): Promise<PaymentError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string; code?: string };
      const code = body.code ?? 'UNKNOWN';
      // Own-property lookup only: bracket access on a plain object STILL resolves
      // inherited keys (a `code` of 'toString'/'constructor' would map to a
      // function), so gate on Object.hasOwn before reading the map.
      const mapped = Object.hasOwn(messages, code) ? messages[code] : undefined;
      const message = mapped ?? body.error ?? fallback;
      return new PaymentError(message, code);
    } catch {
      return new PaymentError(fallback, 'UNKNOWN');
    }
  }
  // Network / relay error with no HTTP body.
  return new PaymentError(fallback, 'NETWORK');
}

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

/** What a successful deactivation refunded (server-authoritative pence). */
export interface DeactivateResult {
  /** Amount returned to the owner = bounty − non-recoverable card fee. */
  refundedPence: number;
  /** The withheld Stripe processing fee. */
  feePence: number;
}

/**
 * Deactivate a PAID post and refund its bounty (minus the non-recoverable card
 * fee). The Edge Function verifies ownership + refund-eligibility, issues the
 * Stripe refund, and moves the post to `cancelled` — this call carries only the
 * post id. Throws a PaymentError with user-facing copy on any failure.
 */
export async function deactivatePost(postId: string): Promise<DeactivateResult> {
  log.debug('deactivate-post invoke', { postId });
  const { data, error } = await supabase.functions.invoke<DeactivateResult>('deactivate-post', {
    body: { postId },
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
  if (typeof data?.refundedPence !== 'number') {
    log.error('deactivate-post returned no refund amount');
    throw new PaymentError(DEACTIVATE_FALLBACK, 'BAD_SHAPE');
  }

  log.info('listing deactivated + refunded', { postId, refundedPence: data.refundedPence });
  return data;
}
