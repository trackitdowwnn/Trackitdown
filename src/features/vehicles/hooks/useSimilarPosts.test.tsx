/**
 * WHAT:  Tests for useSimilarPosts — waits for `enabled`, centres the feed
 *        query on the post's coords, flattens/dedupes/caps the sections,
 *        excludes the post itself, and degrades to an empty ready state on
 *        failure (the rail is a bonus, never an error surface).
 * WHY:   The exclusion and quiet-failure rules are the contract: the rail
 *        must never suggest the car the user is already looking at, and a
 *        broken shelf must never error the page.
 * LINKS: src/features/vehicles/hooks/useSimilarPosts.ts, docs/TESTING.md.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import type { PostSummary } from '@/shared/types';

import { useSimilarPosts } from './useSimilarPosts';

const mockFetchHomeFeed = jest.fn();
jest.mock('@/features/search-map', () => ({
  fetchHomeFeed: (params: unknown) => mockFetchHomeFeed(params),
}));

const summary = (id: string): PostSummary => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Focus',
  colour: 'Red',
  plate: null,
  status: 'active',
  lastSeenAt: '2026-07-18T10:00:00Z',
  bountyPence: 30000,
});

beforeEach(() => {
  mockFetchHomeFeed.mockReset();
});

describe('useSimilarPosts', () => {
  it('does not fetch until enabled', async () => {
    const { result } = await renderHook(() => useSimilarPosts('p1', undefined, undefined, false));
    expect(mockFetchHomeFeed).not.toHaveBeenCalled();
    expect(result.current.status).toBe('loading');
  });

  it('centres the query on the post coords, dedupes, excludes self, caps at 6', async () => {
    mockFetchHomeFeed.mockResolvedValue([
      { id: 's1', posts: [summary('p1'), summary('p2'), summary('p3')] },
      { id: 's2', posts: [summary('p2'), summary('p4'), summary('p5')] },
      { id: 's3', posts: [summary('p6'), summary('p7'), summary('p8'), summary('p9')] },
    ]);
    const { result } = await renderHook(() => useSimilarPosts('p1', 51.7, -0.3, true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockFetchHomeFeed).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 51.7, longitude: -0.3 }),
    );
    const ids = result.current.posts.map((post: PostSummary) => post.id);
    expect(ids).not.toContain('p1'); // never the post itself
    expect(new Set(ids).size).toBe(ids.length); // deduped
    expect(ids).toHaveLength(6); // capped
  });

  it('degrades to an empty ready state when the feed fails', async () => {
    mockFetchHomeFeed.mockRejectedValue(new Error('network'));
    const { result } = await renderHook(() => useSimilarPosts('p1', undefined, undefined, true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.posts).toEqual([]);
  });
});
