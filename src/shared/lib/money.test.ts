/**
 * WHAT:  Tests for the money formatter — whole pounds, fractional pence,
 *        grouping, zero, negatives, and the integer-only guard.
 * WHY:   Money is integer pence everywhere (docs/DOMAIN.md); a formatting
 *        slip here misrepresents bounty amounts on every card and payout
 *        screen at once. Tier 2 per docs/TESTING.md.
 * LINKS: src/shared/lib/money.ts.
 */

import { formatPounds } from './money';

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
