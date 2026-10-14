/**
 * WHAT:  rewardTimeline — an owner's reward, as the steps the listing's "Your
 *        reward" card draws: taken → (credited) → paid out, or taken → (held
 *        before refund) → refunded, with dates and the refunded figure.
 * WHY:   PR4 of the payments UX plan (2026-10-13). Once a reward stopped being
 *        held, an owner had a toast and then nothing — a closed listing still
 *        showed the old £ figure. Pure, so every route the money can take is
 *        pinned by a test.
 *
 *        WHEN IT SHOWS: once the money is moving or has moved — the listing is
 *        no longer live. A live listing's held reward is already said by the
 *        term card and the stat band's line (rewardTerm.ts); saying it twice
 *        would be the "four times over" the Payouts review warned about.
 *
 *        ONLY THE LATEST REWARD's road: a renewal's old reward was refunded
 *        when it was replaced, and the change screen said so at the time.
 *
 *        Nothing about the spotter beyond that they were paid. No provider
 *        named (owner, 2026-10-13).
 * LINKS: ../api/rewardTimelineApi.ts; ../components/RewardTimelineCard.tsx;
 *        src/shared/ui/ProgressSteps.tsx; ./rewardTimeline.test.ts.
 */

import { formatTermDate } from '@/shared/lib/dateTimeLabel';
import { formatPounds } from '@/shared/lib/money';
import type { PostStatus } from '@/shared/types';
import type { ProgressStep } from '@/shared/ui';

import type { RewardTimeline } from '../api/rewardTimelineApi';

/** A listing still live: its reward is the term card's to tell. */
const LIVE: readonly PostStatus[] = ['draft', 'pending_verification', 'active'];

export interface RewardTimelineView {
  steps: ProgressStep[];
  /** One word for the stat band once it's settled, in place of a stale £:
   *  "Paid out" or "Refunded" — null while money is still moving. */
  outcome: 'Paid out' | 'Refunded' | null;
}

// THE DATE IS THE STEP'S `meta` (2026-10-14, ProgressSteps v2): beside the
// label, the same place on every tracker in the app, instead of folded into a
// sentence. Undefined when unknown — no date rather than a guessed one.
const dated = (iso: string | null | undefined) => (iso ? formatTermDate(iso) : undefined);

/** The card's steps, or null when there is nothing for it to say. */
export function rewardTimeline(timeline: RewardTimeline | null): RewardTimelineView | null {
  if (!timeline || LIVE.includes(timeline.postStatus)) return null;
  const latest = timeline.rewards.at(-1);
  if (!latest) return null;

  const steps: ProgressStep[] = [
    {
      id: 'reward',
      label: `Your ${formatPounds(latest.amountPence)} reward`,
      state: 'done',
      meta: dated(latest.capturedAt),
      detail: 'Held for the spotter who finds it.',
    },
  ];
  const credit: ProgressStep | null = timeline.creditedAt
    ? {
        id: 'credit',
        label: 'Credited sighting',
        state: 'done',
        meta: dated(timeline.creditedAt),
      }
    : null;

  if (latest.status === 'released') {
    if (credit) steps.push(credit);
    steps.push({
      id: 'payout',
      label: 'Payout',
      state: 'done',
      meta: dated(latest.releasedAt),
      detail: 'Paid to the spotter.',
    });
    return { steps, outcome: 'Paid out' };
  }

  if (latest.status === 'refunded') {
    if (credit) steps.push(credit);
    if (latest.holdUntil) {
      steps.push({
        id: 'hold',
        label: 'Refund hold',
        state: 'done',
        meta: `Until ${formatTermDate(latest.holdUntil)}`,
        detail: 'In case a sighting was contested.',
      });
    }
    const refunded = latest.refundedPence;
    const kept = refunded !== null ? latest.amountPence - refunded : 0;
    steps.push({
      id: 'refund',
      label: 'Refund',
      state: 'done',
      meta: dated(latest.refundedAt),
      detail:
        refunded !== null
          ? `${formatPounds(refunded)} back to your card${
              kept > 0 ? ` — the ${formatPounds(kept)} card fee was kept` : ''
            }.`
          : 'Back to your card.',
    });
    return { steps, outcome: 'Refunded' };
  }

  // Still held (or a replaced reward still being refunded): money in motion.
  if (credit && timeline.postStatus === 'recovery_claimed' && !latest.holdUntil) {
    steps.push(credit);
    steps.push({
      id: 'payout',
      label: 'Payout',
      state: 'current',
      detail: 'Waiting to be sent to the spotter.',
    });
    return { steps, outcome: null };
  }

  if (latest.holdUntil) {
    steps.push({
      id: 'hold',
      label: 'Refund hold',
      state: 'current',
      meta: `Until ${formatTermDate(latest.holdUntil)}`,
      detail: timeline.disputeOpen
        ? 'A spotter has contested this, so it’s being reviewed before anything moves.'
        : 'Your refund is sent then, unless a sighting is contested.',
    });
    steps.push({ id: 'refund', label: 'Refund', state: 'upcoming' });
    return { steps, outcome: null };
  }

  steps.push({
    id: 'refund',
    label: 'Refund',
    state: 'current',
    detail: 'Being refunded to your card.',
  });
  return { steps, outcome: null };
}
