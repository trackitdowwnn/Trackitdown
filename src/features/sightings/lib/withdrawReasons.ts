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
 *        ⚠️ The one exception (owner decision, same day): "Something else"
 *        may carry a short NOTE, which the owner reads IN THE APP only —
 *        the push just says a note exists. Its rules live here too.
 * LINKS: supabase/migrations/20261009150000_a_withdrawal_says_why.sql;
 *        supabase/migrations/20261009180000_a_withdrawal_can_say_more.sql;
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

/**
 * What the OWNER reads for each answer, in their "Taken back" list — the
 * same sentences the push gives (claim_sighting_withdrawn_notification), so
 * the list never says something the notice didn't. No answer and "Something
 * else" share the plain one; a note, if any, is shown beneath it.
 */
export function withdrawalSentence(reason: WithdrawReason | null): string {
  switch (reason) {
    case 'not_the_car':
      return 'The spotter says it wasn’t your car.';
    case 'not_sure':
      return 'The spotter wasn’t sure it was your car.';
    case 'mistake':
      return 'The spotter sent it by mistake.';
    default:
      return 'The spotter withdrew it.';
  }
}

/**
 * The longest note "Something else" may carry. Mirrors the server's 200 (in
 * code points; TextInput's maxLength counts UTF-16 units, so it is never
 * looser). 2026-10-09, owner request: the owner reads it in the app only —
 * never in a push (20261009180000_a_withdrawal_can_say_more.sql).
 */
export const MAX_WITHDRAW_NOTE_LENGTH = 200;

// Control characters (bar tab and line breaks), soft hyphens, zero-width
// characters and text-direction marks — the set withdraw_sighting refuses,
// written as escapes so the set can be read in review. Stripped here
// so a spotter never meets that refusal for a character they can't see.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const HIDDEN_CHARACTERS = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** The note as it is sent: hidden characters stripped, trimmed, and null
 *  when nothing visible is left — a blank note is no note. */
export function cleanWithdrawNote(note: string | null | undefined): string | null {
  const cleaned = (note ?? '').replace(HIDDEN_CHARACTERS, '').trim();
  // Visible = anything but whitespace (JS's whitespace class already covers
  // no-break and the other Unicode spaces) and the Hangul filler, which
  // looks blank. The server's own blank check matches (20261009180000).
  return /[^\s\u3164]/.test(cleaned) ? cleaned : null;
}
