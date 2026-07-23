/**
 * WHAT:  Tests for useWatchlist — guest instant-empty (no fetch, never an
 *        error), the active/resolved grouping (recovered cards and
 *        tombstones are resolved), the error state, and refresh keeping
 *        existing entries when its fetch fails.
 * WHY:   The grouping decides what sits under "No longer active" — the
 *        section that exists so a watcher always learns the outcome. A
 *        refresh failure must degrade to stale-but-present, never wipe the
 *        list the user is looking at.
 * LINKS: src/features/watchlist/hooks/useWatchlist.ts;
 *        src/features/watchlist/api/watchlistApi.ts; docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { SessionState } from '@/features/auth';
import type { PostSummary } from '@/shared/types';

import type { WatchedPost, WatchedTombstone, WatchlistEntry } from '../types';
import { useWatchlist } from './useWatchlist';

// useFocusEffect needs a navigation container in the real world; here it
// behaves as a plain effect (fires on mount = the "first focus" the hook
// deliberately skips refetching on).
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useEffect } = require('react');
  return { useFocusEffect: (cb: () => void) => useEffect(cb, [cb]) };
});

const mockFetchWatchlist = jest.fn(async (): Promise<WatchlistEntry[]> => []);
jest.mock('../api/watchlistApi', () => ({
  fetchWatchlist: () => mockFetchWatchlist(),
}));

let mockSession: SessionState;
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession,
}));

const summary = (overrides: Partial<PostSummary>): PostSummary => ({
  id: 'post-1',
  photos: [],
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-20T10:00:00Z',
  bountyPence: 50000,
  ...overrides,
});

const postEntry = (id: string, status: PostSummary['status'] = 'active'): WatchedPost => ({
  kind: 'post',
  watchedAt: '2026-07-21T10:00:00Z',
  post: summary({ id, status }),
});

const tombstone = (id: string): WatchedTombstone => ({
  kind: 'tombstone',
  watchedAt: '2026-07-01T10:00:00Z',
  postId: id,
  status: 'expired',
  make: 'Ford',
  model: 'Focus',
  colour: 'Red',
  resolvedAt: '2026-07-15T10:00:00Z',
  thumbnailUrl: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { status: 'signedIn', userId: 'user-1' };
  mockFetchWatchlist.mockResolvedValue([]);
});

describe('useWatchlist', () => {
  it('gives a guest an instant empty ready state without fetching', async () => {
    mockSession = { status: 'signedOut', userId: null };
    const { result, unmount } = await renderHook(() => useWatchlist());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.active).toEqual([]);
    expect(result.current.resolved).toEqual([]);
    expect(mockFetchWatchlist).not.toHaveBeenCalled();
    await unmount();
  });

  it('groups a member list: active watches vs resolved (recovered + tombstones)', async () => {
    const activeOne = postEntry('a');
    const activeTwo = postEntry('b');
    const recovered = postEntry('c', 'recovered');
    const noSpotter = postEntry('d', 'recovered_no_spotter');
    const dead = tombstone('e');
    mockFetchWatchlist.mockResolvedValue([activeOne, recovered, activeTwo, dead, noSpotter]);

    const { result, unmount } = await renderHook(() => useWatchlist());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.active).toEqual([activeOne, activeTwo]);
    expect(result.current.resolved).toEqual([recovered, dead, noSpotter]);
    await unmount();
  });

  it('reports error when the initial load fails, and retry recovers', async () => {
    mockFetchWatchlist.mockRejectedValueOnce(new Error('rpc down'));
    const { result, unmount } = await renderHook(() => useWatchlist());

    await waitFor(() => expect(result.current.status).toBe('error'));

    mockFetchWatchlist.mockResolvedValue([postEntry('a')]);
    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.active).toHaveLength(1);
    await unmount();
  });

  it('a failed refresh keeps the entries the user already has', async () => {
    const entry = postEntry('a');
    mockFetchWatchlist.mockResolvedValueOnce([entry]);
    const { result, unmount } = await renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    mockFetchWatchlist.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.active).toEqual([entry]);
    expect(result.current.refreshing).toBe(false);
    await unmount();
  });
});
