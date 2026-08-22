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

import {
  bountyBreakdown,
  bountyParam,
  formatPounds,
  LISTING_FEE_PENCE,
  NO_BOUNTY_PARAM,
} from './money';

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

describe('bountyParam', () => {
  it('encodes a bounty as its pence value', () => {
    expect(bountyParam(25000)).toBe('25000');
  });

  // The bug this function exists to prevent: String(null) is "null", Number()
  // turns that into NaN, and the route cannot tell NaN from an absent param —
  // so the sighting-success screen fell through to "you'll receive the bounty"
  // on a listing that has none.
  it('encodes a no-reward listing as an explicit token, never "null"', () => {
    expect(bountyParam(null)).toBe(NO_BOUNTY_PARAM);
    expect(bountyParam(null)).not.toBe('null');
    expect(Number.isNaN(Number(bountyParam(null)))).toBe(true);
    // ...and the token must be distinguishable from a real amount, which is the
    // whole point: the route branches on it BEFORE parsing.
    expect(bountyParam(null)).not.toBe(bountyParam(25000));
  });
});

describe('LISTING_FEE_PENCE', () => {
  // MONEY (ADR-0014). A DISPLAY MIRROR of the authoritative price, which is the
  // conditional CHECK on payments.amount_pence in 20260819100000: a listing_fee
  // row must equal exactly 500. It cannot mis-charge anyone —
  // record_post_payment_intent re-derives what the post owes and raises
  // BOUNTY_MISMATCH on any disagreement — but it can show the wrong number on
  // the pricing card and the "Post & pay" CTA, which is the last thing an owner
  // reads before paying.
  //
  // It said 499 until 2026-08-22, mirroring a £4.99 design that lived only in
  // this repo while the database charged £5. Nothing caught it, because the
  // repo's own tests agreed with the repo.
  it('is £5 in integer pence, matching the ledger CHECK in a_listing_can_be_free', () => {
    expect(LISTING_FEE_PENCE).toBe(500);
  });

  it('formats as the exact string the pricing card and CTA show', () => {
    expect(formatPounds(LISTING_FEE_PENCE)).toBe('£5');
  });

  it('is integer pence, so it survives the money formatter at all', () => {
    // formatPounds throws on a non-integer; a float here would crash the
    // pricing step rather than round oddly.
    expect(Number.isInteger(LISTING_FEE_PENCE)).toBe(true);
  });
});
