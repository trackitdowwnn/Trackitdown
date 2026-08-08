/**
 * WHAT:  Tests for usePostStats — that a null payload becomes `notFound` and
 *        not `error`, that retry re-runs the load, and that a failed BACKGROUND
 *        refresh leaves the numbers already on screen alone.
 * WHY:   `notFound` vs `error` is the decision this hook exists to make, and
 *        until this file was written it was asserted nowhere: the screen's
 *        tests mock this hook wholesale, so they check what the screen renders
 *        GIVEN a status, never that the status is chosen correctly. The two are
 *        not interchangeable to a user — `error` offers a retry, and for an
 *        owner who has just deleted a listing that retry can never succeed.
 *
 *        The background-refresh rule is the other half. A focus refresh that
 *        fails must not blank good numbers into an error page, because the
 *        owner may be mid-read when the network drops.
 * LINKS: src/features/vehicles/hooks/usePostStats.ts;
 *        src/features/vehicles/api/postStatsApi.ts; docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { PostStats } from '../api/postStatsApi';
import { usePostStats } from './usePostStats';

const mockFetchPostStats = jest.fn();
jest.mock('../api/postStatsApi', () => ({
  fetchPostStats: (postId: string) => mockFetchPostStats(postId),
}));

// The focus refresh fires the callback once on mount, which is what the real
// useFocusEffect does when a screen mounts already focused.
const mockFocusCallbacks: (() => void)[] = [];
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    mockFocusCallbacks.push(cb);
  },
}));

const stats: PostStats = {
  spottersAlerted: 128,
  createdAt: '2026-07-08T12:00:00Z',
  expiresAt: '2026-10-06T12:00:00Z',
  sightingsTotal: 0,
  sightingsUnverified: 0,
  sightingsHelpful: 0,
  sightingsCredited: 0,
  firstSightingAt: null,
  lastSightingAt: null,
  sightingsByDay: [],
  conversations: 0,
  messages: 0,
};

beforeEach(() => {
  mockFetchPostStats.mockReset();
  mockFocusCallbacks.length = 0;
});

describe('usePostStats', () => {
  it('loads and reports ready', async () => {
    mockFetchPostStats.mockResolvedValue(stats);

    const { result } = await renderHook(() => usePostStats('p1'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockFetchPostStats).toHaveBeenCalledWith('p1');
    expect(result.current.stats).toEqual(stats);
  });

  // THE DECISION. null is the server's deliberate answer for "not yours" AND
  // "doesn't exist" — it is a fact, not a failure, and must never offer a retry.
  it('maps a null payload to notFound, never to error', async () => {
    mockFetchPostStats.mockResolvedValue(null);

    const { result } = await renderHook(() => usePostStats('p1'));

    await waitFor(() => expect(result.current.status).toBe('notFound'));
    expect(result.current.status).not.toBe('error');
    expect(result.current.stats).toBeNull();
  });

  it('reports error when the RPC actually fails', async () => {
    mockFetchPostStats.mockRejectedValue(new Error('network'));

    const { result } = await renderHook(() => usePostStats('p1'));

    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('retry re-runs the load and can recover', async () => {
    mockFetchPostStats.mockRejectedValueOnce(new Error('network'));
    const { result } = await renderHook(() => usePostStats('p1'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    mockFetchPostStats.mockResolvedValue(stats);
    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.stats).toEqual(stats);
  });

  // A focus refresh that fails must leave the good numbers where they are.
  // Flipping to `error` here would blank the page under someone mid-read.
  it('keeps the numbers on screen when a background refresh fails', async () => {
    mockFetchPostStats.mockResolvedValue(stats);
    const { result } = await renderHook(() => usePostStats('p1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    mockFetchPostStats.mockRejectedValue(new Error('network'));
    await act(async () => {
      mockFocusCallbacks[mockFocusCallbacks.length - 1]();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.stats).toEqual(stats);
  });
});
