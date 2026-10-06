/**
 * WHAT:  The client boundary for changing the reward on a LIVE listing — or
 *        adding one to a £5 fee listing: read the owner's reward status,
 *        choose the next amount, and open the charge for it.
 * WHY:   Same rule as the first charge (SECURITY_AND_TRUST §4): the charge
 *        call carries ONLY the post id. The amount travels separately, under
 *        the owner's own JWT, through set_reward_renewal_amount — which checks
 *        the range and the lowering rule — and the Edge Function reads it back
 *        from the row. Every refusal comes back as one token, translated here
 *        so the screen shows plain English and never a code.
 * LINKS: supabase/migrations/20261005130000_a_reward_can_be_changed.sql
 *          (set_reward_renewal_amount, get_my_reward_status, the block tokens);
 *        supabase/functions/create-payment-intent/index.ts (chargeRewardChange);
 *        src/features/payments/screens/ChangeRewardScreen.tsx (the caller).
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { MAX_BOUNTY_PENCE, MIN_BOUNTY_PENCE } from '@/shared/lib/bountyBounds';
import { PaymentError, parseFunctionError } from '@/shared/lib/functionError';
import { createLogger } from '@/shared/lib/logger';
import { formatPounds } from '@/shared/lib/money';
import type { PostStatus } from '@/shared/types';

const log = createLogger('payments');

const FALLBACK = 'We couldn’t change your reward. Please try again.';

/**
 * THE one wording of the lowering rule — the change screen's lede says it
 * before the owner tries, and REWARD_LOWER_BLOCKED says it if they do, so the
 * two can never describe the rule differently.
 */
export const LOWERING_RULE_SENTENCE =
  'You’ve had recent sightings, so you can raise your reward but not lower it.';

/**
 * Every refusal the change path can give → copy. Shared by the amount RPC and
 * the charge function, because they enforce the same rules (one SQL
 * definition, reward_change_block) and the owner should read the same words.
 */
export const CHANGE_REWARD_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to log in.',
  POST_NOT_FOUND: 'We couldn’t find that listing.',
  POST_NOT_LIVE: 'This listing isn’t live, so its reward can’t change.',
  REWARD_REVIEW_PENDING:
    'Your reward can’t change while a recovery or a dispute on this listing is being sorted out.',
  REFUND_PENDING:
    'Your last change is still being refunded. Please try again in a few minutes.',
  REWARD_LOWER_BLOCKED: LOWERING_RULE_SENTENCE,
  // Built from the bounds, never typed out: postSteps.tsx records the same
  // copy going stale ("From £50") when the floor moved to £10.
  BOUNTY_OUT_OF_RANGE: `Choose a reward between ${formatPounds(MIN_BOUNTY_PENCE)} and ${formatPounds(MAX_BOUNTY_PENCE)}.`,
  NO_AMOUNT: FALLBACK,
  RENEWAL_STALE: 'Your reward just changed. Please check it and try again.',
  BOUNTY_MISMATCH: 'Your reward just changed. Please check it and try again.',
  PAYMENT_IN_PROGRESS:
    'Your payment is already going through. Your listing will update in a moment.',
  STRIPE_ERROR: 'We couldn’t start your payment. Please try again.',
  LEDGER_ERROR: 'We couldn’t start your payment. Please try again.',
  LOOKUP_FAILED: 'We couldn’t start your payment. Please try again.',
};

/** A raised SQL token arrives as the error message; find which one it is. */
function codeFromRpcMessage(message: string | undefined): string {
  if (!message) {
    return 'UNKNOWN';
  }
  return Object.keys(CHANGE_REWARD_ERROR_MESSAGES).find((code) => message.includes(code)) ?? 'UNKNOWN';
}

function rpcError(error: { message?: string }): PaymentError {
  const code = codeFromRpcMessage(error.message);
  return new PaymentError(CHANGE_REWARD_ERROR_MESSAGES[code] ?? FALLBACK, code);
}

const rewardStatusSchema = z.object({
  // Parsed, not cast: rewardTerm gates the term on it. A status this build
  // doesn't know degrades to undefined (→ null) rather than failing the read.
  postStatus: z
    .enum([
      'draft',
      'pending_verification',
      'active',
      'recovery_claimed',
      'recovered',
      'recovered_no_spotter',
      'cancelled',
      'expired',
      'rejected',
    ])
    .optional()
    .catch(undefined),
  mode: z.enum(['change', 'add']),
  rewardId: z.string().nullable(),
  amountPence: z.number().int().nullable(),
  capturedAt: z.string().nullable(),
  // Optional for one deploy's worth of skew: an app updated before the
  // server still parses the old shape (memory: widen client schemas first).
  termEndsAt: z.string().nullable().optional(),
  legacyTerm: z.boolean().optional(),
  // The last reward ended and went back (20261006100000) — optional for the
  // same skew.
  rewardEndedAt: z.string().nullable().optional(),
  endedRewardPence: z.number().int().positive().nullable().optional(),
  feeAbsorbed: z.boolean(),
  hasRecentSightings: z.boolean(),
  block: z.string().nullable(),
});

export interface RewardStatus {
  /** The listing's lifecycle status. A term is only news on a LIVE listing:
   *  a cancelled one's held reward is being refunded, a recovery_claimed
   *  one's is being decided — neither "runs until" anything. */
  postStatus: PostStatus | null;
  /** change = a reward is held and would be replaced; add = none (a fee listing). */
  mode: 'change' | 'add';
  /** Changes exactly when the reward does — what the screen polls for. */
  rewardId: string | null;
  amountPence: number | null;
  /** When the current reward was charged (ISO), if there is one. */
  capturedAt: string | null;
  /** When its 60-day term ends (ISO) — null until it has one (ADR-0020). */
  termEndsAt: string | null;
  /** A reward from before the term existed: its END-OF-TERM refund is made
   *  in full (the platform absorbs the card fee). Other refunds are unchanged. */
  legacyTerm: boolean;
  /** When the refund of a reward that ended unrenewed was recorded (ISO) —
   *  set only while no reward is held (ADR-0020). */
  rewardEndedAt: string | null;
  /** That ended reward's amount — set together with rewardEndedAt. */
  endedRewardPence: number | null;
  /** The current reward's refund returns the full amount (no card fee kept). */
  feeAbsorbed: boolean;
  /** Recent uncredited sightings exist, so the reward can't be lowered. */
  hasRecentSightings: boolean;
  /** Why it can't change right now, already in plain English — or null. */
  blockedMessage: string | null;
}

/** The owner's view of their listing's reward. Throws a PaymentError. */
export async function fetchMyRewardStatus(postId: string): Promise<RewardStatus> {
  const { data, error } = await supabase.rpc('get_my_reward_status', { p_post_id: postId });
  if (error) {
    log.warn('get_my_reward_status failed', { code: codeFromRpcMessage(error.message) });
    throw rpcError(error);
  }
  const parsed = rewardStatusSchema.safeParse(data);
  if (!parsed.success) {
    log.error('get_my_reward_status returned an unexpected shape');
    throw new PaymentError(FALLBACK, 'BAD_SHAPE');
  }
  const doc = parsed.data;
  return {
    postStatus: doc.postStatus ?? null,
    mode: doc.mode,
    rewardId: doc.rewardId,
    amountPence: doc.amountPence,
    capturedAt: doc.capturedAt,
    termEndsAt: doc.termEndsAt ?? null,
    legacyTerm: doc.legacyTerm ?? false,
    rewardEndedAt: doc.rewardEndedAt ?? null,
    endedRewardPence: doc.endedRewardPence ?? null,
    feeAbsorbed: doc.feeAbsorbed,
    hasRecentSightings: doc.hasRecentSightings,
    blockedMessage: doc.block ? (CHANGE_REWARD_ERROR_MESSAGES[doc.block] ?? FALLBACK) : null,
  };
}

/**
 * Choose the amount for the next reward charge. The server checks the range,
 * the lowering rule and every block, under the owner's JWT. Throws a
 * PaymentError with user-facing copy.
 */
export async function setRewardRenewalAmount(postId: string, amountPence: number): Promise<void> {
  const { error } = await supabase.rpc('set_reward_renewal_amount', {
    p_post_id: postId,
    p_amount_pence: amountPence,
  });
  if (error) {
    log.warn('set_reward_renewal_amount failed', { code: codeFromRpcMessage(error.message) });
    throw rpcError(error);
  }
}

/**
 * Open (or reuse) the charge for the chosen amount and return its client
 * secret. MONEY: the body is the post id and nothing else — the Edge Function
 * reads the amount from the row set_reward_renewal_amount wrote.
 */
export async function createRewardChangeIntent(postId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ clientSecret: string }>(
    'create-payment-intent',
    { body: { postId } },
  );
  if (error) {
    const paymentError = await parseFunctionError(error, CHANGE_REWARD_ERROR_MESSAGES, FALLBACK);
    log.warn('reward change intent failed', { code: paymentError.code });
    throw paymentError;
  }
  if (!data?.clientSecret) {
    log.error('reward change intent returned no client secret');
    throw new PaymentError(FALLBACK, 'BAD_SHAPE');
  }
  return data.clientSecret;
}
