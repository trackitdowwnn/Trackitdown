/**
 * WHAT:  Every word the Payouts screen says about where a spotter's reward
 *        is — one place, short by rule.
 * WHY:   2026-10-14 (payout experience redesign, PR4). The owner found the
 *        screen "too much text", and the audit found why: the same state was
 *        worded in three places (a COPY map, nested ternaries, the tracker's
 *        details) and said up to three times on one screen. Now each state has
 *        ONE status line, ONE sentence per step and ONE button, and
 *        payoutView.test.ts holds every string to a budget:
 *          status line ≤ 8 words · step sentence ≤ 16 · button ≤ 4.
 *
 *        Who is waiting on whom is the point of every step sentence: "you"
 *        when it is theirs to do, "we" / "our payment partner" when it is not,
 *        "your bank" for the last leg. No payment provider is ever named
 *        (owner, 2026-10-13), nothing says "escrow", and nothing claims we
 *        "never see" their details — "never store" is the promise that holds.
 * LINKS: ./payoutView.ts (the only reader); ./payoutView.test.ts (the budget).
 */

import { formatTermDate } from '@/shared/lib/dateTimeLabel';
import { formatPounds } from '@/shared/lib/money';

/** "13 October" — a date that happened. */
export const onDay = (iso: string) => formatTermDate(iso);
/** "Thursday 16 October" — a date to look forward to. */
export const byDay = (iso: string) => formatTermDate(iso, true);

export const COPY = {
  // --- Step labels: nouns, never claims (the marker says how far it got) ---
  step: {
    details: 'Your details',
    check: 'ID check',
    setUp: 'Set up',
    confirmed: 'Reward confirmed',
    sent: 'Reward sent',
    bank: 'In your bank',
  },

  // --- The hero's one status line, per state (≤ 8 words) ---
  status: {
    addDetails: 'Add your details to get paid',
    finishDetails: 'Finish your details to get paid',
    addBank: 'Add your bank account to get paid',
    checking: 'Your details are being checked',
    needsYou: 'We need one more thing from you',
    review: 'A quick check before we send it',
    sending: 'Sending your reward',
    sentOn: (iso: string) => `Sent on ${onDay(iso)}`,
    // The chip says "On its way"; the line says when (the budget caught both).
    arrivesBy: (iso: string) => `Arrives by ${byDay(iso)}`,
    paidOn: (iso: string) => `Paid into your bank on ${onDay(iso)}`,
    // Where to look, as a statement says it (PR7) — 8 words, the budget's edge.
    paidInto: (last4: string, iso: string) => `Paid into account ending ${last4} on ${onDay(iso)}`,
    bankRefused: 'Your bank couldn’t accept it',
    resending: 'Sending it again to your new account',
    ready: 'Payouts are on',
  },

  // --- The current step's one sentence: who acts, and when (≤ 16 words) ---
  detail: {
    addDetails: 'Three short steps — about a minute. Only you can do this.',
    finishDetails: 'A few more details are needed from you. Your progress is saved.',
    addBank: 'Add the account your reward should go to.',
    settling: 'Waiting for confirmation — usually a moment.',
    checkingNow: 'Checking with our payment partner now — usually a moment.',
    checking: 'Our payment partner is checking. Usually minutes, sometimes a day.',
    needsId: 'Our payment partner needs a quick photo ID — about two minutes.',
    review: 'A quick check before we send it. Nothing for you to do.',
    sending: 'We’re sending it now. Nothing for you to do.',
    onItsWay: 'On its way to your bank.',
    onItsWayTo: (last4: string) => `On its way to account ending ${last4}.`,
    rewardsGoTo: (last4: string) => `Rewards go to account ending ${last4}.`,
    overdue: 'Your bank should show it by now. If not, check again tomorrow.',
    bankMayTakeDays: 'Your bank may take a few days to show it.',
    bankRefused: 'Your bank couldn’t accept it. It’s safe and waiting for you.',
    resending: 'Sending it again to your new account — usually within a few days.',
  },

  // --- The one button (≤ 4 words) ---
  action: {
    addDetails: 'Add your details',
    continue: 'Continue setting up',
    addBank: 'Add your bank account',
    startCheck: 'Start the check',
    updateBank: 'Update bank details',
    retry: 'Try again',
  },

  // --- Status chips: adjectives, never verbs ---
  chip: {
    notSetUp: 'Not set up',
    actionNeeded: 'Action needed',
    beingChecked: 'Being checked',
    onItsWay: 'On its way',
    paid: 'Paid',
    ready: 'Ready',
  },

  // --- The hero ---
  earned: 'You’ve earned',
  // The paid moment's line, once (PR5) — "Thanks", never confetti.
  thanks: 'Thanks for helping',
  heading: 'Your reward',

  // --- Collapsed finished road ---
  collapsed: (iso: string, pence: number) => `Paid ${onDay(iso)} · ${formatPounds(pence)}`,
  expand: 'View details',

  // --- Trust, next to the step that takes the details (never repeated) ---
  trust: {
    bank: 'Your details go straight to our payment partner. We never store your bank details.',
    id: 'Your ID goes straight to our payment partner. We never store it.',
  },
} as const;

/**
 * "for helping find a blue BMW" — the car the reward was for, by colour and
 * make only (never the plate). Null without a make: a sentence about "a car"
 * says nothing the amount doesn't.
 */
export function carLabel(car: { make: string | null; colour: string | null } | null): string | null {
  const make = car?.make?.trim();
  if (!make) return null;
  const colour = car?.colour?.trim().toLowerCase();
  const thing = colour ? `${colour} ${make}` : make;
  const article = /^[aeiou]/i.test(thing) ? 'an' : 'a';
  return `for helping find ${article} ${thing}`;
}
