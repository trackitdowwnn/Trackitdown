/**
 * WHAT:  rewardTerm — what an owner's reward status means AT A MOMENT: which
 *        of the term's states the listing is in, and the one quiet sentence
 *        that names it. Pure, so every state is tested without a network or a
 *        clock.
 * WHY:   Three surfaces speak about one reward — the listing's banner (a card
 *        when there is a decision), the listing's stat band (a quiet line when
 *        there is not) and the stats page (always the line) — and they must
 *        never disagree about the date or about which state applies. The
 *        renew window is defined here once, so a card and a line can never
 *        both show, or both be missing.
 *
 *        THE STATES (ADR-0020):
 *          * none     — nothing true to say: no reward, no term yet, a fee
 *                       listing;
 *          * quiet    — a held reward with more than 14 days left;
 *          * renew    — the last 14 days (REWARD_RENEW_WINDOW_DAYS), nothing
 *                       in the way: Renew;
 *          * blocked  — the last 14 days, but a recovery or dispute is open,
 *                       so nothing can change and nothing is refunded;
 *          * ending   — the date has passed and the reward is still held (a
 *                       72-hour sightings hold, or a claim): not yet back;
 *          * returned — the reward ended and its refund is recorded; for
 *                       14 days a card offers "Add a reward";
 *          * returnedQuiet — after those 14 days, just the line.
 * LINKS: ../api/rewardChangeApi.ts (RewardStatus);
 *        ../components/RewardTermBanner.tsx (the card);
 *        src/features/vehicles/screens/PostDetailScreen.tsx and
 *        PostStatsScreen.tsx (the line);
 *        docs/decisions/ADR-0020-a-reward-has-a-term.md.
 */

import { REWARD_RENEW_WINDOW_DAYS } from '@/shared/lib/bountyBounds';
import { formatLastDay, formatTermDate } from '@/shared/lib/dateTimeLabel';
import { formatPounds } from '@/shared/lib/money';

import type { RewardStatus } from '../api/rewardChangeApi';

/** The renew window in ms (REWARD_RENEW_WINDOW_DAYS). The same stretch decides
 *  how long "Add a reward" stays a card after a reward has gone back. */
const RENEW_WINDOW_MS = REWARD_RENEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type RewardTermPhase =
  | 'none'
  | 'quiet'
  | 'renew'
  | 'blocked'
  | 'ending'
  | 'returned'
  | 'returnedQuiet';

/** Parse an ISO stamp to epoch ms, or null — a bad date is never guessed at. */
function epoch(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Which state the reward is in at `now` (epoch ms). */
export function rewardTermPhase(status: RewardStatus | null, now: number): RewardTermPhase {
  if (!status) return 'none';

  if (status.amountPence === null) {
    // Nothing held. Either a reward ended and went back, or there never was
    // one (a fee listing) — only the first has anything to say.
    const returnedAt = epoch(status.rewardEndedAt);
    if (returnedAt === null || status.endedRewardPence === null) return 'none';
    return now - returnedAt <= RENEW_WINDOW_MS ? 'returned' : 'returnedQuiet';
  }

  // A held reward's term is only news on a LIVE listing. A cancelled one's
  // reward is in its refund hold, a recovery_claimed one's is being decided —
  // "runs until 4 December" would be false on both.
  if (status.postStatus && status.postStatus !== 'active' && status.postStatus !== 'pending_verification') {
    return 'none';
  }
  const endsAt = epoch(status.termEndsAt);
  if (endsAt === null) return 'none';
  if (endsAt <= now) return 'ending';
  if (endsAt - now > RENEW_WINDOW_MS) return 'quiet';
  return status.blockedMessage ? 'blocked' : 'renew';
}

/** True when the phase is a decision (or news) the banner shows as a card. */
export function isRewardTermCard(phase: RewardTermPhase): boolean {
  return phase === 'renew' || phase === 'blocked' || phase === 'ending' || phase === 'returned';
}

/** Whether RewardTermBanner draws anything for this status at `now` — so a
 *  screen can skip the banner's spacing when it would be empty. */
export function hasRewardTermCard(status: RewardStatus | null, now: number): boolean {
  return isRewardTermCard(rewardTermPhase(status, now));
}

/**
 * The reward's term as one quiet sentence, whatever the phase — or null when
 * there is nothing true to say. The stats page shows it always; the listing
 * shows it only when the banner shows no card (see quietRewardTermLine).
 */
export function rewardTermLine(status: RewardStatus | null, now: number): string | null {
  const phase = rewardTermPhase(status, now);
  if (!status || phase === 'none') return null;

  if (phase === 'returned' || phase === 'returnedQuiet') {
    // Narrowed by the phase: both are non-null there. Names the REWARD, never
    // the refund as an amount: the end-of-term refund keeps the card fee
    // (unless legacy), and the status carries no refunded figure — "we
    // refunded £200" would overstate it.
    return `The refund of your ${formatPounds(status.endedRewardPence as number)} reward went to your card on ${formatTermDate(status.rewardEndedAt as string)}.`;
  }
  const amount = formatPounds(status.amountPence as number);
  const date = formatLastDay(status.termEndsAt as string);
  if (phase === 'ending') {
    // Past its date but still held: a claim decides where it goes, or the
    // 72-hour hold is running — never "refunded" yet.
    return status.blockedMessage
      ? `Your ${amount} reward ended on ${date}. It stays held while the recovery or dispute is sorted out.`
      : `Your ${amount} reward ended on ${date}.`;
  }
  return `Your ${amount} reward runs until ${date}.`;
}

/** The line for a surface that sits beside the banner: null whenever the
 *  banner is showing a card, so the date is said once. */
export function quietRewardTermLine(status: RewardStatus | null, now: number): string | null {
  return hasRewardTermCard(status, now) ? null : rewardTermLine(status, now);
}
