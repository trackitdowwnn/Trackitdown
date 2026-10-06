/**
 * WHAT:  Money formatting and money maths — pence-integer amounts rendered as
 *        GBP strings ("£500", "£1,250.50"), plus the reference 95/5 bounty
 *        split and the fixed listing-fee price.
 * WHY:   All money in the app is integer pence end-to-end (docs/DOMAIN.md:
 *        bounties, escrow, the 95/5 split) — floats never touch amounts, so
 *        this formatter is the single place pence become display text, and
 *        bountyBreakdown is the single place the split is computed. Whole
 *        pounds drop the ".00" (matches the design system's bounty examples);
 *        fractional amounts keep two decimals. UK-only per the roadmap, so
 *        GBP is fixed.
 * LINKS: docs/DOMAIN.md (Money & fees); docs/TESTING.md (Tier 1: money);
 *        docs/decisions/ADR-0014-no-bounty-listings.md;
 *        src/shared/ui/BountyTag.tsx, src/shared/ui/MoneySlider.tsx
 *        (consumers).
 */

/**
 * MONEY: the fixed platform fee for a NO-BOUNTY listing (£5), integer pence.
 *
 * DISPLAY ONLY, and a MIRROR of the CHECK constraint in
 * supabase/migrations/20260819100000_a_listing_can_be_free.sql:
 *
 *     check (case kind when 'listing_fee' then amount_pence = 500 ... end)
 *
 * — not a range, one price, so a fee row carrying any other number fails on
 * write rather than turning up in a reconciliation. This constant exists so the
 * wizard can say "Post & pay £5" before a post exists to read a price from,
 * exactly as MIN/MAX_BOUNTY_PENCE mirror the posts CHECK.
 *
 * ⚠️ WAS 499 UNTIL 2026-08-22, mirroring a design in this repo that the
 * database never had. The £4.99 implementation (a posts.listing_fee_pence
 * snapshot column, current_listing_fee_pence(), record_listing_fee_intent) was
 * written here while production shipped a different one, and the two were
 * discovered to have diverged only when no-bounty listings failed to charge at
 * all. The live design won; see ADR-0014.
 *
 * NEVER wire this into a charge. A mismatch shows the user the wrong number but
 * cannot mis-charge them: record_post_payment_intent re-derives the price from
 * the post itself and raises BOUNTY_MISMATCH on any disagreement.
 */
export const LISTING_FEE_PENCE = 500;

/** Format integer pence as a GBP string: 50000 → "£500", 125050 → "£1,250.50". */
export function formatPounds(pence: number): string {
  if (!Number.isInteger(pence)) {
    throw new Error(`formatPounds expects integer pence, got ${pence}`);
  }
  const negative = pence < 0;
  const absolute = Math.abs(pence);
  const wholePounds = Math.floor(absolute / 100);
  const remainder = absolute % 100;

  const grouped = wholePounds.toLocaleString('en-GB');
  const fraction = remainder === 0 ? '' : `.${String(remainder).padStart(2, '0')}`;

  return `${negative ? '-' : ''}£${grouped}${fraction}`;
}

/**
 * The explicit token a NO-REWARD listing uses in the `bounty` route param.
 *
 * Exported so the writer (the two entry points into /report-sighting) and the
 * reader (the route file) cannot drift apart on the spelling.
 */
export const NO_BOUNTY_PARAM = 'none';

/**
 * Encode a bounty for the `bounty` route param.
 *
 * WHY THIS EXISTS AT ALL: `String(null)` is `"null"`, and `Number("null")` is
 * NaN — which the route cannot tell apart from the param simply being absent.
 * Absent means "the caller didn't say", and the sighting-success screen answers
 * that with "you'll receive the bounty". So without this, a spotter reporting a
 * no-reward car (ADR-0014) is promised money that will never arrive.
 *
 * Lives in shared/lib rather than in either feature because BOTH entry points
 * into the report flow need it — the post detail and the map's peek card — and
 * features must not deep-import each other (ARCHITECTURE.md rule 1).
 */
export function bountyParam(bountyPence: number | null): string {
  return bountyPence === null ? NO_BOUNTY_PARAM : String(bountyPence);
}

/** The two sides of a paid-out bounty. Parts always sum exactly to the input. */
export interface BountyBreakdown {
  spotterPence: number;
  feePence: number;
}

/** Split a bounty into the spotter's payout and the platform fee
 *  (docs/DOMAIN.md: 95% to the winning spotter, 5% platform fee). */
export function bountyBreakdown(bountyPence: number): BountyBreakdown {
  if (!Number.isInteger(bountyPence) || bountyPence < 0) {
    throw new Error(`bountyBreakdown expects non-negative integer pence, got ${bountyPence}`);
  }
  // MONEY: DISPLAY ONLY. Real payouts are computed server-side via Stripe
  // transfer math (docs/DOMAIN.md: "never calculated in the app client";
  // ADR-0002) — never wire this into a payout or charge path.
  // MONEY: the reference 95/5 split. The fee rounds DOWN and the spotter
  // receives the remainder, so displayed copy never overstates our fee and
  // spotter + fee always reconstruct the bounty exactly. Whole-pound bounties
  // (the only kind the UI produces) split with no remainder at all.
  const feePence = Math.floor((bountyPence * 5) / 100);
  return { spotterPence: bountyPence - feePence, feePence };
}

/**
 * The card fee a refund keeps: a FIXED 1.5% + 20p of the reward (ADR-0021,
 * 2026-10-06). EXACT, not an estimate: the server's refund withholds this same
 * figure whatever the card actually cost (Trackitdown absorbs the rest), so
 * the app can state it plainly — "£3.20", never "about £3.20".
 *
 * MONEY: a MIRROR of `cardFeePence` in supabase/functions/_shared/refundEscrow.ts,
 * which decides the refund. supabase/tests/refundEscrow.test.ts pins that the
 * two agree for every reward amount. DISPLAY ONLY here — never wire this into
 * a refund or charge path. A third copy, public.card_fee_pence (SQL,
 * 20261006130000), words the owner's reward_ended push — change all three.
 */
export function cardFeePence(bountyPence: number): number {
  // 1.5%, rounded half-up to the penny, in INTEGER maths (no float ever
  // touches an amount): floor((pence × 15 + 500) / 1000) is round(pence × 0.015).
  return Math.floor((bountyPence * 15 + 500) / 1000) + 20;
}

/**
 * What an owner gets back when a reward ends without a credited spotter
 * (cancel, the 60 days ending, recovered-it-themselves): the reward minus the
 * fixed card fee, floored at zero. Exact — see cardFeePence.
 *
 * Lives here rather than under features/vehicles (where it started) because the
 * bounty slider quotes it too, and shared/ui cannot import from a feature.
 * Every surface that quotes a refund before the owner commits must use this one
 * function, or two screens will disagree about the same number.
 */
export function refundPence(bountyPence: number): number {
  return Math.max(0, bountyPence - cardFeePence(bountyPence));
}
