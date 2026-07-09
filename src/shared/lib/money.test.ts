/**
 * WHAT:  Tests for the money formatter and the 95/5 bounty split — whole
 *        pounds, fractional pence, grouping, zero, negatives, the
 *        integer-only guard, exact splits, and the remainder-penny rule.
 * WHY:   Money is integer pence everywhere (docs/DOMAIN.md); a formatting
 *        slip misrepresents bounty amounts everywhere at once, and
 *        bountyBreakdown is THE reference split implementation — Tier 1 money
 *        per docs/TESTING.md.
 * LINKS: src/shared/lib/money.ts.
 */

import { bountyBreakdown, formatPounds } from './money';

describe('formatPounds', () => {
  it.each([
    [50000, '£500'],
    [5000000, '£50,000'],
    [125050, '£1,250.50'],
    [101, '£1.01'],
    [99, '£0.99'],
    [0, '£0'],
    [-50000, '-£500'],
  ])('formats %i pence as %s', (pence, expected) => {
    expect(formatPounds(pence)).toBe(expected);
  });

  it('rejects non-integer pence — floats never touch money', () => {
    expect(() => formatPounds(500.5)).toThrow(/integer pence/);
  });
});

describe('bountyBreakdown', () => {
  // MONEY: these pin the reference 95/5 split (docs/DOMAIN.md).
  it.each([
    [20000, 19000, 1000], // £200 → spotter £190, fee £10 (the DOMAIN example)
    [5000, 4750, 250], // £50 minimum bounty
    [500000, 475000, 25000], // £5,000 maximum bounty
    [0, 0, 0],
  ])('splits %i pence into spotter %i and fee %i', (total, spotter, fee) => {
    expect(bountyBreakdown(total)).toEqual({ spotterPence: spotter, feePence: fee });
  });

  it('gives the remainder penny to the spotter — the fee rounds down', () => {
    // 23750 × 5% = 1187.5p: the fee floors to 1187, the spotter gets the rest.
    expect(bountyBreakdown(23750)).toEqual({ spotterPence: 22563, feePence: 1187 });
  });

  it('parts always sum exactly to the bounty', () => {
    for (let pence = 0; pence <= 250; pence += 1) {
      const { spotterPence, feePence } = bountyBreakdown(pence);
      expect(spotterPence + feePence).toBe(pence);
      expect(feePence).toBeLessThanOrEqual(spotterPence);
    }
  });

  it('rejects floats and negative amounts', () => {
    expect(() => bountyBreakdown(100.5)).toThrow(/integer pence/);
    expect(() => bountyBreakdown(-100)).toThrow(/integer pence/);
  });
});
