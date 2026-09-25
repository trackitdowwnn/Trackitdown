/**
 * WHAT:  Tests for PostMoneyCard — the owner's "where's my money" card on a
 *        listing: the state label, the one-sentence line, the receipt, the
 *        refund's card-fee line, and the single screen-reader sentence.
 * WHY:   This is the persistent answer to an owner's money question, so what
 *        it renders for each shape of reply matters: a refund must say the
 *        card fee is not coming back, a state with no sentence must not render
 *        an empty line, and the spoken label must read cleanly (the lines
 *        carry their own full stops, and a plain join once read "car.. You
 *        paid"). The copy itself is pinned in ../lib/postMoney.test.ts.
 * LINKS: ./PostMoneyCard.tsx; ../lib/postMoney.ts (detailCopy, receiptLine,
 *        refundFeeLine); docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import type { PostMoney } from '../lib/postMoney';
import { PostMoneyCard } from './PostMoneyCard';

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

/** The one sentence a screen reader hears for the whole card. */
const spoken = (card: { getByTestId: (id: string) => { props: Record<string, unknown> } }) =>
  card.getByTestId('post-money-card').props.accessibilityLabel as string;

describe('PostMoneyCard', () => {
  it('shows the state, what it means, and what the owner paid', async () => {
    const card = await render(<PostMoneyCard money={money()} now={NOW} />);

    expect(card.getByTestId('post-money-label').props.children).toBe('£500 reward held');
    expect(
      card.getByText(
        'Paid out only when you say who found your car — or back to you if no one did.',
      ),
    ).toBeTruthy();
    expect(
      card.getByText('You paid £525: the £500 reward and a £25 service fee.'),
    ).toBeTruthy();
    await card.unmount();
  });

  it('reads the whole card as one clean sequence of sentences — never ".."', async () => {
    const card = await render(<PostMoneyCard money={money()} now={NOW} />);

    const label = spoken(card);
    expect(label).toBe(
      '£500 reward held. ' +
        'Paid out only when you say who found your car — or back to you if no one did. ' +
        'You paid £525: the £500 reward and a £25 service fee.',
    );
    expect(label).not.toMatch(/\.\./);
    await card.unmount();
  });

  it('renders no sentence line when the state’s label says it all', async () => {
    const card = await render(
      <PostMoneyCard
        money={money({
          kind: 'listing_fee',
          pricing: 'flat_fee',
          state: 'fee_paid',
          headlinePence: 500,
          rewardPence: null,
          serviceFeePence: null,
          chargedPence: 500,
        })}
        now={NOW}
      />,
    );

    expect(card.getByText('£5 listing fee paid')).toBeTruthy();
    expect(card.getByText('You paid £5 to list. Not refundable.')).toBeTruthy();
    const label = spoken(card);
    expect(label).toBe('£5 listing fee paid. You paid £5 to list. Not refundable.');
    expect(label).not.toMatch(/\.\./);
    await card.unmount();
  });

  it('says the card fee is not coming back on a finished refund', async () => {
    const card = await render(
      <PostMoneyCard
        money={money({
          state: 'refunded',
          headlinePence: 50000,
          refund: { pence: 50000, cardFeePence: 95, at: '2026-09-20T10:00:00Z' },
        })}
        now={NOW}
      />,
    );

    expect(card.getByText('£500 refunded')).toBeTruthy();
    expect(card.getByText(/^Returned to your card on 20 Sep/)).toBeTruthy();
    expect(card.getByText('The £0.95 card processing fee isn’t refundable.')).toBeTruthy();
    const label = spoken(card);
    expect(label).toMatch(/card processing fee isn’t refundable\.$/);
    expect(label).not.toMatch(/\.\./);
    await card.unmount();
  });

  it('shows no card-fee line when the refund kept nothing back', async () => {
    const card = await render(
      <PostMoneyCard
        money={money({
          state: 'refunded',
          refund: { pence: 52500, cardFeePence: 0, at: '2026-09-20T10:00:00Z' },
        })}
        now={NOW}
      />,
    );

    expect(card.queryByText(/card processing fee/)).toBeNull();
    await card.unmount();
  });

  it('⚠️ says nothing about why a payout is being checked', async () => {
    const card = await render(
      <PostMoneyCard money={money({ state: 'being_checked', hasCreditedSighting: true })} now={NOW} />,
    );

    const label = spoken(card);
    expect(label).toMatch(/^Being checked\. /);
    expect(label).not.toMatch(/reject|fraud|device|suspicious|declin/i);
    expect(label).not.toMatch(/\.\./);
    await card.unmount();
  });

  it('describes an old fee-inside listing without inventing a service fee', async () => {
    const card = await render(
      <PostMoneyCard
        money={money({ pricing: 'fee_inside', rewardPence: 47500, serviceFeePence: null, chargedPence: 50000 })}
        now={NOW}
      />,
    );

    expect(card.getByText('You paid £500, including the £475 reward.')).toBeTruthy();
    expect(card.queryByText(/service fee/)).toBeNull();
    await card.unmount();
  });
});
