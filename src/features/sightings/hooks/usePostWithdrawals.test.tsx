/**
 * WHAT:  Tests for usePostWithdrawals — no request on the public face; the
 *        owner's rows once loaded; a failed refresh keeps them; a post change
 *        never shows the last post's rows; and a late answer for the old
 *        post is dropped.
 * WHY:   These rows carry a stranger's note to a theft victim. Showing them
 *        under the wrong listing, or asking for them on a face that isn't the
 *        owner's, would put words where they don't belong.
 * LINKS: src/features/sightings/hooks/usePostWithdrawals.ts.
 */

import { act, renderHook } from '@testing-library/react-native';

import type { PostWithdrawal } from '../types';
import { usePostWithdrawals } from './usePostWithdrawals';

// Focus effects run like plain effects here: the screen is always focused.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { useEffect } = require('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});

const mockFetch = jest.fn<Promise<PostWithdrawal[]>, [string]>();
jest.mock('../api/sightingApi', () => ({
  fetchPostWithdrawals: (postId: string) => mockFetch(postId),
}));

const row = (note: string): PostWithdrawal => ({
  withdrawnAt: '2026-10-09T10:00:00Z',
  reason: 'other',
  note,
});

/** A promise this test settles by hand, to order responses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => mockFetch.mockReset());

it('⚠️ makes no request when not enabled — the public face', async () => {
  const { result } = await renderHook(() => usePostWithdrawals('p1', false));
  expect(mockFetch).not.toHaveBeenCalled();
  expect(result.current).toEqual([]);
});

it('returns the owner’s rows once loaded', async () => {
  mockFetch.mockResolvedValue([row('A note')]);
  const { result } = await renderHook(() => usePostWithdrawals('p1', true));
  expect(mockFetch).toHaveBeenCalledWith('p1');
  expect(result.current).toEqual([row('A note')]);
});

it('keeps what is shown when a refresh fails', async () => {
  mockFetch.mockResolvedValueOnce([row('Kept')]);
  const { result, rerender } = await renderHook(
    ({ enabled }: { enabled: boolean }) => usePostWithdrawals('p1', enabled),
    { initialProps: { enabled: true } },
  );
  mockFetch.mockRejectedValueOnce(new Error('offline'));
  // Off and on again re-runs the focus effect: a second, failing load.
  await rerender({ enabled: false });
  await rerender({ enabled: true });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(result.current).toEqual([row('Kept')]);
});

it('⚠️ never shows the last post’s rows under another post', async () => {
  mockFetch.mockResolvedValueOnce([row('Post one')]);
  const { result, rerender } = await renderHook(
    ({ postId }: { postId: string }) => usePostWithdrawals(postId, true),
    { initialProps: { postId: 'p1' } },
  );
  expect(result.current).toEqual([row('Post one')]);
  // The second post's load fails: its list stays empty, never post one's.
  mockFetch.mockRejectedValueOnce(new Error('offline'));
  await rerender({ postId: 'p2' });
  expect(result.current).toEqual([]);
});

it('⚠️ drops a late answer for the post it has left', async () => {
  const first = deferred<PostWithdrawal[]>();
  mockFetch.mockReturnValueOnce(first.promise);
  mockFetch.mockResolvedValueOnce([row('Post two')]);
  const { result, rerender } = await renderHook(
    ({ postId }: { postId: string }) => usePostWithdrawals(postId, true),
    { initialProps: { postId: 'p1' } },
  );
  await rerender({ postId: 'p2' });
  expect(result.current).toEqual([row('Post two')]);
  // Post one's request finishes last — and changes nothing.
  await act(async () => {
    first.resolve([row('Post one')]);
  });
  expect(result.current).toEqual([row('Post two')]);
});
