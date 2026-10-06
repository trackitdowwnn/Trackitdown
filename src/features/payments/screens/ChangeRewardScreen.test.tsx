/**
 * WHAT:  Tests for ChangeRewardScreen — the disclosure in both modes (what is
 *        charged, what comes back from the old reward, the £5 fee kept — or,
 *        after a reward ended (ADR-0020), no fee row and a lede that says so), the
 *        lowering floor after recent sightings, a blocked listing, the pay
 *        flow's order (amount first, then a charge carrying no amount, then
 *        the sheet), the poll that only claims success once the reward moved,
 *        and the cancel / fail / refusal outcomes.
 * WHY:   This screen is the ONLY place an owner learns what changing a live
 *        reward does to their money before they pay. Its figures must come
 *        from estimateRefundPence (the one refund estimate), and it must never
 *        say "your reward is now £X" before the server agrees.
 * LINKS: src/features/payments/screens/ChangeRewardScreen.tsx;
 *        src/features/payments/api/rewardChangeApi.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { PaymentError } from '@/shared/lib/functionError';
import { estimateRefundPence, formatPounds } from '@/shared/lib/money';

import type { RewardStatus } from '../api/rewardChangeApi';
import { ChangeRewardScreen } from './ChangeRewardScreen';

// --- mocks -------------------------------------------------------------------

const mockToast = jest.fn();
let mockSliderProps: { minPence: number; onChangePence: (p: number) => void; footnote?: string } | null =
  null;
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable, Text, View } = require('react-native');
  return {
    useToast: () => ({ show: (...args: unknown[]) => mockToast(...args) }),
    Screen: ({ children }: { children: unknown }) => <View>{children}</View>,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled }} onPress={disabled ? undefined : onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
    MoneySlider: (props: { minPence: number; onChangePence: (p: number) => void; footnote?: string }) => {
      mockSliderProps = props;
      return props.footnote ? <Text>{props.footnote}</Text> : null;
    },
    FullscreenLoader: () => <Text>loading</Text>,
    ErrorState: ({ body, onRetry }: { body?: string; onRetry: () => void }) => (
      <Pressable onPress={onRetry}>
        <Text>{body}</Text>
      </Pressable>
    ),
    defaultBountyPanelCopy: { splitLine: () => '', escrowLine: () => '' },
  };
});

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));

const mockFetchStatus = jest.fn();
const mockSetAmount = jest.fn();
const mockCreateIntent = jest.fn();
jest.mock('../api/rewardChangeApi', () => ({
  LOWERING_RULE_SENTENCE: 'You’ve had recent sightings, so you can raise your reward but not lower it.',
  fetchMyRewardStatus: (...a: unknown[]) => mockFetchStatus(...a),
  setRewardRenewalAmount: (...a: unknown[]) => mockSetAmount(...a),
  createRewardChangeIntent: (...a: unknown[]) => mockCreateIntent(...a),
}));

const mockPay = jest.fn();
jest.mock('../hooks/useBountyPayment', () => ({
  useBountyPayment: () => ({ payBounty: (...a: unknown[]) => mockPay(...a) }),
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

// --- fixtures ----------------------------------------------------------------

const status = (over: Partial<RewardStatus> = {}): RewardStatus => ({
  mode: 'change',
  postStatus: 'active',
  rewardId: 'r1',
  amountPence: 20000,
  capturedAt: '2026-10-01T10:00:00Z',
  termEndsAt: '2026-11-30T10:00:00Z',
  legacyTerm: false,
  rewardEndedAt: null,
  endedRewardPence: null,
  feeAbsorbed: false,
  hasRecentSightings: false,
  blockedMessage: null,
  ...over,
});

const noWait = () => Promise.resolve();
const flush = () => act(async () => {});

const mount = async () => {
  const view = await render(<ChangeRewardScreen postId="p1" wait={noWait} />);
  await flush();
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSliderProps = null;
  mockSetAmount.mockResolvedValue(undefined);
  mockCreateIntent.mockResolvedValue('pi_secret');
  mockPay.mockResolvedValue({ outcome: 'paid', message: null });
});

// --- tests -------------------------------------------------------------------

describe('ChangeRewardScreen', () => {
  it('summarises the money in full: charged now, back to your card (estimate) and when, and the card fee kept', async () => {
    mockFetchStatus.mockResolvedValue(status());
    const view = await mount();
    await act(async () => mockSliderProps?.onChangePence(35000));

    const back = estimateRefundPence(20000);
    expect(view.getByText('Renew or change your reward')).toBeTruthy();
    expect(view.getByText('Charged now')).toBeTruthy();
    expect(view.getByText('£350')).toBeTruthy();
    expect(view.getByText(`About ${formatPounds(back)}, in 5–10 working days`)).toBeTruthy();
    expect(view.getByText(`About ${formatPounds(20000 - back)}`)).toBeTruthy();
    expect(view.getByText('Pay £350')).toBeTruthy();
  });

  it('says "in full" and keeps no fee when the current reward’s refund absorbs it', async () => {
    mockFetchStatus.mockResolvedValue(status({ feeAbsorbed: true }));
    const view = await mount();
    await act(async () => mockSliderProps?.onChangePence(35000));
    expect(view.getByText('£200, in full, in 5–10 working days')).toBeTruthy();
    expect(view.queryByText('Card fee kept')).toBeNull();
  });

  it('adding a reward to a fee listing says the £5 fee is kept', async () => {
    mockFetchStatus.mockResolvedValue(status({ mode: 'add', rewardId: null, amountPence: null }));
    const view = await mount();
    expect(view.getByText('Add a reward')).toBeTruthy();
    expect(view.getByText(/^Offer a reward to whoever finds your car\./)).toBeTruthy();
    expect(view.queryByText(/Your previous reward ended/)).toBeNull();
    expect(view.getByText('Your £5 listing fee')).toBeTruthy();
    expect(view.getByText('Not refunded — it paid for the listing')).toBeTruthy();
  });

  // ADR-0020: the owner is adding a reward AGAIN after one ran its term and
  // was refunded. That listing was a reward listing — it may never have paid
  // a £5 fee, so the fee row would describe money that doesn't exist.
  it('adding a reward after one ended says so, and shows no listing-fee row', async () => {
    mockFetchStatus.mockResolvedValue(
      status({
        mode: 'add',
        rewardId: null,
        amountPence: null,
        termEndsAt: null,
        rewardEndedAt: '2026-10-01T03:00:00Z',
        endedRewardPence: 20000,
      }),
    );
    const view = await mount();
    expect(view.getByText('Add a reward')).toBeTruthy();
    expect(view.getByText(/^Your previous reward ended and went back to your card\./)).toBeTruthy();
    expect(view.queryByText('Your £5 listing fee')).toBeNull();
    expect(view.queryByText(/listing fee/)).toBeNull();
    expect(view.queryByText('Not refunded — it paid for the listing')).toBeNull();
    // The rest of the disclosure is unchanged: what is charged now.
    expect(view.getByText('Charged now')).toBeTruthy();
  });

  it('after recent sightings the slider cannot go below today’s reward, and the lede says why', async () => {
    mockFetchStatus.mockResolvedValue(status({ hasRecentSightings: true }));
    const view = await mount();
    expect(mockSliderProps?.minPence).toBe(20000);
    expect(view.getByText(/so you can raise your reward but not lower it/)).toBeTruthy();
  });

  it('a blocked listing shows why and offers only the way back — no checkout', async () => {
    mockFetchStatus.mockResolvedValue(status({ blockedMessage: 'Your last change is still being refunded.' }));
    const view = await mount();
    expect(view.getByTestId('change-reward-blocked')).toBeTruthy();
    expect(view.queryByText(/^Pay /)).toBeNull();
    await fireEvent.press(view.getByText('Back to your listing'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockSetAmount).not.toHaveBeenCalled();
  });

  it('keeping the amount RENEWS it — labelled as a renewal, the old reward still refunded minus the fee', async () => {
    mockFetchStatus
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ rewardId: 'r2', termEndsAt: '2027-01-29T10:00:00Z' }));
    const view = await mount();
    expect(view.getByText(/Keep the amount to renew it for 60 days from today/)).toBeTruthy();
    expect(view.getByText('Runs until')).toBeTruthy();
    // The renewal's REAL cost is named first: the card fee on the old reward.
    expect(view.getByText('Renewing costs')).toBeTruthy();
    expect(
      view.getByText(`About ${formatPounds(20000 - estimateRefundPence(20000))} — the card fee on your current reward`),
    ).toBeTruthy();
    expect(view.getByText(`About ${formatPounds(estimateRefundPence(20000))}, in 5–10 working days`)).toBeTruthy();
    await fireEvent.press(view.getByText('Renew for £200'));
    await flush();
    expect(mockSetAmount).toHaveBeenCalledWith('p1', 20000);
    expect(mockToast).toHaveBeenCalledWith('Your reward is renewed until 29 January.');
  });

  it('pays in order — amount, then a charge with no amount, then the sheet — and only claims success once the reward moved', async () => {
    mockFetchStatus
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status()) // the webhook has not landed yet
      .mockResolvedValueOnce(status({ rewardId: 'r2', amountPence: 35000 }));
    const view = await mount();
    await act(async () => mockSliderProps?.onChangePence(35000));
    await fireEvent.press(view.getByText('Pay £350'));
    await flush();

    expect(mockSetAmount).toHaveBeenCalledWith('p1', 35000);
    expect(mockCreateIntent).toHaveBeenCalledWith('p1');
    expect(mockPay).toHaveBeenCalledWith('pi_secret');
    expect(mockSetAmount.mock.invocationCallOrder[0]).toBeLessThan(mockCreateIntent.mock.invocationCallOrder[0]);
    expect(mockFetchStatus).toHaveBeenCalledTimes(3);
    expect(mockToast).toHaveBeenCalledWith('Your reward is now £350.');
    expect(mockBack).toHaveBeenCalled();
  });

  it('a cancelled sheet changes nothing and stays put', async () => {
    mockFetchStatus.mockResolvedValue(status());
    mockPay.mockResolvedValue({ outcome: 'cancelled', message: null });
    const view = await mount();
    await act(async () => mockSliderProps?.onChangePence(35000));
    await fireEvent.press(view.getByText('Pay £350'));
    await flush();
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('a server refusal shows its sentence and charges nothing', async () => {
    mockFetchStatus.mockResolvedValue(status());
    mockSetAmount.mockRejectedValue(new PaymentError('You can’t lower your reward right now.', 'REWARD_LOWER_BLOCKED'));
    const view = await mount();
    await act(async () => mockSliderProps?.onChangePence(10000));
    await fireEvent.press(view.getByText('Pay £100'));
    await flush();
    expect(view.getByTestId('change-reward-error')).toBeTruthy();
    expect(view.getByText('You can’t lower your reward right now.')).toBeTruthy();
    expect(mockCreateIntent).not.toHaveBeenCalled();
    expect(mockPay).not.toHaveBeenCalled();
  });

  it('if the reward has not moved by the end of the poll, it says the payment landed — never that the reward changed', async () => {
    mockFetchStatus.mockResolvedValue(status());
    const view = await mount();
    await act(async () => mockSliderProps?.onChangePence(35000));
    await fireEvent.press(view.getByText('Pay £350'));
    await flush();
    expect(mockToast).toHaveBeenCalledWith(
      'Payment received — we’re confirming it. Check your listing in a moment.',
    );
  });
});
