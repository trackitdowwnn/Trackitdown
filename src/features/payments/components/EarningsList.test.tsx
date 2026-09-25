/**
 * WHAT:  Tests for the spotter's "Your rewards" list — the words for every
 *        earning state (earningCopy), the totals line (totalsLine), and what a
 *        rendered row shows and reads aloud: the car, the amount, the state.
 * WHY:   This is the only place a spotter learns where each reward is. Three
 *        properties matter most and are pinned explicitly: `being_checked`
 *        never hints at a reason or an outcome (the server makes a pending and
 *        a rejected review identical, and the words must too); the totals line
 *        never says "£0"; and a paid row shows what was actually PAID, not the
 *        reward on the listing. PayoutsScreen.test.tsx covers the list inside
 *        its host; these pin each branch as data.
 * LINKS: ./EarningsList.tsx; ../api/payoutsApi.ts (EARNING_STATES, Earnings);
 *        supabase/migrations/20260925110000_money_you_can_see.sql
 *          (credit_money_state); docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { EARNING_STATES, type Earning, type Earnings } from '../api/payoutsApi';
import { EarningsList, earningCopy, totalsLine } from './EarningsList';

// EARNING_STATES is imported for its runtime list; its module also builds the
// Supabase client, which this pure-copy test never reaches.
jest.mock('@/shared/api', () => ({ supabase: {} }));

const NOW = new Date('2026-09-25T12:00:00Z');

const earning = (over: Partial<Earning> = {}): Earning => ({
  sightingId: 'aaaaaaaa-0000-0000-0000-00000000000a',
  car: { make: 'Ford', colour: 'Blue' },
  state: 'on_its_way',
  rewardPence: 30000,
  paidPence: null,
  paidAt: null,
  ...over,
});

const list = (items: Earning[], totals: Earnings['totals']): Earnings => ({ items, totals });

describe('earningCopy', () => {
  it('has words and a tone for every state the server can send', () => {
    for (const state of EARNING_STATES) {
      const copy = earningCopy({ state, paidAt: null }, NOW);
      expect(copy.label.length).toBeGreaterThan(0);
      expect(['neutral', 'warning', 'success']).toContain(copy.tone);
    }
  });

  it.each([
    ['add_details', 'Add your bank details to get it', 'warning'],
    ['verifying', 'Stripe is checking your details', 'warning'],
    ['being_checked', 'Being checked — nothing you need to do', 'warning'],
    ['on_its_way', 'On its way to your bank', 'neutral'],
  ] as const)('says where a %s reward is', (state, label, tone) => {
    expect(earningCopy({ state, paidAt: null }, NOW)).toEqual({ label, tone });
  });

  it('⚠️ being_checked never gives a reason or an outcome', () => {
    const { label } = earningCopy({ state: 'being_checked', paidAt: null }, NOW);
    expect(label).not.toMatch(
      /reject|fraud|device|card|email|suspicious|declin|fail|flag|review|block|refus|denied/i,
    );
    expect(label).toMatch(/nothing you need to do/);
  });

  it('dates a paid reward, and is the only state in the success tone', () => {
    const copy = earningCopy({ state: 'paid', paidAt: '2026-09-20T10:00:00Z' }, NOW);
    expect(copy.label).toMatch(/^Paid on 20 Sep/);
    expect(copy.tone).toBe('success');
    // "On its way" must never look like money that has arrived.
    for (const state of EARNING_STATES.filter((s) => s !== 'paid')) {
      expect(earningCopy({ state, paidAt: null }, NOW).tone).not.toBe('success');
    }
  });

  it('says plain "Paid" when the payout has no date yet, rather than inventing one', () => {
    expect(earningCopy({ state: 'paid', paidAt: null }, NOW)).toEqual({
      label: 'Paid',
      tone: 'success',
    });
  });
});

describe('totalsLine', () => {
  it('shows both parts, paid first', () => {
    expect(totalsLine({ paidPence: 50000, pendingPence: 30000 })).toBe(
      '£500 paid · £300 not paid yet',
    );
  });

  it('omits a zero paid part — never "£0 paid"', () => {
    expect(totalsLine({ paidPence: 0, pendingPence: 30000 })).toBe('£300 not paid yet');
  });

  it('omits a zero pending part — never "£0 not paid yet"', () => {
    expect(totalsLine({ paidPence: 50000, pendingPence: 0 })).toBe('£500 paid');
  });

  it('is null when both are zero, so no line renders at all', () => {
    expect(totalsLine({ paidPence: 0, pendingPence: 0 })).toBeNull();
  });

  it('keeps the pence of an odd amount', () => {
    expect(totalsLine({ paidPence: 12345, pendingPence: 0 })).toBe('£123.45 paid');
  });
});

describe('EarningsList', () => {
  it('shows a paid row at the amount actually PAID, not the listing’s reward', async () => {
    const { getByText, queryByText } = await render(
      <EarningsList
        now={NOW}
        earnings={list(
          [
            earning({
              state: 'paid',
              rewardPence: 50000,
              paidPence: 47500,
              paidAt: '2026-09-20T10:00:00Z',
            }),
          ],
          { paidPence: 47500, pendingPence: 0 },
        )}
      />,
    );

    expect(getByText('£475')).toBeTruthy();
    expect(queryByText('£500')).toBeNull();
  });

  it('shows the reward for a paid row whose paid amount is not known yet', async () => {
    const { getByText } = await render(
      <EarningsList
        now={NOW}
        earnings={list([earning({ state: 'paid', rewardPence: 50000, paidPence: null })], {
          paidPence: 50000,
          pendingPence: 0,
        })}
      />,
    );

    expect(getByText('£500')).toBeTruthy();
  });

  it('shows the reward for a row not yet paid, even if a paid amount rides along', async () => {
    const { getByText } = await render(
      <EarningsList
        now={NOW}
        earnings={list([earning({ state: 'on_its_way', rewardPence: 30000, paidPence: 1 })], {
          paidPence: 0,
          pendingPence: 30000,
        })}
      />,
    );

    expect(getByText('£300')).toBeTruthy();
  });

  it('names the car by colour and make, or a neutral stand-in when both are blank', async () => {
    const { getByText } = await render(
      <EarningsList
        now={NOW}
        earnings={list(
          [
            earning({ sightingId: 'aaaaaaaa-0000-0000-0000-000000000001' }),
            earning({
              sightingId: 'aaaaaaaa-0000-0000-0000-000000000002',
              car: { make: 'BMW', colour: '  ' },
            }),
            earning({
              sightingId: 'aaaaaaaa-0000-0000-0000-000000000003',
              car: { make: '', colour: '' },
            }),
          ],
          { paidPence: 0, pendingPence: 90000 },
        )}
      />,
    );

    expect(getByText('Blue Ford')).toBeTruthy();
    expect(getByText('BMW')).toBeTruthy();
    expect(getByText('A car you reported')).toBeTruthy();
  });

  it('reads each row as one sentence: car, amount, and where it is', async () => {
    const id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    const { getByTestId } = await render(
      <EarningsList
        now={NOW}
        earnings={list([earning({ sightingId: id, state: 'being_checked' })], {
          paidPence: 0,
          pendingPence: 30000,
        })}
      />,
    );

    const label = getByTestId(`earning-${id}`).props.accessibilityLabel as string;
    expect(label).toBe('Blue Ford, £300. Being checked — nothing you need to do.');
    expect(label).not.toContain('..');
  });

  it('renders the totals line when there is money, and none when there is not', async () => {
    const withMoney = await render(
      <EarningsList
        now={NOW}
        earnings={list([earning()], { paidPence: 0, pendingPence: 30000 })}
      />,
    );
    expect(withMoney.getByText('£300 not paid yet')).toBeTruthy();
    await withMoney.unmount();

    const without = await render(
      <EarningsList now={NOW} earnings={list([], { paidPence: 0, pendingPence: 0 })} />,
    );
    expect(without.getByText('Your rewards')).toBeTruthy();
    expect(without.queryByText(/paid/)).toBeNull();
    await without.unmount();
  });
});
