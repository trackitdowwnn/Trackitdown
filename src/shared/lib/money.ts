/**
 * WHAT:  Money formatting — pence-integer amounts rendered as GBP strings
 *        ("£500", "£1,250.50").
 * WHY:   All money in the app is integer pence end-to-end (docs/DOMAIN.md:
 *        bounties, escrow, the 95/5 split) — floats never touch amounts, so
 *        this formatter is the single place pence become display text. Whole
 *        pounds drop the ".00" (matches the design system's bounty examples);
 *        fractional amounts keep two decimals. UK-only per the roadmap, so
 *        GBP is fixed.
 * LINKS: docs/DOMAIN.md (Money & fees); docs/TESTING.md (Tier 2: money
 *        formatter); src/shared/ui/BountyTag.tsx (consumer).
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
