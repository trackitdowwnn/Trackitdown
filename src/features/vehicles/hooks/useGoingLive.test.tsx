/**
 * WHAT:  Tests for useGoingLive — the just-paid listing's watch: fast looks,
 *        Stripe asked before "slow", "Going live soon" after ~12s with the
 *        quiet looks carrying on, live → haptic + one announcement + reload,
 *        and nothing at all when not watching.
 * WHY:   It replaced the payment confirmation page (owner, 2026-10-22), whose
 *        sync was the only thing that made a real paid listing live on the
 *        day the webhook secret was wrong. Pinned so it can't quietly go.
 * LINKS: ./useGoingLive.ts; docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import {
  CONFIRM_ATTEMPTS,
  CONFIRM_INTERVAL_MS,
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

/** Let the hook's awaited calls settle, then move the clock. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

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
  it('does nothing at all when not watching', async () => {
    const { result } = await renderHook(() =>
      useGoingLive('p1', { watching: false, onLive: jest.fn() }),
    );
    await advance(CONFIRM_INTERVAL_MS * CONFIRM_ATTEMPTS);
    expect(result.current).toBeNull();
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('says "confirming", and once live: one haptic, one announcement, a reload', async () => {
    const onLive = jest.fn();
    mockStatus.mockResolvedValueOnce('draft').mockResolvedValueOnce('active');
    const { result } = await renderHook(() => useGoingLive('p1', { watching: true, onLive }));
    expect(result.current).toBe('confirming');

    await advance(CONFIRM_INTERVAL_MS);
    expect(onLive).toHaveBeenCalledTimes(1);
    expect(mockHaptic).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('Your car is live.', { queue: true });
    // Stops looking once live.
    const looks = mockStatus.mock.calls.length;
    await advance(SLOW_INTERVAL_MS * 3);
    expect(mockStatus.mock.calls.length).toBe(looks);
  });

  it('⚠️ asks Stripe before saying "slow", then says "Going live soon" and keeps looking', async () => {
    const onLive = jest.fn();
    const { result } = await renderHook(() => useGoingLive('p1', { watching: true, onLive }));

    // The fast looks: Stripe asked twice (before look 3 and the last).
    await advance(CONFIRM_INTERVAL_MS * (CONFIRM_ATTEMPTS - 1));
    expect(mockSync).toHaveBeenCalledTimes(2);
    expect(mockSync).toHaveBeenCalledWith('p1');
    expect(result.current).toBe('confirming');

    // Past ~12s: slow, said once, and Stripe asked again.
    await advance(SLOW_INTERVAL_MS);
    expect(result.current).toBe('slow');
    expect(announce).toHaveBeenCalledWith('Going live soon. It goes live by itself.', {
      queue: true,
    });
    expect(mockSync).toHaveBeenCalledTimes(3);

    // It goes live later, by itself.
    mockStatus.mockResolvedValue('active');
    await advance(SLOW_INTERVAL_MS);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it('stops when it is no longer watching (the listing reloaded as live)', async () => {
    const { rerender } = await renderHook(
      ({ watching }: { watching: boolean }) => useGoingLive('p1', { watching, onLive: jest.fn() }),
      { initialProps: { watching: true } },
    );
    await rerender({ watching: false });
    const looks = mockStatus.mock.calls.length;
    await advance(CONFIRM_INTERVAL_MS * CONFIRM_ATTEMPTS);
    expect(mockStatus.mock.calls.length).toBe(looks);
  });
});
