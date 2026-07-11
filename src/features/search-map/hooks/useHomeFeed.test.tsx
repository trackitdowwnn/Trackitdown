/**
 * WHAT:  Tests for useHomeFeed — load/ready/error states, refresh keeping
 *        stale content on failure, hero pagination (offset, dedup,
 *        exhaustion), and reload on location change.
 * WHY:   The feed's async state machine decides whether the primary surface
 *        shows content, a skeleton, or an error — and pagination bugs are
 *        exactly the "stale recycling ghost" class the spec bans.
 * LINKS: src/features/search-map/hooks/useHomeFeed.ts, docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { PostSummary } from '@/shared/types';

import type { FeedLocation, FeedSection } from '../types';
import { useHomeFeed } from './useHomeFeed';

const mockFetchHomeFeed = jest.fn();
const mockFetchNearbyPosts = jest.fn();

jest.mock('../api/feedApi', () => ({
  fetchHomeFeed: (...args: unknown[]) => mockFetchHomeFeed(...args),
  fetchNearbyPosts: (...args: unknown[]) => mockFetchNearbyPosts(...args),
}));

const post = (id: string): PostSummary => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 15000,
});

const heroSection = (ids: string[]): FeedSection => ({
  id: 'near_you',
  title: 'Near you',
  layout: 'hero-vertical',
  posts: ids.map(post),
});

const LOCAL: FeedLocation = {
  mode: 'local',
  latitude: 53.48,
  longitude: -2.24,
  addressLabel: 'Manchester',
  radiusMiles: 20,
  fromPreference: true,
};

const fullFirstPage = heroSection(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);

beforeEach(() => {
  mockFetchHomeFeed.mockReset();
  mockFetchNearbyPosts.mockReset();
});

describe('loading', () => {
  it('stays loading while location is unresolved and loads once it lands', async () => {
    mockFetchHomeFeed.mockResolvedValue([fullFirstPage]);

    const { result, rerender } = await renderHook(
      ({ loc }: { loc: FeedLocation | null }) => useHomeFeed(loc),
      { initialProps: { loc: null as FeedLocation | null } },
    );

    expect(result.current.status).toBe('loading');
    expect(mockFetchHomeFeed).not.toHaveBeenCalled();

    await rerender({ loc: LOCAL });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockFetchHomeFeed).toHaveBeenCalledWith({
      latitude: 53.48,
      longitude: -2.24,
      radiusMiles: 20,
    });
    expect(result.current.sections).toEqual([fullFirstPage]);
  });

  it('goes to error on a failed initial load, and retry recovers', async () => {
    mockFetchHomeFeed.mockRejectedValueOnce(new Error('boom'));
    mockFetchHomeFeed.mockResolvedValueOnce([fullFirstPage]);

    const { result } = await renderHook(() => useHomeFeed(LOCAL));
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('reloads when the location changes', async () => {
    mockFetchHomeFeed.mockResolvedValue([fullFirstPage]);
    const { result, rerender } = await renderHook(
      ({ loc }: { loc: FeedLocation | null }) => useHomeFeed(loc),
      { initialProps: { loc: LOCAL as FeedLocation | null } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await rerender({ loc: { mode: 'national' } });

    await waitFor(() =>
      expect(mockFetchHomeFeed).toHaveBeenLastCalledWith({
        latitude: null,
        longitude: null,
        radiusMiles: 0,
      }),
    );
  });
});

describe('refresh', () => {
  it('keeps existing sections on a failed refresh (no error state)', async () => {
    mockFetchHomeFeed.mockResolvedValueOnce([fullFirstPage]);
    const { result } = await renderHook(() => useHomeFeed(LOCAL));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    mockFetchHomeFeed.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.sections).toEqual([fullFirstPage]);
    expect(result.current.refreshing).toBe(false);
  });
});

describe('hero pagination', () => {
  it('pages with the loaded count as offset and dedupes into near_you', async () => {
    mockFetchHomeFeed.mockResolvedValue([fullFirstPage]);
    mockFetchNearbyPosts.mockResolvedValue([post('p9'), post('p10'), post('p11')]);

    const { result } = await renderHook(() => useHomeFeed(LOCAL));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetchNearbyPosts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 10, limit: 10 }),
    );
    expect(result.current.sections[0].posts.map((p) => p.id)).toEqual([
      'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11',
    ]);
  });

  it('marks the list exhausted on a short page and stops calling', async () => {
    mockFetchHomeFeed.mockResolvedValue([fullFirstPage]);
    mockFetchNearbyPosts.mockResolvedValue([post('p10')]); // short page

    const { result } = await renderHook(() => useHomeFeed(LOCAL));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.loadMore();
    });
    await act(async () => {
      await result.current.loadMore(); // exhausted — must not call again
    });

    expect(mockFetchNearbyPosts).toHaveBeenCalledTimes(1);
  });

  it('never pages when the first page was already short', async () => {
    mockFetchHomeFeed.mockResolvedValue([heroSection(['p0', 'p1'])]);

    const { result } = await renderHook(() => useHomeFeed(LOCAL));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetchNearbyPosts).not.toHaveBeenCalled();
  });

  it('releases loadingMore when a newer load supersedes the in-flight page', async () => {
    mockFetchHomeFeed.mockResolvedValue([fullFirstPage]);
    let resolvePage!: (posts: PostSummary[]) => void;
    mockFetchNearbyPosts.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage = resolve)),
    );

    const { result, rerender } = await renderHook(
      ({ loc }: { loc: FeedLocation }) => useHomeFeed(loc),
      { initialProps: { loc: LOCAL } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Page request goes in flight…
    let pagePromise!: Promise<void>;
    await act(async () => {
      pagePromise = result.current.loadMore();
      await Promise.resolve();
    });
    expect(result.current.loadingMore).toBe(true);

    // …then a location change supersedes it (widen the area).
    await rerender({ loc: { ...LOCAL, radiusMiles: 35 } });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // The stale page resolves late: its posts are dropped, but the flag is
    // released — otherwise pagination wedges forever.
    await act(async () => {
      resolvePage([post('stale')]);
      await pagePromise;
    });
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.sections[0].posts.map((p) => p.id)).not.toContain('stale');

    mockFetchNearbyPosts.mockResolvedValueOnce([post('fresh')]);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(mockFetchNearbyPosts).toHaveBeenCalledTimes(2);
  });

  it('never pages in national mode', async () => {
    mockFetchHomeFeed.mockResolvedValue([
      { ...heroSection(Array.from({ length: 10 }, (_, i) => `p${i}`)), id: 'recent_uk' },
    ]);

    const { result } = await renderHook(() => useHomeFeed({ mode: 'national' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetchNearbyPosts).not.toHaveBeenCalled();
  });
});
