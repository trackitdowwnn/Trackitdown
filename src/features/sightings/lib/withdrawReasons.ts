/**
 * WHAT:  Why a spotter took a sighting back — the four answers the
 *        "Take this report back?" sheet offers, and their words.
 * WHY:   2026-10-09 (owner request): the owner is now told when a sighting
 *        is withdrawn, and the spotter may say why. A CLOSED vocabulary, not
 *        free text: the answer reaches the owner as one fixed sentence built
 *        in SQL (claim_sighting_withdrawn_notification), because a stranger's
 *        own words can't be moderated yet and would land on a theft victim's
 *        lock screen. The values mirror `sightings_withdraw_reason_chk`
 *        exactly; the server refuses anything else with INVALID_INPUT.
 *        Optional — no answer is a valid answer.
 * LINKS: supabase/migrations/20261009150000_a_withdrawal_says_why.sql;
 *        src/features/sightings/components/WithdrawSightingSheet.tsx;
 *        src/features/sightings/api/sightingApi.ts (withdrawSighting).
 */

/** Mirrors the SQL check, in display order. */
export const WITHDRAW_REASONS = ['not_the_car', 'not_sure', 'mistake', 'other'] as const;

export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

/** The spotter's words for each answer (the owner reads the SQL's). About
 *  the CAR and the report, never self-blame. */
export const WITHDRAW_REASON_LABELS: Record<WithdrawReason, string> = {
  not_the_car: 'It wasn’t the car',
  not_sure: 'I’m not sure it was the car',
  mistake: 'I reported it by mistake',
  other: 'Something else',
};
