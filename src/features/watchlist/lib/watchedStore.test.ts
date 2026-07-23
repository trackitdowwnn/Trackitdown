/**
 * WHAT:  Tests for watchedStore — cross-hook reactivity (every mounted
 *        toggle agrees instantly), setWatched notification, per-user
 *        hydration dedupe, guest clearing, silent best-effort failure,
 *        and the run-time isWatchedNow read.
 * WHY:   The toggle renders on many surfaces at once; if one flip didn't
 *        reach every subscriber, bookmarks would visibly disagree across
 *        the feed, map, and detail header. Hydration must never crash a
 *        card and must not refetch per mount.
 * LINKS: src/features/watchlist/lib/watchedStore.ts; docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';

import {
  ensureWatchedHydrated,
  isWatchedNow,
  resetWatchedStoreForTests,
  setWatched,
  useIsWatched,
} from './watchedStore';

beforeEach(() => {
  resetWatchedStoreForTests();
});

describe('useIsWatched reactivity', () => {
  it('flips every mounted hook for the same post when one toggle sets it', async () => {
    const first = await renderHook(() => useIsWatched('post-1'));
    const second = await renderHook(() => useIsWatched('post-1'));
    const other = await renderHook(() => useIsWatched('post-2'));

    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);

    await act(async () => {
      setWatched('post-1', true);
    });

    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
    expect(other.result.current).toBe(false);

    await act(async () => {
      setWatched('post-1', false);
    });

    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);

    await first.unmount();
    await second.unmount();
    await other.unmount();
  });
});

describe('isWatchedNow', () => {
  it('reads the CURRENT membership, not a render-captured one', async () => {
    expect(isWatchedNow('post-1')).toBe(false);
    setWatched('post-1', true);
    expect(isWatchedNow('post-1')).toBe(true);
    setWatched('post-1', false);
    expect(isWatchedNow('post-1')).toBe(false);
  });
});

describe('ensureWatchedHydrated', () => {
  it('hydrates once per user and dedupes repeat calls for the same user', async () => {
    const fetchIds = jest.fn(async () => ['a', 'b']);

    await ensureWatchedHydrated('user-1', fetchIds);
    await ensureWatchedHydrated('user-1', fetchIds);

    expect(fetchIds).toHaveBeenCalledTimes(1);
    expect(isWatchedNow('a')).toBe(true);
    expect(isWatchedNow('b')).toBe(true);
    expect(isWatchedNow('c')).toBe(false);
  });

  it('replaces the set when a different user hydrates', async () => {
    await ensureWatchedHydrated('user-1', async () => ['a']);
    await ensureWatchedHydrated('user-2', async () => ['z']);

    expect(isWatchedNow('a')).toBe(false);
    expect(isWatchedNow('z')).toBe(true);
  });

  it('clears everything for a guest (sign-out) and notifies subscribers', async () => {
    await ensureWatchedHydrated('user-1', async () => ['a']);
    const { result, unmount } = await renderHook(() => useIsWatched('a'));
    expect(result.current).toBe(true);

    await act(async () => {
      await ensureWatchedHydrated(null, async () => {
        throw new Error('guests never fetch');
      });
    });

    expect(result.current).toBe(false);
    expect(isWatchedNow('a')).toBe(false);
    await unmount();
  });

  it('swallows a fetch failure silently (best-effort) and allows a later retry', async () => {
    await expect(
      ensureWatchedHydrated('user-1', async () => {
        throw new Error('network down');
      }),
    ).resolves.toBeUndefined();
    expect(isWatchedNow('a')).toBe(false);

    // Not marked hydrated: a later mount retries and succeeds.
    await ensureWatchedHydrated('user-1', async () => ['a']);
    expect(isWatchedNow('a')).toBe(true);
  });
});

describe('resetWatchedStoreForTests', () => {
  it('leaves no state behind between tests', async () => {
    setWatched('post-1', true);
    resetWatchedStoreForTests();
    expect(isWatchedNow('post-1')).toBe(false);

    // Hydration marker is cleared too — the same user rehydrates fresh.
    const fetchIds = jest.fn(async () => []);
    await ensureWatchedHydrated('user-1', fetchIds);
    expect(fetchIds).toHaveBeenCalledTimes(1);
  });
});
