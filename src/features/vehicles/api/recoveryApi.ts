/**
 * WHAT:  The two calls that close a recovery — `claim_recovery` (who won) and
 *        the `refund-recovery` Edge Function (the no-spotter ending).
 * WHY:   DOMAIN.md's lifecycle splits this deliberately, and the client has to
 *        follow the same split. `claim_recovery` records the CLAIM and the
 *        winner but moves no money, landing the post on `recovery_claimed`;
 *        the terminal states mean the money has ALREADY moved
 *        (`recovered` = paid, `recovered_no_spotter` = refunded), so only a
 *        server that has heard back from Stripe may set them.
 *
 *        So a recovery is two calls, and the RPC tells us which second call to
 *        make via `nextStep` — named by the server rather than re-derived here,
 *        so the client never has to guess the money path from a status.
 *
 * MONEY: no amount is ever sent from the client. The refund is computed
 *        server-side from the ledger and Stripe's own balance transaction.
 * LINKS: supabase/migrations/20260802200000_claim_recovery.sql;
 *        supabase/functions/refund-recovery/index.ts;
 *        src/features/payments/api/paymentsApi.ts (the error-code pattern
 *          mirrored here); docs/DOMAIN.md (lifecycle 4-6).
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('vehicles');

/** What the server says has to happen next to finish the recovery. */
export type RecoveryNextStep = 'payout' | 'refund';

export interface ClaimRecoveryResult {
  nextStep: RecoveryNextStep;
  creditedSightingId: string | null;
}

/** Carries user-facing copy plus the server's machine code for logging/tests. */
export class RecoveryError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'RecoveryError';
    this.code = code;
  }
}

/** Server codes worth their own words. Anything else gets the fallback — a raw
 *  server message is never shown, so a 500's internals cannot reach a screen. */
const CLAIM_MESSAGES: Record<string, string> = {
  NOT_OWNER: 'Only the owner of a listing can mark it recovered.',
  POST_NOT_ACTIVE:
    'This listing isn’t live, so it can’t be marked recovered. It may already be closed.',
  SIGHTING_NOT_ON_POST: 'That sighting belongs to a different listing.',
  CANNOT_CREDIT_OWN_SIGHTING: 'You can’t credit your own sighting.',
  NOT_AUTHENTICATED: 'Please sign in again, then try once more.',
};

const REFUND_MESSAGES: Record<string, string> = {
  RECOVERY_HAS_CREDITED_SIGHTING:
    'You credited a spotter for this recovery, so the bounty goes to them.',
  POST_NOT_CLAIMED: 'This listing isn’t waiting on a recovery.',
  NO_HELD_PAYMENT: 'We couldn’t find the bounty for this listing.',
};

const FALLBACK = 'Something went wrong. Please try again.';

const messageFor = (map: Record<string, string>, code: string): string =>
  // Own-property lookup: bracket access also resolves inherited keys, so a code
  // of 'constructor' would otherwise map to a function.
  Object.hasOwn(map, code) ? map[code] : FALLBACK;

/**
 * Mark a post recovered, crediting ONE sighting or none.
 *
 * Passing null is the "I found it myself" answer, and it is a real answer —
 * not a failure to choose.
 */
export async function claimRecovery(
  postId: string,
  sightingId: string | null,
): Promise<ClaimRecoveryResult> {
  const { data, error } = await supabase.rpc('claim_recovery', {
    p_post_id: postId,
    p_sighting_id: sightingId,
  });

  if (error) {
    // The RPC raises bare codes as the message; match on inclusion because
    // Postgres wraps them in its own prefix.
    const code =
      Object.keys(CLAIM_MESSAGES).find((known) => error.message.includes(known)) ??
      'UNKNOWN';
    log.warn('claim_recovery failed', { postId, code });
    throw new RecoveryError(messageFor(CLAIM_MESSAGES, code), code);
  }

  const result = data as { nextStep?: string; creditedSightingId?: string | null };
  const nextStep: RecoveryNextStep = result?.nextStep === 'payout' ? 'payout' : 'refund';
  log.info('recovery_claimed', { postId, nextStep });
  return { nextStep, creditedSightingId: result?.creditedSightingId ?? null };
}

export interface RecoveryRefundResult {
  refundedPence: number;
}

/**
 * Finish a no-spotter recovery: refund the bounty and close the post.
 *
 * MONEY: the amount comes back FROM the server. Never send one.
 */
export async function refundRecovery(postId: string): Promise<RecoveryRefundResult> {
  const { data, error } = await supabase.functions.invoke('refund-recovery', {
    body: { postId },
  });

  if (error) {
    let code = 'UNKNOWN';
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { code?: string };
        code = body.code ?? 'UNKNOWN';
      } catch {
        // Non-JSON body (a gateway page); the fallback copy covers it.
      }
    }
    log.warn('refund_recovery failed', { postId, code });
    throw new RecoveryError(messageFor(REFUND_MESSAGES, code), code);
  }

  const result = data as { refundedPence?: number };
  log.info('recovery_refunded', { postId });
  return { refundedPence: result?.refundedPence ?? 0 };
}
