/**
 * WHAT:  Tests for usePollWhileChecking — the Payouts screen's "keep asking
 *        while it says being checked" backstop.
 * WHY:   Its whole job is timing, which no screen test exercises: ask on a
 *        rhythm while the answer is out, skip (without spending the allowance)
 *        while there is nothing to wait for, stop at the cap, and stop when the
 *        screen goes out of view. Each of those failing is either a stuck
 *        screen (the 2026-10-14 bug) or a phone polling forever.
 * LINKS: ./usePollWhileChecking.ts.
 */

import { renderHook } from '@testing-library/react-native';

import { usePollWhileChecking } from './usePollWhileChecking';

// Focus as a plain effect: mounted = in view, unmounted = left.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useEffect } = require('react');
  return {
    // Re-runs when the callback changes, as useFocusEffect does.
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(effect, [effect]);
    },
  };
});

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('usePollWhileChecking', () => {
  it('asks on every tick while the answer is still out', async () => {
    const check = jest.fn();
    await renderHook(() => usePollWhileChecking(() => true, check, { everyMs: 1000, times: 5 }));

    expect(check).not.toHaveBeenCalled(); // not on mount: the screen's own check covers that
    jest.advanceTimersByTime(3000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('⚠️ stops at the cap — a check that really takes a day is not polled all day', async () => {
    const check = jest.fn();
    await renderHook(() => usePollWhileChecking(() => true, check, { everyMs: 1000, times: 3 }));

    jest.advanceTimersByTime(60_000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('skips while there is nothing to wait for, without spending the allowance', async () => {
    const check = jest.fn();
    let waiting = false;
    await renderHook(() =>
      usePollWhileChecking(() => waiting, check, { everyMs: 1000, times: 2 }),
    );

    jest.advanceTimersByTime(5000);
    expect(check).not.toHaveBeenCalled();

    // The status turns to "being checked" under the running timer.
    waiting = true;
    jest.advanceTimersByTime(5000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('stops when the screen leaves view', async () => {
    const check = jest.fn();
    const { unmount } = await renderHook(() =>
      usePollWhileChecking(() => true, check, { everyMs: 1000, times: 10 }),
    );

    jest.advanceTimersByTime(2000);
    await unmount();
    jest.advanceTimersByTime(10_000);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
