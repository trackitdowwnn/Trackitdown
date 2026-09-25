/**
 * WHAT:  Money formatting and money maths — pence-integer amounts rendered as
 *        GBP strings ("£500", "£1,250.50"), plus the reward listing's charge
 *        (reward + 5% service fee, ADR-0020) and the fixed listing-fee price.
 * WHY:   All money in the app is integer pence end-to-end (docs/DOMAIN.md:
 *        rewards, escrow, the service fee) — floats never touch amounts, so
 *        this formatter is the single place pence become display text, and
 *        chargeBreakdown is the single place the charge is computed. Whole
 *        pounds drop the ".00" (matches the design system's bounty examples);
 *        fractional amounts keep two decimals. UK-only per the roadmap, so
 *        GBP is fixed.
 * LINKS: docs/DOMAIN.md (Money & fees); docs/TESTING.md (Tier 1: money);
 *        docs/decisions/ADR-0014-no-bounty-listings.md;
 *        docs/decisions/ADR-0020-the-reward-is-the-reward.md;
 *        supabase/functions/_shared/serviceFee.ts (the charge this mirrors);
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

/** The service fee, as a percentage of the reward (ADR-0020). */
export const SERVICE_FEE_PERCENT = 5;

/** What a reward listing costs. The parts always sum exactly to the charge. */
export interface ChargeBreakdown {
  /** What the credited spotter receives — the advertised reward, in full. */
  rewardPence: number;
  /** Our 5%, added on top and kept only on a spotter-led recovery. */
  serviceFeePence: number;
  /** What the owner is charged: reward + service fee. */
  chargePence: number;
}

/**
 * The charge for a reward listing: the reward plus a floor(5%) service fee
 * (ADR-0020 — "the reward is the reward").
 *
 * MONEY: DISPLAY ONLY — a MIRROR of `rewardCharge` in
 * supabase/functions/_shared/serviceFee.ts, which is what create-payment-intent
 * actually charges. The client never sends an amount; it sends a post id, and
 * the payment hook refuses to open the sheet if the server's total differs from
 * this one — so a drift here shows up as "the price changed", never as a wrong
 * charge. The fee rounds DOWN, like Postgres integer division; whole-pound
 * rewards (the only kind the UI produces) have no remainder at all.
 */
export function chargeBreakdown(rewardPence: number): ChargeBreakdown {
  if (!Number.isInteger(rewardPence) || rewardPence < 0) {
    throw new Error(`chargeBreakdown expects non-negative integer pence, got ${rewardPence}`);
  }
  const serviceFeePence = Math.floor((rewardPence * SERVICE_FEE_PERCENT) / 100);
  return { rewardPence, serviceFeePence, chargePence: rewardPence + serviceFeePence };
}

/**
 * A CHARGE minus the ESTIMATED non-recoverable card fee (~UK rate, 1.5% + 20p),
 * floored at zero — what an owner gets back when a listing ends without a
 * credited spotter (cancel, takedown, recovered-it-themselves).
 *
 * ⚠️ PASS THE CHARGE, NOT THE REWARD. Since ADR-0020 a refund returns the whole
 * charge — reward AND service fee — minus the card fee, so the reward alone
 * under-quotes it. `chargeBreakdown(reward).chargePence` is the argument.
 *
 * MONEY: DISPLAY ONLY, and an ESTIMATE. The server withholds the real Stripe
 * fee and returns the authoritative refunded amount, which is what the
 * post-refund toast shows — never wire this into a refund or charge path.
 *
 * Lives here rather than under features/vehicles (where it started) because the
 * reward slider quotes it too, and shared/ui cannot import from a feature.
 * Every surface that quotes a refund before the owner commits must use this one
 * function, or two screens will disagree about the same number.
 */
export function estimateRefundPence(chargePence: number): number {
  return Math.max(0, chargePence - (Math.round(chargePence * 0.015) + 20));
}
