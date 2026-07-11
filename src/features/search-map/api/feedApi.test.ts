/**
 * WHAT:  Tests for feedApi — RPC params (miles→metres, national nulls),
 *        section/post mapping to PostSummary, zod rejection of unexpected
 *        statuses, and error propagation.
 * WHY:   This is the client end of the safety contract: a status outside
 *        the publicly-visible set must FAIL validation (never render), and
 *        the radius the user picked must reach the RPC in metres, not miles.
 * LINKS: src/features/search-map/api/feedApi.ts, docs/TESTING.md (Tier 2),
 *        supabase/tests/home_feed_verification.sql (server end of the same
 *        contract).
 */

import { fetchHomeFeed, fetchNearbyPosts } from './feedApi';

// Hoisted above the import by jest; the factory's arrow only dereferences
// mockRpc at call time, safely after initialisation.
const mockRpc = jest.fn();

jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const POST_ID = '5f0c9d6e-3b2a-4c1d-8e7f-a09b8c7d6e5f';

const rpcPost = (overrides: Record<string, unknown> = {}) => ({
  id: POST_ID,
  plate: 'AB12 CDE',
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  bounty_amount_pence: 15000,
  status: 'active',
  last_seen_at: '2026-07-10T18:00:00Z',
  last_seen_area: 'Salford',
  distance_miles: 2.4,
  created_at: '2026-07-10T18:05:00Z',
  ...overrides,
});

const feedPayload = (sections: unknown[]) => ({ data: { sections }, error: null });

beforeEach(() => {
  mockRpc.mockReset();
});

describe('fetchHomeFeed', () => {
  it('calls the RPC with metres and maps sections to PostSummary', async () => {
    mockRpc.mockResolvedValue(
      feedPayload([
        {
          id: 'near_you',
          title: 'Near you',
          layout: 'hero-vertical',
          posts: [rpcPost()],
        },
        {
          id: 'area_salford',
          title: 'Recently stolen in Salford',
          layout: 'carousel',
          area: 'Salford',
          posts: [rpcPost(), rpcPost({ distance_miles: 3.1 })],
        },
      ]),
    );

    const sections = await fetchHomeFeed({ latitude: 53.48, longitude: -2.24, radiusMiles: 20 });

    expect(mockRpc).toHaveBeenCalledWith('get_home_feed', {
      p_lat: 53.48,
      p_lng: -2.24,
      p_radius_m: 32187, // 20 miles, rounded metres
    });

    expect(sections).toHaveLength(2);
    expect(sections[0].id).toBe('near_you');
    expect(sections[0].posts[0]).toEqual({
      id: POST_ID,
      photos: [],
      make: 'Ford',
      model: 'Fiesta',
      colour: 'Blue',
      plate: 'AB12 CDE',
      status: 'active',
      lastSeenAt: '2026-07-10T18:00:00Z',
      lastSeenArea: 'Salford',
      distanceMiles: 2.4,
      bountyPence: 15000,
    });
    expect(sections[1].area).toBe('Salford');
  });

  it('passes null coordinates through for national mode', async () => {
    mockRpc.mockResolvedValue(feedPayload([]));

    const sections = await fetchHomeFeed({ latitude: null, longitude: null, radiusMiles: 20 });

    expect(mockRpc).toHaveBeenCalledWith(
      'get_home_feed',
      expect.objectContaining({ p_lat: null, p_lng: null }),
    );
    expect(sections).toEqual([]);
  });

  it('accepts non-RFC-4122 uuids (fixed seed/dev ids have zero version nibbles)', async () => {
    mockRpc.mockResolvedValue(
      feedPayload([
        {
          id: 'near_you',
          title: 'Near you',
          layout: 'hero-vertical',
          posts: [rpcPost({ id: 'b2b2b2b2-0000-0000-0000-000000000001' })],
        },
      ]),
    );

    const [section] = await fetchHomeFeed({ latitude: 53.48, longitude: -2.24, radiusMiles: 20 });

    expect(section.posts[0].id).toBe('b2b2b2b2-0000-0000-0000-000000000001');
  });

  it('maps null last_seen fields to safe fallbacks', async () => {
    mockRpc.mockResolvedValue(
      feedPayload([
        {
          id: 'recent_uk',
          title: 'Recent posts across the UK',
          layout: 'hero-vertical',
          posts: [rpcPost({ last_seen_at: null, last_seen_area: null, distance_miles: null })],
        },
      ]),
    );

    const [section] = await fetchHomeFeed({ latitude: null, longitude: null, radiusMiles: 20 });

    expect(section.posts[0].lastSeenAt).toBe('2026-07-10T18:05:00Z'); // created_at fallback
    expect(section.posts[0].lastSeenArea).toBeUndefined();
    expect(section.posts[0].distanceMiles).toBeUndefined();
  });

  it('rejects a post whose status is not publicly visible (SAFETY)', async () => {
    mockRpc.mockResolvedValue(
      feedPayload([
        {
          id: 'near_you',
          title: 'Near you',
          layout: 'hero-vertical',
          posts: [rpcPost({ status: 'pending_verification' })],
        },
      ]),
    );

    await expect(
      fetchHomeFeed({ latitude: 53.48, longitude: -2.24, radiusMiles: 20 }),
    ).rejects.toThrow();
  });

  it('throws when the RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });

    await expect(
      fetchHomeFeed({ latitude: 53.48, longitude: -2.24, radiusMiles: 20 }),
    ).rejects.toEqual(expect.objectContaining({ code: 'XX000' }));
  });
});

describe('fetchNearbyPosts', () => {
  it('pages with offset/limit and maps rows', async () => {
    mockRpc.mockResolvedValue({ data: [rpcPost({ distance_miles: 5.2 })], error: null });

    const posts = await fetchNearbyPosts({
      latitude: 53.48,
      longitude: -2.24,
      radiusMiles: 20,
      offset: 10,
      limit: 10,
    });

    expect(mockRpc).toHaveBeenCalledWith('get_nearby_posts', {
      p_lat: 53.48,
      p_lng: -2.24,
      p_radius_m: 32187,
      p_offset: 10,
      p_limit: 10,
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].distanceMiles).toBe(5.2);
  });

  it('rejects hidden statuses in pages too (SAFETY)', async () => {
    mockRpc.mockResolvedValue({ data: [rpcPost({ status: 'draft' })], error: null });

    await expect(
      fetchNearbyPosts({ latitude: 53.48, longitude: -2.24, radiusMiles: 20, offset: 0, limit: 10 }),
    ).rejects.toThrow();
  });
});
