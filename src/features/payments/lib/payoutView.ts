/**
 * WHAT:  payoutView — the ONE decision about what the Payouts screen says:
 *        which kind of screen, the hero (amount, car, one status line), the
 *        chip, the tracker's steps (dates, who acts, the one action) and
 *        whether a finished road folds away.
 * WHY:   2026-10-14 (payout experience redesign, PR4). Each state used to be
 *        decided in three places — PayoutsScreen's COPY map, its nested
 *        ternaries, and payoutProgress — and they drifted, so the screen said
 *        the same thing three times and the hero vanished exactly when the
 *        money moved. This is pure: (input, now) in, a view out, every state a
 *        row in payoutView.test.ts. PR5 renders it; nothing else decides.
 *
 *        THE ROAD, two shapes:
 *          • Not set up yet: Your details → ID check → Reward sent → In your bank.
 *          • Payouts on: Set up ✓ → Reward confirmed ✓ → Reward sent → In your bank.
 *        Done steps carry their real date (`meta`); the step ahead a cautious
 *        "Expected by …". A step waiting on THEM is `attention` with its one
 *        action; a step waiting on anyone else has no button.
 *
 *        "PAID" when the bank payout says paid (owner, 2026-10-14) — and if a
 *        bank bounces it days later, the step comes back as attention.
 * LINKS: ./payoutCopy.ts (every word); src/shared/ui/ProgressSteps.tsx;
 *        ../api/payoutsApi.ts (the inputs); ./payoutView.test.ts.
 */

import type { ProgressStep } from '@/shared/ui';

import type { BankPayout, PayoutAccount } from '../api/payoutsApi';
import type { PayoutAccountStatus } from '../hooks/usePayoutAccount';

import { COPY, byDay, carLabel, onDay } from './payoutCopy';

/** What a button does — the screen maps each to a handler. */
export type PayoutIntent = 'start' | 'continue' | 'bank' | 'idCheck' | 'retry';

export type ChipTone = 'neutral' | 'warning' | 'success';

/** A tracker step whose action is an intent, not yet a handler. */
export type PayoutStep = Omit<ProgressStep, 'action'> & {
  action?: { label: string; intent: PayoutIntent };
};

export interface PendingCreditInput {
  transferPence: number;
  underReview: boolean;
  creditedAt: string | null;
  car: { make: string | null; colour: string | null };
}

export interface PayoutViewInput {
  status: PayoutAccountStatus;
  /** usePayoutAccount's "just got back — confirming" window. */
  settling: boolean;
  /** The bounded re-checks are running right now. */
  checkingNow: boolean;
  /** Stripe wants a bank account (ours to ask for). */
  needsBank: boolean;
  /** Stripe wants something only its own check collects. */
  needsAction: boolean;
  /** The reward read failed — "couldn't check", never "nothing owed". */
  creditCheckFailed: boolean;
  /** The waiting reward; null for none; undefined while still asking. */
  credit: PendingCreditInput | null | undefined;
  /** The latest reward SENT within the window. */
  latestPayout: { transferPence: number; sentAt: string } | null;
  account: Pick<
    PayoutAccount,
    'bankPayout' | 'bankReplacedAt' | 'payoutsEnabledAt' | 'detailsSubmittedAt'
  > | null;
}

export interface PayoutHero {
  /** The figure — the reason they are here. Null when there is none to show. */
  amountPence: number | null;
  /** "for helping find a blue BMW", or null. */
  carLabel: string | null;
  /** ONE line: where it is. */
  status: string;
}

export type PayoutView =
  | { kind: 'guest' }
  | { kind: 'loading' }
  | { kind: 'error' }
  /** The reward read failed, and nothing else says otherwise. */
  | { kind: 'creditUnknown'; action: { label: string; intent: 'retry' } }
  /** Never earned, nothing to set up. */
  | { kind: 'nothing' }
  /** Payouts on, nothing waiting or recent. */
  | {
      kind: 'ready';
      chip: { label: string; tone: ChipTone };
      status: string;
      action: { label: string; intent: 'bank' };
    }
  | {
      kind: 'journey';
      hero: PayoutHero;
      chip: { label: string; tone: ChipTone };
      steps: PayoutStep[];
      /** Which trust line belongs beside the current step, if any. */
      trustAt: 'bank' | 'id' | null;
      /** A finished road, folded to one line. */
      collapsed: { summary: string; expandLabel: string } | null;
      /** A key to celebrate ONCE (the paid moment), or null. */
      celebrateKey: string | null;
    };

const step = (
  id: string,
  label: string,
  state: ProgressStep['state'],
  extra: Partial<PayoutStep> = {},
): PayoutStep => ({ id, label, state, ...extra });

/** YYYY-MM-DD of `now`, for comparing with Stripe's arrival dates. */
const dayOf = (now: Date) => now.toISOString().slice(0, 10);

export function payoutView(input: PayoutViewInput, now: Date): PayoutView {
  const { status } = input;
  if (status === 'guest') return { kind: 'guest' };
  if (status === 'loading') return { kind: 'loading' };
  if (status === 'error') return { kind: 'error' };
  // Don't draw a road that may vanish a moment later.
  if (input.credit === undefined) return { kind: 'loading' };

  if (status === 'ready') return readyView(input, now);
  return setupView(input);
}

/** Not payable yet: the setup leads. */
function setupView(input: PayoutViewInput): PayoutView {
  const { status, credit, settling, checkingNow, needsBank, needsAction } = input;

  if (status === 'notStarted' && credit === null) {
    return input.creditCheckFailed
      ? { kind: 'creditUnknown', action: { label: COPY.action.retry, intent: 'retry' } }
      : { kind: 'nothing' };
  }

  // ⚠️ THE SETTLE WINDOW OUTRANKS THE DERIVED STATE. Until the account's
  // update lands, someone who just sent everything reads as `unfinished` —
  // and asking them to "Continue setting up" blames them for our queue.
  const askBank = !settling && needsBank && (status === 'unfinished' || status === 'verifying');
  const askCheck =
    !settling && needsAction && !askBank && (status === 'unfinished' || status === 'verifying');
  const detailsSent = settling || (status === 'verifying' && !askBank);
  const sentAt = input.account?.detailsSubmittedAt ?? undefined;

  const details: PayoutStep = askBank
    ? step('details', COPY.step.details, 'attention', {
        detail: COPY.detail.addBank,
        action: { label: COPY.action.addBank, intent: 'bank' },
      })
    : detailsSent
      ? step('details', COPY.step.details, 'done', { meta: sentAt ? onDay(sentAt) : undefined })
      : status === 'unfinished'
        ? step('details', COPY.step.details, 'current', {
            detail: COPY.detail.finishDetails,
            action: { label: COPY.action.continue, intent: 'continue' },
          })
        : step('details', COPY.step.details, 'current', {
            detail: COPY.detail.addDetails,
            action: { label: COPY.action.addDetails, intent: 'start' },
          });

  const check: PayoutStep = !detailsSent
    ? step('check', COPY.step.check, 'upcoming')
    : askCheck
      ? step('check', COPY.step.check, 'attention', {
          detail: COPY.detail.needsId,
          action: { label: COPY.action.startCheck, intent: 'idCheck' },
        })
      : step('check', COPY.step.check, 'current', {
          detail: settling
            ? COPY.detail.settling
            : checkingNow
              ? COPY.detail.checkingNow
              : COPY.detail.checking,
          working: settling || checkingNow,
        });

  const heroStatus = askBank
    ? COPY.status.addBank
    : askCheck
      ? COPY.status.needsYou
      : detailsSent
        ? COPY.status.checking
        : status === 'unfinished'
          ? COPY.status.finishDetails
          : COPY.status.addDetails;

  const chip =
    askBank || askCheck || (status === 'unfinished' && !detailsSent)
      ? { label: COPY.chip.actionNeeded, tone: 'warning' as const }
      : detailsSent
        ? { label: COPY.chip.beingChecked, tone: 'neutral' as const }
        : { label: COPY.chip.notSetUp, tone: 'neutral' as const };

  return {
    kind: 'journey',
    hero: {
      amountPence: credit?.transferPence ?? null,
      carLabel: carLabel(credit?.car ?? null),
      status: heroStatus,
    },
    chip,
    steps: [
      details,
      check,
      step('sent', COPY.step.sent, 'upcoming'),
      step('bank', COPY.step.bank, 'upcoming'),
    ],
    trustAt: askCheck ? 'id' : detailsSent ? null : 'bank',
    collapsed: null,
    celebrateKey: null,
  };
}

/** Payouts on: the money leads; setup is one line behind it. */
function readyView(input: PayoutViewInput, now: Date): PayoutView {
  const { credit, latestPayout, account } = input;
  const enabledAt = account?.payoutsEnabledAt ?? undefined;
  const setUp = step('setup', COPY.step.setUp, 'done', {
    meta: enabledAt ? onDay(enabledAt) : undefined,
  });

  // A reward waiting: the release is under way (or held for a check).
  if (credit) {
    const confirmed = step('confirmed', COPY.step.confirmed, 'done', {
      meta: credit.creditedAt ? onDay(credit.creditedAt) : undefined,
    });
    const sent = credit.underReview
      ? step('sent', COPY.step.sent, 'current', { detail: COPY.detail.review })
      : step('sent', COPY.step.sent, 'current', { detail: COPY.detail.sending, working: true });
    return {
      kind: 'journey',
      hero: {
        amountPence: credit.transferPence,
        carLabel: carLabel(credit.car),
        status: credit.underReview ? COPY.status.review : COPY.status.sending,
      },
      chip: credit.underReview
        ? { label: COPY.chip.beingChecked, tone: 'neutral' }
        : { label: COPY.chip.onItsWay, tone: 'neutral' },
      steps: [setUp, confirmed, sent, step('bank', COPY.step.bank, 'upcoming')],
      trustAt: null,
      collapsed: null,
      celebrateKey: null,
    };
  }

  // A reward sent: follow it to the bank.
  if (latestPayout) {
    const leg = bankLeg(
      latestPayout.sentAt,
      account?.bankPayout ?? null,
      account?.bankReplacedAt ?? null,
      now,
    );
    return {
      kind: 'journey',
      hero: { amountPence: latestPayout.transferPence, carLabel: null, status: leg.status },
      chip: leg.chip,
      steps: [
        setUp,
        step('confirmed', COPY.step.confirmed, 'done'),
        step('sent', COPY.step.sent, 'done', { meta: onDay(latestPayout.sentAt) }),
        leg.step,
      ],
      trustAt: null,
      collapsed:
        leg.paidOn !== null
          ? { summary: COPY.collapsed(leg.paidOn, latestPayout.transferPence), expandLabel: COPY.expand }
          : null,
      celebrateKey:
        leg.paidOn !== null ? `paid:${account?.bankPayout?.createdAt ?? latestPayout.sentAt}` : null,
    };
  }

  // No reward in view — but a bank that refused a payout still needs them,
  // whether or not the reward it carried is still inside the sent window.
  const bounced = account?.bankPayout?.status === 'failed';
  const rebanked =
    bounced &&
    account?.bankReplacedAt != null &&
    Date.parse(account.bankReplacedAt) > Date.parse(account.bankPayout?.createdAt ?? '');
  return bounced && !rebanked
    ? {
        kind: 'ready',
        chip: { label: COPY.chip.actionNeeded, tone: 'warning' },
        status: COPY.status.bankRefused,
        action: { label: COPY.action.updateBank, intent: 'bank' },
      }
    : {
        kind: 'ready',
        chip: { label: COPY.chip.ready, tone: 'success' },
        status: COPY.status.ready,
        action: { label: COPY.action.updateBank, intent: 'bank' },
      };
}

/**
 * The last leg — Stripe's payout to their bank. Only a payout made AFTER the
 * reward was sent can be carrying it; an older one (or none yet) says only
 * that the bank may take a few days.
 */
function bankLeg(
  sentAt: string,
  payout: BankPayout | null,
  bankReplacedAt: string | null,
  now: Date,
): {
  step: PayoutStep;
  status: string;
  chip: { label: string; tone: ChipTone };
  paidOn: string | null;
} {
  const onItsWay = { label: COPY.chip.onItsWay, tone: 'neutral' as const };
  if (!payout || Date.parse(payout.createdAt) < Date.parse(sentAt) || payout.status === 'canceled') {
    return {
      step: step('bank', COPY.step.bank, 'current', { detail: COPY.detail.bankMayTakeDays }),
      status: COPY.status.sentOn(sentAt),
      chip: onItsWay,
      paidOn: null,
    };
  }
  if (payout.status === 'paid') {
    const day = payout.arrivalDate ?? payout.createdAt;
    return {
      step: step('bank', COPY.step.bank, 'done', { meta: onDay(day) }),
      status: COPY.status.paidOn(day),
      chip: { label: COPY.chip.paid, tone: 'success' },
      paidOn: day,
    };
  }
  if (payout.status === 'failed') {
    const rebanked =
      bankReplacedAt !== null && Date.parse(bankReplacedAt) > Date.parse(payout.createdAt);
    return rebanked
      ? {
          step: step('bank', COPY.step.bank, 'current', { detail: COPY.detail.resending }),
          status: COPY.status.resending,
          chip: onItsWay,
          paidOn: null,
        }
      : {
          step: step('bank', COPY.step.bank, 'attention', {
            detail: COPY.detail.bankRefused,
            action: { label: COPY.action.updateBank, intent: 'bank' },
          }),
          status: COPY.status.bankRefused,
          chip: { label: COPY.chip.actionNeeded, tone: 'warning' },
          paidOn: null,
        };
  }
  // pending / in_transit
  const arrival = payout.arrivalDate;
  const overdue = arrival !== null && arrival < dayOf(now);
  return {
    step: step('bank', COPY.step.bank, 'current', {
      meta: arrival ? `Expected by ${byDay(arrival)}` : undefined,
      detail: overdue ? COPY.detail.overdue : COPY.detail.onItsWay,
    }),
    status: arrival ? COPY.status.arrivesBy(arrival) : COPY.status.sentOn(sentAt),
    chip: onItsWay,
    paidOn: null,
  };
}
