/**
 * WHAT:  Tests for MoneyBriefLine — the one line under an owner's card on My
 *        listings saying where that listing's money is.
 * WHY:   The card's status badge says what happened to the CAR; this line is
 *        the only place My listings says what happened to the MONEY, and
 *        "Recovered" used to read the same whether the spotter was paid or the
 *        owner refunded. The dot is colour only, so the words — and the spoken
 *        "Money:" prefix that tells a screen reader what the words are about —
 *        must carry the meaning. The per-state copy is pinned in
 *        ../lib/postMoney.test.ts; this pins that the line renders it.
 * LINKS: ./MoneyBriefLine.tsx; ../lib/postMoney.ts (briefCopy);
 *        ../screens/MyPostsScreen.tsx (the host); docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { MoneyBriefLine } from './MoneyBriefLine';

describe('MoneyBriefLine', () => {
  it.each([
    [{ state: 'held', amountPence: 50000 }, '£500 reward held'],
    [{ state: 'paid', amountPence: 50000 }, '£500 sent to your spotter'],
    [{ state: 'refunded', amountPence: 52500 }, '£525 refunded'],
    [{ state: 'refund_on_hold', amountPence: 52500, until: '2026-09-28T18:00:00Z' }, 'Refund on hold'],
    [{ state: 'being_checked', amountPence: 50000 }, 'Being checked'],
  ] as const)('renders the brief copy for %o', async (brief, words) => {
    const line = await render(<MoneyBriefLine money={brief} testID="money-line" />);

    expect(line.getByTestId('money-line')).toBeTruthy();
    expect(line.getByText(words)).toBeTruthy();
    await line.unmount();
  });

  it('tells a screen reader the words are about money, not the car', async () => {
    const line = await render(<MoneyBriefLine money={{ state: 'refunded', amountPence: 52500 }} />);

    expect(line.getByLabelText('Money: £525 refunded')).toBeTruthy();
    await line.unmount();
  });

  it('still says something true when the amount is unknown', async () => {
    const line = await render(<MoneyBriefLine money={{ state: 'paid', amountPence: null }} />);

    expect(line.getByText('Reward sent')).toBeTruthy();
    await line.unmount();
  });
});
