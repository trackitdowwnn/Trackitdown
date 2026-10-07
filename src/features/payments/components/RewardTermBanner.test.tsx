/**
 * WHAT:  Tests for RewardTermBanner's card states — renew window (refund
 *        FIGURE, Renew), blocked (held while a claim is open, no button),
 *        ending (no "ends on" for a past date), returned (what came back and
 *        when, Add a reward) — and that it draws NOTHING in the quiet states,
 *        which the listing says as a stat-band line instead.
 * WHY:   ADR-0020: the listing banner is the DOOR to renewing, and every
 *        sentence in it is about money. Two earlier drafts said things that
 *        were false (a past "ends on"; "refunded" while a dispute held it).
 * LINKS: src/features/payments/components/RewardTermBanner.tsx;
 *        src/features/payments/lib/rewardTerm.ts (the phases).
 */

import { fireEvent, render } from '@testing-library/react-native';

import { refundPence, formatPounds } from '@/shared/lib/money';

import type { RewardStatus } from '../api/rewardChangeApi';
import { RewardTermBanner } from './RewardTermBanner';

jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

const NOW = Date.parse('2026-10-06T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(NOW + d * DAY).toISOString();

const status = (over: Partial<RewardStatus> = {}): RewardStatus => ({
  postStatus: 'active',
  mode: 'change',
  rewardId: 'r1',
  amountPence: 20000,
  capturedAt: '2026-10-01T10:00:00Z',
  termEndsAt: inDays(40),
  legacyTerm: false,
  rewardEndedAt: null,
  endedRewardPence: null,
  hasListingFee: null,
  feeAbsorbed: false,
  hasRecentSightings: false,
  blockedMessage: null,
  ...over,
});

const ended = (over: Partial<RewardStatus> = {}) =>
  status({
    mode: 'add',
    rewardId: null,
    amountPence: null,
    capturedAt: null,
    termEndsAt: null,
    rewardEndedAt: inDays(-2),
    endedRewardPence: 20000,
    ...over,
  });

const mount = async (value: RewardStatus | null) => {
  const onRenew = jest.fn();
  const onAddReward = jest.fn();
  const view = await render(
    <RewardTermBanner status={value} readAt={NOW} onRenew={onRenew} onAddReward={onAddReward} />,
  );
  return { view, onRenew, onAddReward };
};

describe('RewardTermBanner', () => {
  it('RENEW WINDOW: "ends on", the refund FIGURE if they don’t, the listing stays up, and Renew', async () => {
    const { view, onRenew } = await mount(status({ termEndsAt: inDays(9) }));
    expect(view.getByText(/^Your £200 reward ends on /)).toBeTruthy();
    expect(
      view.getByText(
        new RegExp(
          // Exact (ADR-0021) — never "about".
          `If you don’t, ${formatPounds(refundPence(20000)).replace('.', '\\.')} comes back to your card, and your listing stays up`,
        ),
      ),
    ).toBeTruthy();
    await fireEvent.press(view.getByText('Renew reward'));
    expect(onRenew).toHaveBeenCalled();
  });

  it('a reward from before the term says its end-of-term refund is the full amount', async () => {
    const { view } = await mount(status({ legacyTerm: true, termEndsAt: inDays(3) }));
    expect(view.getByText(/the full £200 comes back to your card/)).toBeTruthy();
  });

  it('BLOCKED: held while a recovery or dispute is open — never "refunded", no Renew', async () => {
    const { view } = await mount(status({ termEndsAt: inDays(5), blockedMessage: 'Your reward can’t change…' }));
    expect(view.getByText(/stays held while the recovery or dispute on your listing is sorted out/)).toBeTruthy();
    expect(view.queryByText(/comes back to your card/)).toBeNull();
    expect(view.queryByText('Renew reward')).toBeNull();
  });

  // 20261007120000: a term is stored as the midnight AFTER its last day. This
  // one ends at 00:00 BST on Friday 16 October, so the owner has all of
  // Thursday 15th — and is told so, not "Friday 16 October".
  it('names the LAST DAY of a term stored as the following midnight', async () => {
    const { view } = await mount(status({ termEndsAt: '2026-10-15T23:00:00Z' }));
    expect(view.getByText('Your £200 reward ends on Thursday 15 October')).toBeTruthy();
    expect(view.queryByText(/16 October/)).toBeNull();
  });

  it('ENDING: no "ends on" for a date that has passed, and no Renew', async () => {
    const { view } = await mount(status({ termEndsAt: inDays(-1) }));
    expect(view.getByText(/^Your £200 reward ended on /)).toBeTruthy();
    expect(view.queryByText(/ends on/)).toBeNull();
    expect(view.queryByText('Renew reward')).toBeNull();
  });

  it('RETURNED: what came back and when, the listing is still up, and Add a reward', async () => {
    const { view, onAddReward } = await mount(ended());
    expect(view.getByText('Your £200 reward has ended')).toBeTruthy();
    expect(view.getByText(/^The refund went to your card on .+\. Your listing is still up/)).toBeTruthy();
    // Never a refunded FIGURE: the card fee may have been kept.
    expect(view.queryByText(/refunded £|£200 (came|comes) back/)).toBeNull();
    // Never the fee-listing sentence: this owner paid a reward, not a fee.
    expect(view.queryByText(/listing fee/)).toBeNull();
    await fireEvent.press(view.getByText('Add a reward'));
    expect(onAddReward).toHaveBeenCalled();
  });

  it.each([
    ['the quiet stretch (more than 14 days left)', status()],
    ['a reward that went back long ago', ended({ rewardEndedAt: inDays(-30) })],
    ['no reward (a fee listing)', status({ amountPence: null, rewardId: null, mode: 'add', termEndsAt: null })],
    ['no term yet', status({ termEndsAt: null })],
    ['no read yet', null],
  ])('draws nothing for %s', async (_label, value) => {
    const { view } = await mount(value);
    expect(view.queryByTestId('reward-term-banner')).toBeNull();
  });
});
