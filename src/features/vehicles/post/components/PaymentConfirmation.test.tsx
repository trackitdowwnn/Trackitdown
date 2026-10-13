/**
 * WHAT:  Tests for PaymentConfirmation — paid → held → live, watched until the
 *        listing really is live.
 * WHY:   The screen's one promise is that it says "live" only when the server
 *        has made it so, and never leaves an owner waiting with no way out. A
 *        claim of success it can't see, or a spinner that never ends, would
 *        both fail someone who has just paid after a theft.
 * LINKS: ./PaymentConfirmation.tsx; ../screens/PostACarScreen.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { CONFIRM_ATTEMPTS, CONFIRM_INTERVAL_MS, PaymentConfirmation } from './PaymentConfirmation';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockStatus = jest.fn();
jest.mock('../api/postApi', () => ({
  fetchMyPostStatus: (...args: unknown[]) => mockStatus(...args),
}));

type View = Awaited<ReturnType<typeof render>>;

/** One look: the wait, then the read. */
const tick = async () => {
  await act(async () => {
    jest.advanceTimersByTime(CONFIRM_INTERVAL_MS);
  });
};

const renderIt = (props: Partial<Parameters<typeof PaymentConfirmation>[0]> = {}) =>
  render(
    <PaymentConfirmation
      postId="p1"
      mode="reward"
      amountPence={50000}
      onViewListing={jest.fn()}
      {...props}
    />,
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockStatus.mockReset().mockResolvedValue('draft');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PaymentConfirmation', () => {
  it('says the payment was received and the reward is being confirmed — not yet "live"', async () => {
    const view = await renderIt();
    expect(view.getByText('Payment received')).toBeTruthy();
    expect(view.getByTestId('payment-steps-done-paid')).toBeTruthy();
    expect(view.getByTestId('payment-steps-current-held')).toBeTruthy();
    expect(view.getByTestId('payment-steps-upcoming-live')).toBeTruthy();
    expect(view.getByText('£500 payment taken')).toBeTruthy();
  });

  it('⚠️ says "live" only once the server has made it so', async () => {
    mockStatus.mockResolvedValueOnce('draft').mockResolvedValue('active');
    const view = await renderIt();

    await tick();
    expect(view.queryByText('Your car is live')).toBeNull();

    await tick();
    expect(mockStatus).toHaveBeenCalledWith('p1');
    expect(view.getByText('Your car is live')).toBeTruthy();
    expect(view.getByTestId('payment-steps-done-held')).toBeTruthy();
    expect(view.getByTestId('payment-steps-done-live')).toBeTruthy();
  });

  it('⚠️ slower than the watch: says so plainly, and never claims success', async () => {
    const view = await renderIt();
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
      await tick();
    }

    expect(view.getByTestId('payment-confirmation-slow')).toBeTruthy();
    expect(view.getByText(/still confirming it/)).toBeTruthy();
    expect(view.queryByText('Your car is live')).toBeNull();
    expect(mockStatus).toHaveBeenCalledTimes(CONFIRM_ATTEMPTS);
  });

  it('a failed read is a blip — it keeps watching', async () => {
    mockStatus.mockResolvedValueOnce(null).mockResolvedValue('active');
    const view = await renderIt();
    await tick();
    await tick();
    expect(view.getByText('Your car is live')).toBeTruthy();
  });

  it('a £5 listing has no escrow step: payment taken → listing live', async () => {
    const view = await renderIt({ mode: 'fee', amountPence: 500 });
    expect(view.getByText('£5 payment taken')).toBeTruthy();
    expect(view.queryByText('Reward held securely')).toBeNull();
    expect(view.getByTestId('payment-steps-current-live')).toBeTruthy();
  });

  it('never a trap: "View your listing" works from the first frame', async () => {
    const onViewListing = jest.fn();
    const view: View = await renderIt({ onViewListing });
    await act(async () => {
      fireEvent.press(view.getByText('View your listing'));
    });
    expect(onViewListing).toHaveBeenCalledTimes(1);
  });

  it('names no payment provider (owner, 2026-10-13)', async () => {
    mockStatus.mockResolvedValue('active');
    const view = await renderIt();
    expect(view.queryAllByText(/Stripe/)).toEqual([]);
    await tick();
    expect(view.queryAllByText(/Stripe/)).toEqual([]);
  });

  it('stops watching once it has gone', async () => {
    const view = await renderIt();
    await act(async () => {
      view.unmount();
    });
    await tick();
    expect(mockStatus).not.toHaveBeenCalled();
  });
});
