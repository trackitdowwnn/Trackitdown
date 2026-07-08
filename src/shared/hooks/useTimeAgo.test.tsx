/**
 * WHAT:  Tests for useTimeAgo — the output advances as clock time passes
 *        and the interval is cleaned up on unmount.
 * WHY:   A stale relative time misinforms spotters about how fresh a
 *        sighting is; a leaked interval re-renders unmounted feeds.
 * LINKS: src/shared/hooks/useTimeAgo.ts.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useTimeAgo } from './useTimeAgo';

describe('useTimeAgo', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('advances the label as time passes', async () => {
    const start = Date.now();
    const { result } = await renderHook(() => useTimeAgo(start));

    expect(result.current).toBe('just now');

    await act(async () => {
      jest.advanceTimersByTime(2 * 60_000);
    });

    expect(result.current).toBe('2m ago');
  });

  it('clears its interval on unmount', async () => {
    const clearSpy = jest.spyOn(globalThis, 'clearInterval');
    const { unmount } = await renderHook(() => useTimeAgo(Date.now()));

    await act(async () => unmount());

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
