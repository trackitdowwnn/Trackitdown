/**
 * WHAT:  The bounty range, in integer pence. ONE mirror of the database's own
 *        CHECK, imported everywhere a floor or ceiling is needed.
 * WHY:   The range is stated in seven places server-side and, before this file,
 *        in four more on the client — each an independent copy of a number that
 *        must never disagree. `20260813120000_bounty_minimum_ten` moved the
 *        floor £50 → £10 at the owner's request on 2026-08-13 and had to touch
 *        all seven; the client mirror it names lived in a checkout that has
 *        since been lost, so the app went on enforcing £50 against a database
 *        that allowed £10 for nine days.
 *
 *        Nothing errored. An owner who could only offer £15 simply could not
 *        post, and no screen said why.
 * LINKS: supabase/migrations/20260813120000_bounty_minimum_ten.sql (the
 *          authority: posts_bounty_amount_pence_check);
 *        supabase/migrations/20260813130000_bounty_floor_completion.sql (the
 *          three places THAT migration missed — worth reading before moving
 *          this number again);
 *        src/shared/lib/money.ts (LISTING_FEE_PENCE, the other price mirror).
 */

/**
 * MONEY: the smallest bounty a post may carry, integer pence.
 *
 * The floor is a PRODUCT choice, not a fraud control: it only ever encoded
 * "below this, a bounty is not worth a spotter's trip", and setting that price
 * on behalf of someone whose car has just been taken is not this platform's
 * call. £5,000 above IS a fraud control (DOMAIN.md) and is a different kind of
 * number — do not treat them alike.
 */
export const MIN_BOUNTY_PENCE = 1000;

/** MONEY: the largest bounty a post may carry, integer pence. A fraud ceiling
 *  (DOMAIN.md), unchanged since the schema was written. */
export const MAX_BOUNTY_PENCE = 500000;

/**
 * Where the bounty slider starts, integer pence.
 *
 * Lives HERE rather than beside the slider component so tests can read it
 * without loading the native graph — the same reason the bounds moved. Two
 * suites had to mock the component module and invent this number, which is how
 * a floor of £50 went on being asserted for nine days after it became £10.
 *
 * Mid-range on purpose: it seeds the slider valid and non-dirty. It is NOT a
 * recommendation, and nothing may present it as one.
 */
export const DEFAULT_BOUNTY_PENCE = 25000;

/**
 * Snap stops for the bounty sliders, coarsening as the amount grows.
 *
 * £1 steps below £50 exist BECAUSE the floor is £10: with the old £25 grid the
 * cheapest three selectable bounties would have been £10, £25 and £50, which
 * makes most of the newly-allowed range unreachable and the change pointless.
 */
// Deliberately NOT `as const`: the sliders take a mutable SnapStep[], and a
// readonly tuple will not assign to it.
export const BOUNTY_SNAP_STEPS = [
  { upToPence: 5000, stepPence: 100 },
  { upToPence: 50000, stepPence: 2500 },
  { stepPence: 5000 },
];

/**
 * Round an amount onto the same grid the sliders snap to, clamped to the range.
 *
 * A recommendation the slider cannot land on is worse than none: it tells
 * someone to pick £237 and then refuses to let them. Any number shown to an
 * owner as an amount they might choose goes through here first.
 */
export function snapBountyPence(pence: number): number {
  const clamped = Math.min(Math.max(pence, MIN_BOUNTY_PENCE), MAX_BOUNTY_PENCE);
  const band = BOUNTY_SNAP_STEPS.find(
    (step) => step.upToPence === undefined || clamped <= step.upToPence,
  );
  const step = band?.stepPence ?? 1;
  const snapped = Math.round(clamped / step) * step;
  // Re-clamp: rounding at a band edge can step outside the range (a value just
  // under MAX on a £50 grid rounds up past it).
  return Math.min(Math.max(snapped, MIN_BOUNTY_PENCE), MAX_BOUNTY_PENCE);
}
