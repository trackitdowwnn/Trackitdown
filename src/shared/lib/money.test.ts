/**
 * WHAT:  Tests for the money formatter, the reward listing's charge (reward +
 *        5% service fee, ADR-0020) and the refund estimate — whole pounds,
 *        fractional pence, grouping, zero, negatives, the integer-only guard,
 *        the fee-rounds-down rule, and parts that always sum to the charge.
 * WHY:   Money is integer pence everywhere (docs/DOMAIN.md); a formatting
 *        slip misrepresents reward amounts everywhere at once, and
 *        chargeBreakdown is the number the owner is shown before paying —
 *        Tier 1 money per docs/TESTING.md. It must match the server's rule
 *        (supabase/functions/_shared/serviceFee.ts) or every reward listing is
 *        refused at the payment step.
 * LINKS: src/shared/lib/money.ts; supabase/functions/_shared/serviceFee.test.ts.
 */

import { rewardCharge } from '../../../supabase/functions/_shared/serviceFee';
import {
  bountyParam,
  chargeBreakdown,
  estimateRefundPence,
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

describe('chargeBreakdown', () => {
  // MONEY: these pin the fee-on-top rule (ADR-0020). The reward is untouched —
  // it is what the spotter receives — and the fee is added on top.
  it.each([
    [50000, 2500, 52500], // £500 reward → £25 fee → £525 charged
    [1000, 50, 1050], // £10 minimum reward
    [500000, 25000, 525000], // £5,000 maximum reward
    [0, 0, 0],
  ])('charges a %i pence reward a %i fee, %i in total', (reward, fee, charge) => {
    expect(chargeBreakdown(reward)).toEqual({
      rewardPence: reward,
      serviceFeePence: fee,
      chargePence: charge,
    });
  });

  it('rounds the fee down — 5% of 23750p is 1187.5p, charged as 1187p', () => {
    expect(chargeBreakdown(23750)).toEqual({
      rewardPence: 23750,
      serviceFeePence: 1187,
      chargePence: 24937,
    });
  });

  it('agrees with the server rule for every whole-pound reward', () => {
    // The payment hook refuses to open the sheet when these two disagree, so a
    // drift here would stop every reward listing at the last step.
    for (let pounds = 10; pounds <= 5000; pounds += 1) {
      const server = rewardCharge(pounds * 100);
      const client = chargeBreakdown(pounds * 100);
      expect(client.chargePence).toBe(server.chargePence);
      expect(client.serviceFeePence).toBe(server.serviceFeePence);
    }
  });

  it('rejects floats and negative amounts', () => {
    expect(() => chargeBreakdown(100.5)).toThrow(/integer pence/);
    expect(() => chargeBreakdown(-100)).toThrow(/integer pence/);
  });
});

describe('estimateRefundPence', () => {
  it('nets the estimated card fee (1.5% + 20p) off the whole charge', () => {
    // £525 charged: 1.5% is 787.5p → 788p, plus 20p = 808p withheld.
    expect(estimateRefundPence(52500)).toBe(51692);
  });

  it('never goes below zero', () => {
    expect(estimateRefundPence(10)).toBe(0);
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
