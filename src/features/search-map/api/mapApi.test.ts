/**
 * WHAT:  Tests for mapApi — search_posts / search_posts_count RPC params,
 *        MapPost mapping with coordinates, criteria passthrough (via
 *        toRpcCriteria), the strict active-only schema (SAFETY), and error
 *        propagation.
 * WHY:   The map schema is the client end of the exact-coordinates safety
 *        contract: a non-active post carrying coordinates must FAIL
 *        validation, never render as a pin. And the query the server sees must
 *        be exactly the user's criteria — never a stray or plate key.
 * LINKS: src/features/search-map/api/mapApi.ts, docs/TESTING.md (Tier 1),
 *        supabase/tests/home_feed_verification.sql (server end).
 */

import { fetchSearchCount, fetchSearchPosts } from './mapApi';
import { type SearchCriteria, emptyCriteria } from '../lib/searchCriteria';

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
  // search_posts shares home_feed_post_json, so map pins carry the same cover
  // photo the feed cards do — the result sheet renders real cars too.
  photos: [{ url: 'https://cdn.example/map-cover.jpg' }],
  lat: 51.752,
  lng: -0.339,
  ...overrides,
});

const HERTS_BBOX = { minLat: 51.5, minLng: -0.6, maxLat: 52.0, maxLng: -0.1 };

const criteria = (overrides: Partial<SearchCriteria> = {}): SearchCriteria => ({
  ...emptyCriteria(),
  ...overrides,
});

beforeEach(() => {
  mockRpc.mockReset();
});

describe('fetchSearchPosts (unfiltered)', () => {
  it('calls search_posts with the bbox, empty criteria, and maps coordinates', async () => {
    mockRpc.mockResolvedValue({ data: { total: 23, posts: [rpcMapPost()] }, error: null });

    const result = await fetchSearchPosts(HERTS_BBOX, emptyCriteria());

    expect(mockRpc).toHaveBeenCalledWith('search_posts', {
      p_min_lat: 51.5,
      p_min_lng: -0.6,
      p_max_lat: 52.0,
      p_max_lng: -0.1,
      p_criteria: {},
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

    await expect(fetchSearchPosts(HERTS_BBOX, emptyCriteria())).rejects.toThrow();
  });

  it('rejects malformed coordinates', async () => {
    mockRpc.mockResolvedValue({
      data: { total: 1, posts: [rpcMapPost({ lat: 91 })] },
      error: null,
    });

    await expect(fetchSearchPosts(HERTS_BBOX, emptyCriteria())).rejects.toThrow();
  });

  it('propagates RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });

    await expect(fetchSearchPosts(HERTS_BBOX, emptyCriteria())).rejects.toEqual(
      expect.objectContaining({ code: 'XX000' }),
    );
  });

  it('handles an empty viewport', async () => {
    mockRpc.mockResolvedValue({ data: { total: 0, posts: [] }, error: null });

    const result = await fetchSearchPosts(HERTS_BBOX, emptyCriteria());

    expect(result).toEqual({ total: 0, posts: [] });
  });
});

describe('fetchSearchPosts criteria passthrough', () => {
  it('maps the user criteria into p_criteria (trimmed, only what narrows)', async () => {
    mockRpc.mockResolvedValue({ data: { total: 2, posts: [rpcMapPost()] }, error: null });

    await fetchSearchPosts(
      HERTS_BBOX,
      criteria({ text: ' focus ', make: 'Ford', bountyMinPence: 50000, distanceMiles: 10 }),
    );

    const [, params] = mockRpc.mock.calls[0];
    expect(params.p_criteria).toEqual({ text: 'focus', make: 'Ford', bounty_min: 50000 });
  });

  it('NEVER sends a plate key or the distance (privacy + geo model)', async () => {
    mockRpc.mockResolvedValue({ data: { total: 0, posts: [] }, error: null });

    await fetchSearchPosts(
      HERTS_BBOX,
      criteria({ text: 'AB12CDE', make: 'BMW', distanceMiles: 25, recencyDays: 7 }),
    );

    const [, params] = mockRpc.mock.calls[0];
    // The text goes through as a make/model term; there is no plate filter at
    // all, and distance never crosses the wire.
    expect(params.p_criteria).not.toHaveProperty('plate');
    expect(params.p_criteria).not.toHaveProperty('distance_miles');
    expect(Object.keys(params.p_criteria).sort()).toEqual(['make', 'recency_days', 'text']);
  });
});

describe('fetchSearchCount', () => {
  it('calls search_posts_count with the bbox + criteria and returns the number', async () => {
    mockRpc.mockResolvedValue({ data: 7, error: null });

    const count = await fetchSearchCount(HERTS_BBOX, criteria({ make: 'Ford' }));

    expect(mockRpc).toHaveBeenCalledWith('search_posts_count', {
      p_min_lat: 51.5,
      p_min_lng: -0.6,
      p_max_lat: 52.0,
      p_max_lng: -0.1,
      p_criteria: { make: 'Ford' },
    });
    expect(count).toBe(7);
  });

  it('rejects a malformed (non-integer) count', async () => {
    mockRpc.mockResolvedValue({ data: 'lots', error: null });
    await expect(fetchSearchCount(HERTS_BBOX, emptyCriteria())).rejects.toThrow();
  });

  it('propagates RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    await expect(fetchSearchCount(HERTS_BBOX, emptyCriteria())).rejects.toEqual(
      expect.objectContaining({ code: 'XX000' }),
    );
  });
});
