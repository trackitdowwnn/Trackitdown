/**
 * WHAT:  The calls that close a recovery — `claim_recovery` (who won), then
 *        ONE of `release-payout` (a spotter was credited), `refund-recovery`
 *        (the no-spotter ending), or NOTHING AT ALL on a no-reward listing.
 * WHY:   DOMAIN.md's lifecycle splits this deliberately, and the client has to
 *        follow the same split. On a BOUNTY listing `claim_recovery` records the
 *        CLAIM and the winner but moves no money, landing the post on
 *        `recovery_claimed`; the terminal states mean the money has ALREADY
 *        moved (`recovered` = paid, `recovered_no_spotter` = refunded), so only
 *        a server that has heard back from Stripe may set them.
 *
 *        So a recovery is two calls, and the RPC tells us which second call to
 *        make via `nextStep` — named by the server rather than re-derived here,
 *        so the client never has to guess the money path from a status.
 *
 *        A NO-REWARD LISTING (ADR-0014) has no money leg, so there is nothing
 *        for a second call to do: `claim_recovery` sets the terminal state
 *        itself and answers `nextStep: 'done'`. Making a second call anyway is
 *        not harmless — the post is no longer `recovery_claimed`, so
 *        refund-recovery answers POST_NOT_CLAIMED and a recovery that SUCCEEDED
 *        reaches the owner as an error. That is exactly what this file did until
 *        2026-08-20, by collapsing the unrecognised 'done' into 'refund'.
 *
 *        UNTIL 2026-08-03 THE PAYOUT HALF OF THAT SENTENCE WAS A LIE. Only the
 *        refund branch had a second call; `nextStep: 'payout'` showed a toast
 *        saying "we'll get the bounty to them" and invoked nothing, so every
 *        credited spotter's bounty stayed on the platform balance and the post
 *        stayed on `recovery_claimed` forever — which also permanently blocked
 *        the owner's account deletion. `release-payout` had been written and
 *        deployed; nothing called it.
 *
 * MONEY: no amount is ever sent from the client. Both the refund and the payout
 *        split are computed server-side from the ledger, and `mark_recovery_paid`
 *        re-derives the 95/5 independently and rejects a mismatch.
 * LINKS: supabase/migrations/20260802200000_claim_recovery.sql;
 *        supabase/functions/release-payout/index.ts;
 *        supabase/functions/refund-recovery/index.ts;
 *        src/features/payments/api/paymentsApi.ts (the error-code pattern
 *          mirrored here); docs/DOMAIN.md (lifecycle 4-6).
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('vehicles');

/**
 * What the server says has to happen next to finish the recovery.
 *
 * `done` (ADR-0014) means there is NOTHING left to do: a no-reward listing has
 * no money leg, so `claim_recovery` already put the post in its terminal state
 * and no second call follows. Calling one anyway is not harmless — the post is
 * no longer `recovery_claimed`, so `refund-recovery` answers POST_NOT_CLAIMED
 * and a SUCCESSFUL recovery would surface to the owner as an error.
 */
export type RecoveryNextStep = 'payout' | 'refund' | 'done';

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
  // The owner-denial gate. REQUIRED should never surface (the screen
  // pre-flights); STALE means a sighting landed mid-confirm.
  ATTESTATION_REQUIRED: 'This listing has recent sightings to look at first.',
  ATTESTATION_STALE: 'A new sighting arrived while you were confirming. Please look again.',
};

/**
 * Payout failures are worded for someone whose CREDIT HAS ALREADY LANDED. The
 * spotter is chosen and the money is committed either way, so none of these may
 * read as "that didn't work, do it again" — the claim cannot be redone, and
 * suggesting otherwise would send them back to a screen that now refuses them.
 */
const PAYOUT_MESSAGES: Record<string, string> = {
  POST_NOT_CLAIMED: 'This listing isn’t waiting on a payout. It may already be settled.',
  NO_CREDITED_SIGHTING: 'No spotter is credited on this listing.',
  NO_HELD_PAYMENT: 'We couldn’t find the bounty for this listing.',
  LEDGER_ERROR: 'The bounty is on its way. Please check back shortly.',
  STRIPE_ERROR: 'They’re credited, but sending the bounty didn’t go through. Try again from your listing.',
  POST_NOT_FOUND: 'We couldn’t find that listing.',
  NOT_AUTHENTICATED: 'Please sign in again, then try once more.',
  LOOKUP_FAILED: 'They’re credited. Try sending the bounty again from your listing.',
  SPLIT_ERROR: 'They’re credited, but we couldn’t work out the amount. Please contact us.',
  BAD_REQUEST: 'They’re credited. Try sending the bounty again from your listing.',
};

/**
 * The payout path gets its OWN fallback, and this is why.
 *
 * The shared `FALLBACK` is "Something went wrong. Please try again." — the exact
 * wording the map above exists to avoid, because by the time a payout can fail
 * the claim is already irreversible and "try again" points at a screen that
 * will now refuse them. And it is not a rare path: `releasePayout` labels every
 * non-HTTP failure `UNKNOWN`, so an ordinary dropped connection lands here.
 */
const PAYOUT_FALLBACK =
  'They’re credited. Try sending the bounty again from your listing.';

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
  // Read all three values explicitly. This used to be
  // `=== 'payout' ? 'payout' : 'refund'`, which silently turned the new 'done'
  // into 'refund' — sending a no-reward recovery into refund-recovery, which
  // 409s on a post that is already terminal. `refund` stays the fallback for an
  // unrecognised value: it is the branch that re-checks everything server-side.
  const nextStep: RecoveryNextStep =
    result?.nextStep === 'payout' ? 'payout' : result?.nextStep === 'done' ? 'done' : 'refund';
  log.info('recovery_claimed', { postId, nextStep });
  return { nextStep, creditedSightingId: result?.creditedSightingId ?? null };
}

/**
 * What the no-spotter refund did: refunded now, or HELD for the 72-hour
 * dispute window because recent uncredited sightings exist (the owner-denial
 * control — the claim stands either way, only the money waits).
 */
export type RecoveryRefundResult =
  | { held: false; refundedPence: number }
  | { held: true; refundAfter: string };

/**
 * Finish a no-spotter recovery: refund the bounty and close the post.
 *
 * MONEY: the amount comes back FROM the server. Never send one.
 * `attestedSightingIds` is what the owner was shown when they confirmed none
 * of the recent sightings helped — required by the server whenever such
 * sightings exist.
 */
export async function refundRecovery(
  postId: string,
  attestedSightingIds?: string[],
): Promise<RecoveryRefundResult> {
  const { data, error } = await supabase.functions.invoke('refund-recovery', {
    body: attestedSightingIds ? { postId, attestedSightingIds } : { postId },
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

  const result = data as { held?: boolean; refundedPence?: number; refundAfter?: string };
  if (result?.held === true && typeof result.refundAfter === 'string') {
    log.info('recovery_refund_held', { postId });
    return { held: true, refundAfter: result.refundAfter };
  }
  log.info('recovery_refunded', { postId });
  return { held: false, refundedPence: result?.refundedPence ?? 0 };
}

/**
 * What happened to the bounty. `awaiting_payee` is a SUCCESS, not a failure:
 * a spotter has no Stripe account until their first credited sighting, so
 * "they haven't onboarded yet" is the expected answer the first time. The
 * bounty stays in escrow and this call is safe to make again later.
 *
 * `held_for_review` is also not a failure, and must NEVER be blurred into
 * `awaiting_payee`: telling an owner "they still need to add bank details"
 * while we are actually double-checking the payout sends them to chase the
 * spotter about a delay that is ours. The money is safe; a human decides.
 */
export type PayoutStatus = 'paid' | 'awaiting_payee' | 'held_for_review';

export interface ReleasePayoutResult {
  status: PayoutStatus;
  /** What the spotter receives (95%). Absent until it has actually moved. */
  transferPence: number | null;
}

/**
 * Finish a credited recovery: transfer 95% of the bounty to the spotter.
 *
 * Safe to call more than once. The Edge Function carries a per-post transfer
 * idempotency key, so a retry after a dropped response returns the SAME
 * transfer rather than paying twice — which is what makes it correct to offer
 * this again from post detail when the first attempt was `awaiting_payee`.
 *
 * MONEY: no amount is sent. The split is derived server-side and checked twice.
 */
export async function releasePayout(postId: string): Promise<ReleasePayoutResult> {
  const { data, error } = await supabase.functions.invoke('release-payout', {
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
    log.warn('release_payout failed', { postId, code });
    throw new RecoveryError(
      Object.hasOwn(PAYOUT_MESSAGES, code) ? PAYOUT_MESSAGES[code] : PAYOUT_FALLBACK,
      code,
    );
  }

  const result = data as { status?: string; transferPence?: number };
  const status: PayoutStatus =
    result?.status === 'paid'
      ? 'paid'
      : result?.status === 'held_for_review'
        ? 'held_for_review'
        : 'awaiting_payee';
  // No amount in the log line — the event and the outcome, nothing else.
  log.info('recovery_paid', { postId, status });
  return { status, transferPence: result?.transferPence ?? null };
}
