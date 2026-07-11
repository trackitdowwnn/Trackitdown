/**
 * WHAT:  Tests for mapApi — RPC params, MapPost mapping with coordinates,
 *        the strict active-only schema (SAFETY), and error propagation.
 * WHY:   The map schema is the client end of the exact-coordinates safety
 *        contract: a non-active post carrying coordinates must FAIL
 *        validation, never render as a pin.
 * LINKS: src/features/search-map/api/mapApi.ts, docs/TESTING.md (Tier 1),
 *        supabase/tests/home_feed_verification.sql (server end).
 */

import { fetchViewportPosts } from './mapApi';

const mockRpc = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const rpcMapPost = (overrides: Record<string, unknown> = {}) => ({
  id: 'b2b2b2b2-0000-0000-0000-000000000001',
  plate: 'AB12 CDE',
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  bounty_amount_pence: 15000,
  status: 'active',
  last_seen_at: '2026-07-10T18:00:00Z',
  last_seen_area: 'St Albans',
  distance_miles: null,
  created_at: '2026-07-10T18:05:00Z',
  lat: 51.752,
  lng: -0.339,
  ...overrides,
});

const HERTS_BBOX = { minLat: 51.5, minLng: -0.6, maxLat: 52.0, maxLng: -0.1 };

beforeEach(() => {
  mockRpc.mockReset();
});

describe('fetchViewportPosts', () => {
  it('calls the RPC with the bbox and maps posts with coordinates', async () => {
    mockRpc.mockResolvedValue({ data: { total: 23, posts: [rpcMapPost()] }, error: null });

    const result = await fetchViewportPosts(HERTS_BBOX);

    expect(mockRpc).toHaveBeenCalledWith('get_posts_in_viewport', {
      p_min_lat: 51.5,
      p_min_lng: -0.6,
      p_max_lat: 52.0,
      p_max_lng: -0.1,
      p_limit: 100,
    });
    expect(result.total).toBe(23);
    expect(result.posts[0]).toMatchObject({
      id: 'b2b2b2b2-0000-0000-0000-000000000001',
      plate: 'AB12 CDE',
      latitude: 51.752,
      longitude: -0.339,
      status: 'active',
    });
  });

  it('rejects any non-active post carrying coordinates (SAFETY)', async () => {
    mockRpc.mockResolvedValue({
      data: { total: 1, posts: [rpcMapPost({ status: 'recovered' })] },
      error: null,
    });

    await expect(fetchViewportPosts(HERTS_BBOX)).rejects.toThrow();
  });

  it('rejects malformed coordinates', async () => {
    mockRpc.mockResolvedValue({
      data: { total: 1, posts: [rpcMapPost({ lat: 91 })] },
      error: null,
    });

    await expect(fetchViewportPosts(HERTS_BBOX)).rejects.toThrow();
  });

  it('propagates RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });

    await expect(fetchViewportPosts(HERTS_BBOX)).rejects.toEqual(
      expect.objectContaining({ code: 'XX000' }),
    );
  });

  it('handles an empty viewport', async () => {
    mockRpc.mockResolvedValue({ data: { total: 0, posts: [] }, error: null });

    const result = await fetchViewportPosts(HERTS_BBOX);

    expect(result).toEqual({ total: 0, posts: [] });
  });
});
