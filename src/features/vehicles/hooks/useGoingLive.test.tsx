/**
 * WHAT:  Tests for useGoingLive — the just-paid listing's watch: only over a
 *        loaded draft, Stripe asked before looks 3 and 7, "Going live soon"
 *        after ~12s with the quiet looks carrying on to the 10-minute cap,
 *        live → haptic + one announcement + reload, "live" said when the
 *        first load already is, never restarting over a later status, and
 *        stopping on unmount.
 * WHY:   It replaced the payment confirmation page (owner, 2026-10-22), whose
 *        sync was the only thing that made a real paid listing live on the
 *        day the webhook secret was wrong. Pinned so it can't quietly go.
 * LINKS: ./useGoingLive.ts; docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { PostStatus } from '@/shared/types';

import {
  CONFIRM_ATTEMPTS,
  CONFIRM_INTERVAL_MS,
  SLOW_ATTEMPTS,
  SLOW_INTERVAL_MS,
  useGoingLive,
} from './useGoingLive';

const mockSync = jest.fn();
jest.mock('@/features/payments', () => ({
  syncPostPayment: (...args: unknown[]) => mockSync(...args),
}));
const mockStatus = jest.fn();
jest.mock('../post/api/postApi', () => ({
  fetchMyPostStatus: (...args: unknown[]) => mockStatus(...args),
}));
const mockHaptic = jest.fn();
jest.mock('@/shared/lib/haptics', () => ({ lightHaptic: () => mockHaptic() }));

const announce = jest
  .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
  .mockImplementation(() => undefined);
const said = (message: string) => announce.mock.calls.filter(([text]) => text === message).length;

/** Let the hook's awaited calls settle, then move the clock. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

type Props = { justPaid: boolean; status: PostStatus | null; onLive: () => void };
const watch = (initialProps: Props) =>
  renderHook((props: Props) => useGoingLive('p1', props), { initialProps });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSync.mockResolvedValue(undefined);
  mockStatus.mockResolvedValue('draft');
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useGoingLive', () => {
  it('does nothing without ?paid=1, and nothing before the listing has loaded', async () => {
    const unpaid = await watch({ justPaid: false, status: 'draft', onLive: jest.fn() });
    const loading = await watch({ justPaid: true, status: null, onLive: jest.fn() });
    await advance(CONFIRM_INTERVAL_MS * CONFIRM_ATTEMPTS);
    expect(unpaid.result.current).toBeNull();
    expect(loading.result.current).toBeNull();
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('says "confirming", and once live: one haptic, one announcement, a reload — then stops', async () => {
    const onLive = jest.fn();
    mockStatus.mockResolvedValueOnce('draft').mockResolvedValueOnce('active');
    const { result } = await watch({ justPaid: true, status: 'draft', onLive });
    expect(result.current).toBe('confirming');
    expect(said('Payment received. Your car is going live.')).toBe(1);

    await advance(CONFIRM_INTERVAL_MS);
    expect(onLive).toHaveBeenCalledTimes(1);
    expect(mockHaptic).toHaveBeenCalledTimes(1);
    expect(said('Your car is live.')).toBe(1);
    const looks = mockStatus.mock.calls.length;
    await advance(SLOW_INTERVAL_MS * 3);
    expect(mockStatus.mock.calls.length).toBe(looks);
  });

  it('⚠️ asks Stripe before look 3 and look 7 exactly, then says "Going live soon" and keeps looking', async () => {
    const onLive = jest.fn();
    const { result } = await watch({ justPaid: true, status: 'draft', onLive });

    await advance(CONFIRM_INTERVAL_MS * 2);
    expect(mockSync).toHaveBeenCalledTimes(0);
    await advance(CONFIRM_INTERVAL_MS);
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith('p1');
    await advance(CONFIRM_INTERVAL_MS * 4);
    expect(mockSync).toHaveBeenCalledTimes(2);
    expect(result.current).toBe('confirming');

    // Past ~12s: slow, said once, and Stripe asked again.
    await advance(SLOW_INTERVAL_MS);
    expect(result.current).toBe('slow');
    expect(said('Going live soon.')).toBe(1);
    expect(mockSync).toHaveBeenCalledTimes(3);

    // It goes live later, by itself.
    mockStatus.mockResolvedValue('active');
    await advance(SLOW_INTERVAL_MS);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it('stops at the ten-minute cap', async () => {
    await watch({ justPaid: true, status: 'draft', onLive: jest.fn() });
    await advance(CONFIRM_INTERVAL_MS * CONFIRM_ATTEMPTS + SLOW_INTERVAL_MS * SLOW_ATTEMPTS);
    expect(mockStatus).toHaveBeenCalledTimes(CONFIRM_ATTEMPTS + SLOW_ATTEMPTS);
    await advance(SLOW_INTERVAL_MS * 5);
    expect(mockStatus).toHaveBeenCalledTimes(CONFIRM_ATTEMPTS + SLOW_ATTEMPTS);
  });

  it('stops on unmount', async () => {
    const { unmount } = await watch({ justPaid: true, status: 'draft', onLive: jest.fn() });
    await unmount();
    const looks = mockStatus.mock.calls.length;
    await advance(CONFIRM_INTERVAL_MS * CONFIRM_ATTEMPTS);
    expect(mockStatus.mock.calls.length).toBe(looks);
  });

  it('says "live" when the first load already is (the webhook beat the page)', async () => {
    const { result } = await watch({ justPaid: true, status: 'active', onLive: jest.fn() });
    expect(result.current).toBeNull();
    expect(said('Your car is live.')).toBe(1);
    expect(said('Payment received. Your car is going live.')).toBe(0);
    expect(mockHaptic).toHaveBeenCalledTimes(1);
  });

  it('⚠️ never comes back over a later status (cancelled after going live)', async () => {
    const onLive = jest.fn();
    const hook = await watch({ justPaid: true, status: 'draft', onLive });
    await hook.rerender({ justPaid: true, status: 'active', onLive });
    await hook.rerender({ justPaid: true, status: 'cancelled', onLive });
    expect(hook.result.current).toBeNull();
    const looks = mockStatus.mock.calls.length;
    await advance(CONFIRM_INTERVAL_MS * CONFIRM_ATTEMPTS);
    expect(mockStatus.mock.calls.length).toBe(looks);
    // "Payment received" said once for the visit, never again.
    expect(said('Payment received. Your car is going live.')).toBe(1);
  });
});
