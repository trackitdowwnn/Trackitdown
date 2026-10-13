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
 *        client-readable (payments_foundation's SAFETY note). Two narrow
 *        reads stand in: my_pending_credit (a reward waiting) and, since
 *        PR2b, my_latest_payout (a reward sent, and when). Nothing sees a
 *        BANK, so no step ever says a reward arrived.
 *
 *        WHO IS WAITING ON WHOM is the point of each `detail`, as it is of the
 *        pill: "unfinished" waits on THEM, "verifying" on Stripe. Saying "all
 *        good, sit tight" to someone Stripe is waiting on would strand them.
 * LINKS: ../screens/PayoutsScreen.tsx; ../hooks/usePayoutAccount.ts;
 *        src/shared/ui/ProgressSteps.tsx; ./payoutProgress.test.ts.
 */

import { formatTermDate } from '@/shared/lib/dateTimeLabel';
import { formatPounds } from '@/shared/lib/money';
import type { ProgressStep } from '@/shared/ui';

import type { PayoutAccountStatus } from '../hooks/usePayoutAccount';

export interface PayoutProgressInput {
  status: PayoutAccountStatus;
  /** usePayoutAccount's "just got back — still confirming" window. */
  settling: boolean;
  /** The credited-but-unsent reward, or null for none (undefined: still asking). */
  pendingCreditPence: number | null | undefined;
  /** The most recent reward SENT within the window (fetchMyLatestPayout), or
   *  null. Only read once nothing else is waiting. */
  latestPayout?: { transferPence: number; sentAt: string } | null;
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
  latestPayout,
}: PayoutProgressInput): ProgressStep[] | null {
  if (status === 'guest' || status === 'loading' || status === 'error') return null;
  // Still asking whether a reward waits — don't draw a road that may vanish.
  if (pendingCreditPence === undefined) return null;
  const credit = pendingCreditPence;

  // ⚠️ THE ROAD'S END (PR2b, my_latest_payout). Payouts on, nothing waiting,
  // and a reward sent recently: every step done, the last one saying WHEN. It
  // says "sent" — Stripe moved it to their account — and never "arrived":
  // the bank's side is Stripe's payout schedule, which nothing here can see.
  // A reward still waiting outranks it: that is the road they are on now.
  if (status === 'ready' && credit === null && latestPayout) {
    return [
      { id: 'details', label: 'Your details', state: 'done' },
      { id: 'check', label: 'ID check', state: 'done' },
      { id: 'payouts-on', label: 'Payouts on', state: 'done' },
      {
        id: 'reward',
        label: `Your ${formatPounds(latestPayout.transferPence)} reward`,
        state: 'done',
        detail: `Sent ${formatTermDate(latestPayout.sentAt)} — your bank may take a few days to show it.`,
      },
    ];
  }
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
      label: 'ID check',
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
  if (settling) return 'Waiting for confirmation — usually a moment.';
  // "Saved" carried over from the card's paragraph, which the tracker
  // replaces: someone told to go back to Stripe fears starting again.
  if (status === 'unfinished') return 'A few more details are needed from you. Your progress is saved.';
  return 'Usually a few minutes, sometimes a day. We’ll switch payouts on the moment it’s done.';
}
