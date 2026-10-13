/**
 * WHAT:  payoutProgress — which step of getting paid a spotter is on, as the
 *        steps the Payouts tracker draws: your details → Stripe's check →
 *        payouts on → your reward sent.
 * WHY:   PR2 of the payments UX plan (2026-10-13, owner: "not much if any
 *        progress indicators"). The screen had a pill and a sentence for the
 *        state it was in, and nothing for the road: where this sits, what is
 *        behind them, what is still to come. Pure, so every state is pinned by
 *        a test without rendering a screen.
 *
 *        ⚠️ ONLY WHAT THE APP CAN ACTUALLY SEE. The payments ledger is never
 *        client-readable (payments_foundation's SAFETY note), so the last step
 *        knows "a reward is waiting" (my_pending_credit) and nothing later:
 *        not when it was sent, never when it reached a bank. It therefore
 *        never claims either. "Sent on 13 Oct" needs a caller-scoped RPC —
 *        PR2b, a migration of its own.
 *
 *        WHO IS WAITING ON WHOM is the point of each `detail`, as it is of the
 *        pill: "unfinished" waits on THEM, "verifying" on Stripe. Saying "all
 *        good, sit tight" to someone Stripe is waiting on would strand them.
 * LINKS: ../screens/PayoutsScreen.tsx; ../hooks/usePayoutAccount.ts;
 *        src/shared/ui/ProgressSteps.tsx; ./payoutProgress.test.ts.
 */

import { formatPounds } from '@/shared/lib/money';
import type { ProgressStep } from '@/shared/ui';

import type { PayoutAccountStatus } from '../hooks/usePayoutAccount';

export interface PayoutProgressInput {
  status: PayoutAccountStatus;
  /** usePayoutAccount's "just got back — still confirming" window. */
  settling: boolean;
  /** The credited-but-unsent reward, or null for none (undefined: still asking). */
  pendingCreditPence: number | null | undefined;
}

/**
 * The steps to draw, or null when a tracker would say nothing worth a glance:
 * a guest, a first load, an error, nothing to set up, or a spotter who is
 * ready with no reward waiting.
 */
export function payoutProgress({
  status,
  settling,
  pendingCreditPence,
}: PayoutProgressInput): ProgressStep[] | null {
  if (status === 'guest' || status === 'loading' || status === 'error') return null;
  // Still asking whether a reward waits — don't draw a road that may vanish.
  if (pendingCreditPence === undefined) return null;
  const credit = pendingCreditPence;
  // Credit-time setup: with nothing waiting, "not started" is the expected
  // state, and "ready" has nothing left to show.
  if (credit === null && (status === 'notStarted' || status === 'ready')) return null;

  const detailsDone = settling || status !== 'notStarted';
  const checkDone = status === 'ready';

  const steps: ProgressStep[] = [
    {
      id: 'details',
      label: 'Your details',
      state: detailsDone ? 'done' : 'current',
      detail: detailsDone ? undefined : 'Three short steps — about a minute.',
    },
    {
      id: 'check',
      label: 'Stripe’s check',
      state: checkDone ? 'done' : detailsDone ? 'current' : 'upcoming',
      detail: checkDone || !detailsDone ? undefined : checkDetail(status, settling),
    },
    {
      id: 'payouts-on',
      label: 'Payouts on',
      state: checkDone ? 'done' : 'upcoming',
    },
  ];

  if (credit !== null) {
    steps.push({
      id: 'reward',
      // A noun, like every label: "sent" beside a ring claimed what we
      // cannot see (UI review, 2026-10-13). The marker says how far it got.
      label: `Your ${formatPounds(credit)} reward`,
      // Payouts on with a reward still waiting means the release is under
      // way: it runs the moment an account becomes payable.
      state: checkDone ? 'current' : 'upcoming',
      detail: checkDone
        ? 'On its way — your bank may take a few days to show it.'
        : undefined,
    });
  }
  return steps;
}

function checkDetail(status: PayoutAccountStatus, settling: boolean): string {
  if (settling) return 'Waiting for Stripe to confirm — usually a moment.';
  // "Saved" carried over from the card's paragraph, which the tracker
  // replaces: someone told to go back to Stripe fears starting again.
  if (status === 'unfinished') return 'Stripe needs a few more details from you. Your progress is saved.';
  return 'Usually a few minutes, sometimes a day. We’ll switch payouts on the moment it’s done.';
}
