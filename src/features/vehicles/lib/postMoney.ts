/**
 * WHAT:  The owner's money for one listing, as the app shows it: the schema for
 *        get_post_money / list_my_posts' `money`, and the one mapping from a
 *        money STATE to its words (a short label, a sentence, a tone).
 * WHY:   Until 2026-09-25 no screen could say where an owner's money was. The
 *        server now derives ten states (20260925110000); this is the only place
 *        they become copy, so the listing's money card and the My listings
 *        line can never describe the same state two ways.
 *
 *        Pure and React-free on purpose: every branch is testable as data, and
 *        the dates are formatted with an injectable `now`.
 *
 *        ⚠️ `being_checked` never says why, and never says "rejected". The
 *        server makes a pending and a rejected payout review identical so a
 *        colluding pair cannot learn which signal fired; copy that guessed at
 *        either would undo that.
 * LINKS: supabase/migrations/20260925110000_money_you_can_see.sql
 *          (post_money_state — the states and their rules);
 *        src/features/vehicles/api/postMoneyApi.ts (the fetch);
 *        src/features/vehicles/components/PostMoneyCard.tsx (the detail card);
 *        docs/decisions/ADR-0020-the-reward-is-the-reward.md.
 */

import { z } from 'zod';

import { formatDateLabelCompact } from '@/shared/lib/dateTimeLabel';
import { formatPounds, LISTING_FEE_PENCE } from '@/shared/lib/money';
import type { BadgeTone } from '@/shared/ui';

export const POST_MONEY_STATES = [
  'fee_paid',
  'held',
  'awaiting_payee',
  'being_checked',
  'sending',
  'paid',
  'refund_on_hold',
  'refund_paused',
  // "Found it another way" was claimed but its refund never started — the app
  // died, or the owner left the attestation. Nothing retries it; the owner
  // finishes it from the listing (review 2026-09-25).
  'refund_owed',
  'refunding',
  'refunded',
] as const;

export type PostMoneyState = (typeof POST_MONEY_STATES)[number];

/** get_post_money's reply. Keys the server sends in camelCase already. */
export const postMoneySchema = z.object({
  kind: z.enum(['bounty_escrow', 'listing_fee']),
  pricing: z.enum(['fee_on_top', 'fee_inside', 'flat_fee']),
  state: z.enum(POST_MONEY_STATES),
  headlinePence: z.number().int().nullable(),
  rewardPence: z.number().int().nullable(),
  serviceFeePence: z.number().int().nullable(),
  chargedPence: z.number().int(),
  hasCreditedSighting: z.boolean(),
  paid: z.object({ pence: z.number().int(), at: z.string() }).nullable(),
  refund: z
    .object({ pence: z.number().int(), cardFeePence: z.number().int(), at: z.string().nullable() })
    .nullable(),
  refundHold: z.object({ expiresAt: z.string(), paused: z.boolean() }).nullable(),
});

export type PostMoney = z.infer<typeof postMoneySchema>;

/** list_my_posts' compact `money`: a state, one figure, and a date if it has one. */
export const postMoneyBriefSchema = z.object({
  state: z.enum(POST_MONEY_STATES),
  amountPence: z.number().int().nullable(),
  until: z.string().nullable().optional(),
});

export type PostMoneyBrief = z.infer<typeof postMoneyBriefSchema>;

/** The listing-status badge's tones, so a money dot and a status dot are one family. */
export type MoneyTone = BadgeTone;

export interface MoneyCopy {
  /** Short, for a pill or a card line: "£500 reward held". */
  label: string;
  /** One sentence of what it means for the owner, or null when the label says it all. */
  line: string | null;
  tone: MoneyTone;
}

/** "Thursday 18:00" — the hold's release, in the words the exit sheet uses. */
function holdWhen(iso: string | null | undefined): string {
  if (!iso) return 'the 72-hour window';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'the 72-hour window'
    : date.toLocaleString('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
}

function onDate(iso: string | null | undefined, now: Date): string {
  return iso ? ` on ${formatDateLabelCompact(iso, now)}` : '';
}

/**
 * The words for a money state. Works from the brief (a card) or the full read
 * (the detail): `amountPence` is the one figure the state is about, `until`
 * the hold's release, `at` when it moved.
 */
export function moneyCopy(
  money: { state: PostMoneyState; amountPence: number | null; until?: string | null; at?: string | null },
  now: Date = new Date(),
): MoneyCopy {
  const amount = money.amountPence === null ? null : formatPounds(money.amountPence);
  switch (money.state) {
    case 'fee_paid':
      return {
        label: `${amount ?? formatPounds(LISTING_FEE_PENCE)} listing fee paid`,
        line: null,
        tone: 'neutral',
      };
    case 'held':
      return {
        label: amount ? `${amount} reward held` : 'Reward held',
        // Both endings, in the words RewardExplainer used before they paid.
        line: 'Paid out only when you say who found your car — or back to you if no one did.',
        tone: 'neutral',
      };
    case 'awaiting_payee':
      return {
        label: 'Waiting for your spotter',
        line: amount
          ? `${amount} is sent automatically once they add their bank details.`
          : 'Their reward is sent automatically once they add their bank details.',
        tone: 'warning',
      };
    case 'being_checked':
      return {
        label: 'Being checked',
        line: 'We’re double-checking this payout — nothing you need to do.',
        tone: 'warning',
      };
    case 'sending':
      return {
        label: amount ? `Sending ${amount}` : 'Sending the reward',
        line: 'On its way to your spotter.',
        // Not success: that tone is kept for money that has ARRIVED (`paid`),
        // so "sending" and "sent" never look the same.
        tone: 'neutral',
      };
    case 'paid':
      return {
        label: amount ? `${amount} sent to your spotter` : 'Reward sent',
        line: money.at ? `Sent${onDate(money.at, now)}.` : null,
        tone: 'success',
      };
    case 'refund_on_hold':
      return {
        label: 'Refund on hold',
        line: `Sent after ${holdWhen(money.until)}, unless a spotter says their sighting helped.`,
        tone: 'warning',
      };
    case 'refund_paused':
      return {
        label: 'Refund paused',
        line: 'A spotter says their sighting helped. Someone on our team is looking into it.',
        tone: 'warning',
      };
    case 'refund_owed':
      return {
        label: 'Refund not sent yet',
        line: 'Your refund didn’t finish. Open the listing and tap “Finish your refund” to send it.',
        tone: 'warning',
      };
    case 'refunding':
      return {
        label: 'Refund on its way',
        line: 'Your money is being returned to your card.',
        tone: 'neutral',
      };
    case 'refunded':
      return {
        label: amount ? `${amount} refunded` : 'Refunded',
        line: money.at ? `Returned to your card${onDate(money.at, now)}.` : null,
        tone: 'neutral',
      };
  }
}

/** The card-line copy from list_my_posts' brief. */
export function briefCopy(brief: PostMoneyBrief, now: Date = new Date()): MoneyCopy {
  return moneyCopy({ state: brief.state, amountPence: brief.amountPence, until: brief.until }, now);
}

/** The detail-card copy from the full read, with the dates it has. */
export function detailCopy(money: PostMoney, now: Date = new Date()): MoneyCopy {
  return moneyCopy(
    {
      state: money.state,
      amountPence: money.headlinePence,
      until: money.refundHold?.expiresAt ?? null,
      at: money.paid?.at ?? money.refund?.at ?? null,
    },
    now,
  );
}

/** One line of the receipt under the detail card: what the owner paid, and how it divides. */
export function receiptLine(money: PostMoney): string {
  if (money.kind === 'listing_fee') {
    return `You paid ${formatPounds(money.chargedPence)} to list. Not refundable.`;
  }
  if (money.pricing === 'fee_on_top' && money.rewardPence !== null && money.serviceFeePence !== null) {
    return `You paid ${formatPounds(money.chargedPence)}: the ${formatPounds(
      money.rewardPence,
    )} reward and a ${formatPounds(money.serviceFeePence)} service fee.`;
  }
  // A listing charged before the fee moved on top (ADR-0020): the reward WAS the
  // charge, and the spotter's share is the stored reward.
  return `You paid ${formatPounds(money.chargedPence)}, including the ${formatPounds(
    money.rewardPence ?? money.chargedPence,
  )} reward.`;
}

/** The card-fee line under a finished refund, or null. */
export function refundFeeLine(money: PostMoney): string | null {
  if (money.state !== 'refunded' || !money.refund || money.refund.cardFeePence <= 0) {
    return null;
  }
  return `The ${formatPounds(money.refund.cardFeePence)} card processing fee isn’t refundable.`;
}

/** Whether the owner has a "found it another way" refund to finish. */
export function canFinishRefund(money: PostMoney | null): boolean {
  return money !== null && money.state === 'refund_owed';
}

/** Whether "Send the reward" is a real action here: someone is credited and the
 *  money is still on its way to them. A held "found it myself" refund also sits
 *  in recovery_claimed — with nobody credited — so status alone is not enough. */
export function canSendReward(money: PostMoney | null): boolean {
  return (
    money !== null &&
    money.hasCreditedSighting &&
    (money.state === 'awaiting_payee' || money.state === 'sending')
  );
}
