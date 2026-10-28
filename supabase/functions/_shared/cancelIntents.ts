/**
 * WHAT:  Cancels PaymentIntents at Stripe and returns ONLY the ids Stripe
 *        confirms are `canceled` — the evidence delete_draft_post and
 *        forget_cancelled_draft_intents require before a ledger row may go.
 * WHY:   One implementation for the two draft paths (delete-draft,
 *        release-draft-intents). The list is evidence: a hopeful entry would let
 *        a still-live intent's row be removed, which both RPCs exist to prevent.
 *        Its only runtime import is ./log.ts, which Jest loads too.
 * LINKS: supabase/functions/delete-draft/index.ts;
 *        supabase/functions/release-draft-intents/index.ts;
 *        supabase/tests/cancelIntents.test.ts.
 */

import type Stripe from 'npm:stripe@22.4.0';
import { createLog } from './log.ts';
import { describeError } from './redact.ts';

const log = createLog('cancelIntents');

type IntentApi = Pick<Stripe['paymentIntents'], 'cancel' | 'retrieve'>;

export async function cancelAndProve(
  paymentIntents: IntentApi,
  intentIds: string[],
  logTag: string,
): Promise<string[]> {
  const cancelled: string[] = [];
  for (const intentId of intentIds) {
    try {
      const intent = await paymentIntents.cancel(intentId);
      if (intent.status === 'canceled') cancelled.push(intentId);
    } catch (err) {
      // An already-terminal intent cannot be cancelled: `succeeded` or
      // `processing` means money is moving (never proven), an already
      // `canceled` one is dead. Re-read it and trust only what Stripe says now.
      try {
        const current = await paymentIntents.retrieve(intentId);
        if (current.status === 'canceled') cancelled.push(intentId);
      } catch (retrieveErr) {
        // Cannot cancel it and cannot read it, so it is not proven. The RPC
        // finds its row unnamed and refuses, which is the correct outcome.
        log.warn('intent_state_unknown', {
          tag: logTag,
          error: describeError(retrieveErr),
          original: describeError(err),
        });
      }
    }
  }
  return cancelled;
}
