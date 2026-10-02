/**
 * WHAT:  Tests for useTimeAgo — the output advances as clock time passes
 *        and the interval is cleaned up on unmount.
 * WHY:   A stale relative time misinforms spotters about how fresh a
 *        sighting is; a leaked interval re-renders unmounted feeds.
 *        It also pins that the tick's Date is PASSED to timeAgo: Jest has no
 *        React Compiler, so it can't see the device bug (a bare tick let the
 *        compiler memoise the label forever), but it can see the fix's shape.
 * LINKS: src/shared/hooks/useTimeAgo.ts.
 */

import { act, renderHook } from '@testing-library/react-native';

import * as lib from '../lib';
import { useTimeAgo } from './useTimeAgo';

// A pass-through spy: the barrel's re-export can't be redefined by spyOn.
jest.mock('../lib', () => {
  const actual = jest.requireActual('../lib');
  return { ...actual, timeAgo: jest.fn(actual.timeAgo) };
});

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

  it('⚠️ passes the ticking clock to timeAgo (what the compiler can see)', async () => {
    await renderHook(() => useTimeAgo(Date.now()));
    expect(jest.mocked(lib.timeAgo)).toHaveBeenCalledWith(expect.anything(), expect.any(Date));
  });

  it('clears its interval on unmount', async () => {
    const clearSpy = jest.spyOn(globalThis, 'clearInterval');
    const { unmount } = await renderHook(() => useTimeAgo(Date.now()));

    await act(async () => unmount());

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
