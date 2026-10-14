/**
 * WHAT:  Tests for PaymentConfirmation — the reward (or fee) done, the listing
 *        going live, watched until it really is live.
 * WHY:   The screen's one promise is that it says "live" only when the server
 *        has made it so, and never leaves an owner waiting with no way out. A
 *        claim of success it can't see, or a spinner that never ends, would
 *        both fail someone who has just paid after a theft.
 * LINKS: ./PaymentConfirmation.tsx; ../screens/PostACarScreen.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import {
  CONFIRM_ATTEMPTS,
  CONFIRM_INTERVAL_MS,
  PaymentConfirmation,
  SYNC_BEFORE_ATTEMPTS,
} from './PaymentConfirmation';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockStatus = jest.fn();
jest.mock('../api/postApi', () => ({
  fetchMyPostStatus: (...args: unknown[]) => mockStatus(...args),
}));

const mockLightHaptic = jest.fn();
jest.mock('@/shared/lib/haptics', () => ({
  lightHaptic: () => mockLightHaptic(),
}));

// The server's check with Stripe (sync-post-payment, 2026-10-14).
const mockSync = jest.fn();
jest.mock('@/features/payments', () => ({
  syncPostPayment: (...args: unknown[]) => mockSync(...args),
}));

type View = Awaited<ReturnType<typeof render>>;

/** Let the first, immediate look settle. */
const settle = async () => {
  await act(async () => {});
};

/** One more look: the wait, then the read. */
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
      onClose={jest.fn()}
      {...props}
    />,
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockStatus.mockReset().mockResolvedValue('draft');
  mockLightHaptic.mockReset();
  mockSync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PaymentConfirmation', () => {
  it('two steps: the reward is done, the listing is going live — not yet "live"', async () => {
    const view = await renderIt();
    await settle();
    expect(view.getByText('Payment received')).toBeTruthy();
    expect(view.getByText('Your £500 reward')).toBeTruthy();
    expect(view.getByTestId('payment-steps-done-reward')).toBeTruthy();
    expect(view.getByTestId('payment-steps-current-listing')).toBeTruthy();
    expect(view.queryByText('Your car is live')).toBeNull();
  });

  it('the reward line repeats the review screen’s facts: the term and the refund less the card fee', async () => {
    const view = await renderIt();
    // £500 → £492.30 back (1.5% + 20p kept), as refundPence and the review say.
    expect(view.getByText(/If none does in 60 days, £492\.30 goes back to your card/)).toBeTruthy();
  });

  it('⚠️ looks at once — a listing already live is "live" with no pause', async () => {
    mockStatus.mockResolvedValue('active');
    const view = await renderIt();
    await settle();
    expect(view.getByText('Your car is live')).toBeTruthy();
    expect(view.getByTestId('payment-steps-done-listing')).toBeTruthy();
    expect(mockLightHaptic).toHaveBeenCalledTimes(1);
  });

  it('⚠️ says "live" only once the server has made it so', async () => {
    mockStatus.mockResolvedValueOnce('draft').mockResolvedValue('active');
    const view = await renderIt();
    await settle();
    expect(view.queryByText('Your car is live')).toBeNull();

    await tick();
    expect(mockStatus).toHaveBeenCalledWith('p1');
    expect(view.getByText('Your car is live')).toBeTruthy();
  });

  it('⚠️ asks the server to check with Stripe — mid-way and before saying "slow" (2026-10-14)', async () => {
    const view = await renderIt();
    await settle();
    for (let attempt = 1; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
      await tick();
    }
    // Before look 4 and before the last: the webhook is no longer the only way in.
    expect(mockSync).toHaveBeenCalledTimes(SYNC_BEFORE_ATTEMPTS.length);
    expect(mockSync).toHaveBeenCalledWith('p1');
    expect(view.getByTestId('payment-confirmation-slow')).toBeTruthy();
  });

  it('a listing live at once never needs the check', async () => {
    mockStatus.mockResolvedValue('active');
    await renderIt();
    await settle();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('⚠️ slower than the watch: says so plainly, never claims success, and the way on leads', async () => {
    const view = await renderIt();
    await settle();
    for (let attempt = 1; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
      await tick();
    }

    expect(view.getByTestId('payment-confirmation-slow')).toBeTruthy();
    expect(view.getByText(/^This is taking longer than usual\. Your listing goes live by itself/)).toBeTruthy();
    expect(view.getByText('Taking longer than usual — it goes live by itself.')).toBeTruthy();
    expect(view.queryByText('Your car is live')).toBeNull();
    expect(view.queryByText(/usually a few seconds/)).toBeNull();
    expect(mockStatus).toHaveBeenCalledTimes(CONFIRM_ATTEMPTS);
  });

  it('a failed read is a blip — it keeps watching', async () => {
    mockStatus.mockResolvedValueOnce(null).mockResolvedValue('active');
    const view = await renderIt();
    await settle();
    await tick();
    expect(view.getByText('Your car is live')).toBeTruthy();
  });

  it('a £5 listing: the fee, then the listing — no reward line', async () => {
    const view = await renderIt({ mode: 'fee', amountPence: 500 });
    await settle();
    expect(view.getByText('Your £5 listing fee')).toBeTruthy();
    expect(view.queryByText(/reward/)).toBeNull();
    expect(view.getByTestId('payment-steps-current-listing')).toBeTruthy();
  });

  it('never a trap: "View your listing" and the ✕ work from the first frame', async () => {
    const onViewListing = jest.fn();
    const onClose = jest.fn();
    const view: View = await renderIt({ onViewListing, onClose });
    await act(async () => {
      fireEvent.press(view.getByText('View your listing'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('payment-confirmation-close'));
    });
    expect(onViewListing).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names no payment provider (owner, 2026-10-13)', async () => {
    mockStatus.mockResolvedValue('active');
    const view = await renderIt();
    expect(view.queryAllByText(/Stripe/)).toEqual([]);
    await settle();
    expect(view.queryAllByText(/Stripe/)).toEqual([]);
  });

  it('stops watching once it has gone', async () => {
    const view = await renderIt();
    await settle();
    expect(mockStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      view.unmount();
    });
    await tick();
    expect(mockStatus).toHaveBeenCalledTimes(1);
  });
});
