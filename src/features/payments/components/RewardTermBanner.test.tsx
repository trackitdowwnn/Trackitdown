/**
 * WHAT:  Tests for RewardTermBanner's four states — quiet (the date, one line),
 *        renew window (card, refund FIGURE, Renew), blocked (held while a claim
 *        is open, no button), ended (no "ends on" for a past date) — and that
 *        it renders nothing without a reward, a term, or a successful read.
 * WHY:   ADR-0020: the listing banner is the DOOR to renewing, and every
 *        sentence in it is about money. Two earlier drafts said things that
 *        were false (a past "ends on"; "refunded" while a dispute held it).
 * LINKS: src/features/payments/components/RewardTermBanner.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { estimateRefundPence, formatPounds } from '@/shared/lib/money';

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

// useFocusEffect as a plain mount effect: focus is not what is under test.
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
    const { useEffect: mockUseEffect } = require('react');
    // Run once, as a single focus would.
    mockUseEffect(effect, []);
  },
}));

const mockFetch = jest.fn();
jest.mock('../api/rewardChangeApi', () => ({
  fetchMyRewardStatus: (...a: unknown[]) => mockFetch(...a),
}));

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

const status = (over: Partial<RewardStatus> = {}): RewardStatus => ({
  mode: 'change',
  rewardId: 'r1',
  amountPence: 20000,
  capturedAt: '2026-10-01T10:00:00Z',
  termEndsAt: inDays(40),
  legacyTerm: false,
  feeAbsorbed: false,
  hasRecentSightings: false,
  blockedMessage: null,
  ...over,
});

const mount = async (onRenew = jest.fn()) => {
  const view = await render(<RewardTermBanner postId="p1" onRenew={onRenew} />);
  await act(async () => {});
  return { view, onRenew };
};

beforeEach(() => jest.clearAllMocks());

describe('RewardTermBanner', () => {
  it('QUIET outside the last 14 days: one line with the date, no card, no button', async () => {
    mockFetch.mockResolvedValue(status());
    const { view } = await mount();
    expect(view.getByTestId('reward-term-quiet')).toBeTruthy();
    expect(view.getByText(/^Your £200 reward runs until /)).toBeTruthy();
    expect(view.queryByTestId('reward-term-banner')).toBeNull();
    expect(view.queryByText('Renew reward')).toBeNull();
  });

  it('RENEW WINDOW: "ends on", the refund FIGURE if they don’t, the listing stays up, and Renew', async () => {
    mockFetch.mockResolvedValue(status({ termEndsAt: inDays(9) }));
    const { view, onRenew } = await mount();
    expect(view.getByText(/^Your £200 reward ends on /)).toBeTruthy();
    expect(
      view.getByText(
        new RegExp(
          `about ${formatPounds(estimateRefundPence(20000)).replace('.', '\\.')} comes back to your card, and your listing stays up`,
        ),
      ),
    ).toBeTruthy();
    await fireEvent.press(view.getByText('Renew reward'));
    expect(onRenew).toHaveBeenCalled();
  });

  it('a reward from before the term says its end-of-term refund is the full amount', async () => {
    mockFetch.mockResolvedValue(status({ legacyTerm: true, termEndsAt: inDays(3) }));
    const { view } = await mount();
    expect(view.getByText(/the full £200 comes back to your card/)).toBeTruthy();
  });

  it('BLOCKED: held while a recovery or dispute is open — never "refunded", no Renew', async () => {
    mockFetch.mockResolvedValue(status({ termEndsAt: inDays(5), blockedMessage: 'Your reward can’t change…' }));
    const { view } = await mount();
    expect(view.getByText(/stays held while the recovery or dispute on your listing is sorted out/)).toBeTruthy();
    expect(view.queryByText(/comes back to your card/)).toBeNull();
    expect(view.queryByText('Renew reward')).toBeNull();
  });

  it('ENDED: no "ends on" for a date that has passed, and no Renew', async () => {
    mockFetch.mockResolvedValue(status({ termEndsAt: inDays(-1) }));
    const { view } = await mount();
    expect(view.getByText(/^Your £200 reward ended on /)).toBeTruthy();
    expect(view.queryByText(/ends on/)).toBeNull();
    expect(view.queryByText('Renew reward')).toBeNull();
  });

  it.each([
    ['no reward', { amountPence: null, rewardId: null, mode: 'add' as const }],
    ['no term yet', { termEndsAt: null }],
  ])('renders nothing with %s', async (_label, over) => {
    mockFetch.mockResolvedValue(status(over));
    const { view } = await mount();
    expect(view.queryByTestId('reward-term-banner')).toBeNull();
    expect(view.queryByTestId('reward-term-quiet')).toBeNull();
  });

  it('renders nothing when the read fails — never a guessed date', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { view } = await mount();
    expect(view.queryByTestId('reward-term-banner')).toBeNull();
    expect(view.queryByTestId('reward-term-quiet')).toBeNull();
  });
});
