/**
 * WHAT:  Tests for the My Listings API layer — listMyPosts maps list_my_posts
 *        rows to PostSummary (photos array → uris, last_seen_at→created_at
 *        fallback, null bounty → 0), accepts EVERY lifecycle status (an owner
 *        sees drafts/pending/etc.), and fails loudly on a shape drift.
 * WHY:   The owner-scoped list is the one place private statuses (draft,
 *        pending) reach a card surface, so the status-enum breadth and the
 *        mapping are worth pinning; a silent shape drift would render garbage.
 * LINKS: src/features/vehicles/api/myPostsApi.ts, docs/TESTING.md.
 */

import { listMyPosts } from './myPostsApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'draft',
    photos: [{ url: 'https://x.supabase.co/post-photos/u/1.jpg' }],
    last_seen_at: '2026-07-10T18:00:00Z',
    last_seen_area: 'Camden',
    bounty_amount_pence: 50000,
    created_at: '2026-07-08T12:00:00Z',
    distance_miles: null,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('listMyPosts', () => {
  it('maps a row to PostSummary', async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null });
    const [post] = await listMyPosts();
    expect(post).toEqual({
      id: ID,
      photos: [{ uri: 'https://x.supabase.co/post-photos/u/1.jpg' }],
      make: 'BMW',
      model: '3 Series',
      colour: 'Blue',
      plate: 'AB12 CDE',
      status: 'draft',
      lastSeenAt: '2026-07-10T18:00:00Z',
      lastSeenArea: 'Camden',
      bountyPence: 50000,
    });
  });

  it('accepts every lifecycle status (owner sees private states)', async () => {
    const statuses = [
      'draft',
      'pending_verification',
      'active',
      'recovery_claimed',
      'recovered',
      'recovered_no_spotter',
      'cancelled',
      'expired',
      'rejected',
    ];
    mockRpc.mockResolvedValue({ data: statuses.map((s) => row({ status: s })), error: null });
    const posts = await listMyPosts();
    expect(posts.map((p) => p.status)).toEqual(statuses);
  });

  it('falls back to created_at when last_seen_at is null', async () => {
    mockRpc.mockResolvedValue({
      data: [row({ last_seen_at: null })],
      error: null,
    });
    const [post] = await listMyPosts();
    expect(post.lastSeenAt).toBe('2026-07-08T12:00:00Z');
  });

  // MONEY (ADR-0014): this asserted `0` until 2026-08-20, back when a null
  // bounty could only mean "column missing from the projection". A null is now
  // real data — a no-reward listing — and coercing it to 0 would print
  // "£0 bounty" on the owner's own card. The null must survive the mapping so
  // BountyTag can render "No reward".
  it('preserves a null bounty rather than coercing it to 0', async () => {
    mockRpc.mockResolvedValue({
      data: [row({ bounty_amount_pence: null })],
      error: null,
    });
    const [post] = await listMyPosts();
    expect(post.bountyPence).toBeNull();
  });

  it('maps a post with no photos to an empty photos array', async () => {
    mockRpc.mockResolvedValue({ data: [row({ photos: [] })], error: null });
    const [post] = await listMyPosts();
    expect(post.photos).toEqual([]);
  });

  it('throws when the RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(listMyPosts()).rejects.toBeDefined();
  });

  it('fails loudly on a shape drift (unknown status)', async () => {
    mockRpc.mockResolvedValue({ data: [row({ status: 'wat' })], error: null });
    await expect(listMyPosts()).rejects.toBeDefined();
  });
});
