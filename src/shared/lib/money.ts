/**
 * WHAT:  Money formatting and money maths — pence-integer amounts rendered as
 *        GBP strings ("£500", "£1,250.50"), plus the reference 95/5 bounty
 *        split.
 * WHY:   All money in the app is integer pence end-to-end (docs/DOMAIN.md:
 *        bounties, escrow, the 95/5 split) — floats never touch amounts, so
 *        this formatter is the single place pence become display text, and
 *        bountyBreakdown is the single place the split is computed. Whole
 *        pounds drop the ".00" (matches the design system's bounty examples);
 *        fractional amounts keep two decimals. UK-only per the roadmap, so
 *        GBP is fixed.
 * LINKS: docs/DOMAIN.md (Money & fees); docs/TESTING.md (Tier 1: money);
 *        src/shared/ui/BountyTag.tsx, src/shared/ui/MoneySlider.tsx
 *        (consumers).
 */

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
