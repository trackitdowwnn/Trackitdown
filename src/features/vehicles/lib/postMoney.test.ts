/**
 * WHAT:  Tests for the owner's money copy — every state's words, the receipt
 *        line for both pricing rules, the refund's card-fee line, and the
 *        "send the reward" gate.
 * WHY:   This is the only place a money state becomes words the owner reads,
 *        on the screen where they decide what to do next. Two properties
 *        matter most and are pinned explicitly: `being_checked` never hints at
 *        a reason or an outcome (the server makes pending and rejected reviews
 *        identical for a reason), and "Send the reward" is offered only when a
 *        credited spotter is actually owed it (bug fixed 2026-09-25).
 * LINKS: ./postMoney.ts; supabase/migrations/20260925110000_money_you_can_see.sql.
 */

import {
  briefCopy,
  canFinishRefund,
  canSendReward,
  detailCopy,
  moneyCopy,
  POST_MONEY_STATES,
  postMoneySchema,
  receiptLine,
  refundFeeLine,
  type PostMoney,
} from './postMoney';

const NOW = new Date('2026-09-25T12:00:00Z');

const money = (over: Partial<PostMoney> = {}): PostMoney => ({
  kind: 'bounty_escrow',
  pricing: 'fee_on_top',
  state: 'held',
  headlinePence: 50000,
  rewardPence: 50000,
  serviceFeePence: 2500,
  chargedPence: 52500,
  hasCreditedSighting: false,
  paid: null,
  refund: null,
  refundHold: null,
  ...over,
});

describe('moneyCopy', () => {
  it('has words for every state the server can send', () => {
    for (const state of POST_MONEY_STATES) {
      const copy = moneyCopy({ state, amountPence: 50000 }, NOW);
      expect(copy.label.length).toBeGreaterThan(0);
      expect(['neutral', 'warning', 'success']).toContain(copy.tone);
    }
  });

  it.each([
    ['held', '£500 reward held'],
    ['awaiting_payee', 'Waiting for your spotter'],
    ['sending', 'Sending £500'],
    ['paid', '£500 sent to your spotter'],
    ['refund_on_hold', 'Refund on hold'],
    ['refund_paused', 'Refund paused'],
    ['refunding', 'Refund on its way'],
    ['refunded', '£500 refunded'],
  ] as const)('%s reads "%s"', (state, label) => {
    expect(moneyCopy({ state, amountPence: 50000 }, NOW).label).toBe(label);
  });

  it('a £5 listing reads as a fee paid, never as a reward', () => {
    const copy = moneyCopy({ state: 'fee_paid', amountPence: 500 }, NOW);
    expect(copy.label).toBe('£5 listing fee paid');
    expect(copy.label).not.toMatch(/reward/i);
  });

  it('⚠️ being_checked never gives a reason or an outcome', () => {
    const copy = moneyCopy({ state: 'being_checked', amountPence: 50000 }, NOW);
    const words = `${copy.label} ${copy.line}`;
    expect(words).not.toMatch(/reject|fraud|device|card|email|suspicious|declin/i);
    expect(words).toMatch(/nothing you need to do/);
  });

  it('awaiting_payee does not blame the spotter', () => {
    const copy = moneyCopy({ state: 'awaiting_payee', amountPence: 50000 }, NOW);
    expect(copy.line).toBe('£500 is sent automatically once they add their bank details.');
  });

  it('a held refund names when it is sent', () => {
    const copy = moneyCopy(
      { state: 'refund_on_hold', amountPence: 52500, until: '2026-09-28T18:00:00Z' },
      NOW,
    );
    expect(copy.line).toMatch(/^Sent after \w+ \d{1,2}:\d{2}/);
    expect(copy.line).toMatch(/unless a spotter says their sighting helped/);
  });
});

describe('detailCopy / briefCopy', () => {
  it('a paid listing says when', () => {
    const copy = detailCopy(
      money({ state: 'paid', headlinePence: 50000, paid: { pence: 50000, at: '2026-09-20T10:00:00Z' } }),
      NOW,
    );
    expect(copy.label).toBe('£500 sent to your spotter');
    expect(copy.line).toBe('Sent on 20 Sept.');
  });

  it('a card line reads the brief the same way', () => {
    expect(briefCopy({ state: 'held', amountPence: 50000 }, NOW).label).toBe('£500 reward held');
  });
});

describe('receiptLine', () => {
  it('itemises a fee-on-top charge', () => {
    expect(receiptLine(money())).toBe(
      'You paid £525: the £500 reward and a £25 service fee.',
    );
  });

  it('says it plainly for a listing charged before the fee moved on top', () => {
    expect(
      receiptLine(
        money({ pricing: 'fee_inside', chargedPence: 50000, rewardPence: 47500, serviceFeePence: 2500 }),
      ),
    ).toBe('You paid £500, including the £475 reward.');
  });

  it('a £5 listing: paid to list, not refundable', () => {
    expect(
      receiptLine(
        money({ kind: 'listing_fee', pricing: 'flat_fee', chargedPence: 500, rewardPence: null, serviceFeePence: 500 }),
      ),
    ).toBe('You paid £5 to list. Not refundable.');
  });
});

describe('refundFeeLine', () => {
  it('names the card fee a refund kept', () => {
    expect(
      refundFeeLine(
        money({ state: 'refunded', refund: { pence: 51692, cardFeePence: 808, at: '2026-09-24T09:00:00Z' } }),
      ),
    ).toBe('The £8.08 card processing fee isn’t refundable.');
  });

  it('says nothing when there is no finished refund', () => {
    expect(refundFeeLine(money())).toBeNull();
  });
});

describe('refund_owed (review 2026-09-25)', () => {
  it('says the refund has not been sent, and where to finish it', () => {
    const copy = moneyCopy({ state: 'refund_owed', amountPence: 52500 }, NOW);
    expect(copy.label).toBe('Refund not sent yet');
    expect(copy.line).toMatch(/Finish your refund/);
    expect(copy.tone).toBe('warning');
  });

  it('is the only state that offers "Finish your refund"', () => {
    for (const state of POST_MONEY_STATES) {
      expect(canFinishRefund(money({ state }))).toBe(state === 'refund_owed');
    }
    expect(canFinishRefund(null)).toBe(false);
  });
});

describe('canSendReward', () => {
  it('only while a credited spotter is owed it', () => {
    expect(canSendReward(money({ state: 'awaiting_payee', hasCreditedSighting: true }))).toBe(true);
    expect(canSendReward(money({ state: 'sending', hasCreditedSighting: true }))).toBe(true);
  });

  it('⚠️ never on a held no-spotter refund, which shares its post status', () => {
    expect(canSendReward(money({ state: 'refund_on_hold', hasCreditedSighting: false }))).toBe(false);
  });

  it('never once paid, while being checked, or before the money is known', () => {
    expect(canSendReward(money({ state: 'paid', hasCreditedSighting: true }))).toBe(false);
    expect(canSendReward(money({ state: 'being_checked', hasCreditedSighting: true }))).toBe(false);
    expect(canSendReward(null)).toBe(false);
  });
});

describe('postMoneySchema', () => {
  it('parses the server shape', () => {
    expect(postMoneySchema.parse(money())).toEqual(money());
  });

  it('fails loudly on a state this build does not know', () => {
    expect(() => postMoneySchema.parse({ ...money(), state: 'teleported' })).toThrow();
  });
});
