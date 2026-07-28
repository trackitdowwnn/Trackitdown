/**
 * WHAT:  Tests for the watchlist API layer — addWatch's filing behaviour (it
 *        reports the collection the watch LANDED in, falls back to Saved when
 *        the target collection is gone, and still throws on a real failure),
 *        and toEntry carrying collection_id onto both payload shapes.
 * WHY:   "A save is NEVER blocked by a filing problem" is the rule this whole
 *        feature rests on. A collection deleted on another device leaves a
 *        stale cached target, and the insert policy rejects it — without the
 *        fallback the heart would simply fail, on the one interaction that has
 *        to be instant. The fallback must NOT swallow a genuine rejection
 *        (an invisible post), which is the second half of these tests.
 * LINKS: src/features/watchlist/api/watchlistApi.ts;
 *        supabase/migrations/20260801110000_watchlist_collections.sql;
 *        docs/TESTING.md.
 */

import { addWatch, fetchWatchlist } from './watchlistApi';

const mockInsert = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: {
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
    },
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const POST_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const COLLECTION_ID = 'bbbbbbbb-0000-0000-0000-00000000000b';

/** RLS rejects an insert naming a collection the caller doesn't own — the same
 *  code a deleted collection produces, since "gone" and "not yours" are
 *  deliberately indistinguishable (no existence oracle). */
const RLS_DENIED = { code: '42501', message: 'new row violates row-level security policy' };

beforeEach(() => {
  mockInsert.mockReset();
  mockRpc.mockReset();
});

describe('addWatch', () => {
  it('files into the requested collection and reports it back', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await expect(addWatch(POST_ID, COLLECTION_ID)).resolves.toBe(COLLECTION_ID);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'u1',
      post_id: POST_ID,
      collection_id: COLLECTION_ID,
    });
  });

  it('defaults to Saved when no collection is given', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await expect(addWatch(POST_ID)).resolves.toBeNull();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ collection_id: null }),
    );
  });

  it('falls back to Saved when the target collection is gone, and says so', async () => {
    // First insert rejected (stale collection), retry with no collection wins.
    mockInsert
      .mockResolvedValueOnce({ error: RLS_DENIED })
      .mockResolvedValueOnce({ error: null });

    // The save SUCCEEDS — the caller learns it landed in Saved, not that it failed.
    await expect(addWatch(POST_ID, COLLECTION_ID)).resolves.toBeNull();

    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert).toHaveBeenLastCalledWith({
      user_id: 'u1',
      post_id: POST_ID,
      collection_id: null,
    });
  });

  it('does not retry when there was no collection to blame', async () => {
    // A rejection with collection_id already null is a REAL failure — the post
    // isn't visible (see-before-act). Retrying would just fail again, and
    // swallowing it would leave the heart lit on a save that never happened.
    mockInsert.mockResolvedValue({ error: RLS_DENIED });

    await expect(addWatch(POST_ID)).rejects.toMatchObject({ code: '42501' });

    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('throws when even the fallback insert fails', async () => {
    mockInsert.mockResolvedValue({ error: RLS_DENIED });

    await expect(addWatch(POST_ID, COLLECTION_ID)).rejects.toMatchObject({ code: '42501' });

    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('treats a duplicate as success without retrying', async () => {
    // Double-tap: the row already exists. It keeps whatever collection it was
    // filed in — a second tap must not look like a failure OR trigger the
    // fallback, which would report the wrong collection to the toast.
    mockInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });

    await expect(addWatch(POST_ID, COLLECTION_ID)).resolves.toBe(COLLECTION_ID);

    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWatchlist collection filing', () => {
  const base = {
    id: POST_ID,
    watched_at: '2026-07-21T10:00:00Z',
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    thumbnail_url: null,
    resolved_at: null,
    plate: 'AB12 CDE',
    bounty_amount_pence: 50000,
    last_seen_at: null,
    last_seen_area: null,
    distance_miles: null,
    created_at: '2026-07-20T10:00:00Z',
  };

  it('carries collection_id onto a full row', async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...base, status: 'active', collection_id: COLLECTION_ID }],
      error: null,
    });

    const [entry] = await fetchWatchlist();

    expect(entry.collectionId).toBe(COLLECTION_ID);
  });

  it('carries collection_id onto a tombstone', async () => {
    // A closed car keeps its filing so it stays in its own list's "No longer
    // active" section rather than jumping back to Saved.
    mockRpc.mockResolvedValue({
      data: [
        {
          ...base,
          status: 'expired',
          plate: null,
          bounty_amount_pence: null,
          resolved_at: '2026-07-22T10:00:00Z',
          collection_id: COLLECTION_ID,
        },
      ],
      error: null,
    });

    const [entry] = await fetchWatchlist();

    expect(entry.kind).toBe('tombstone');
    expect(entry.collectionId).toBe(COLLECTION_ID);
  });

  it('fails loudly if the server stops sending collection_id', async () => {
    // Not a cosmetic drift: a missing key would silently file every saved car
    // into Saved, emptying every list the user built.
    const { collection_id: _omitted, ...withoutKey } = { ...base, status: 'active', collection_id: null };
    mockRpc.mockResolvedValue({ data: [withoutKey], error: null });

    await expect(fetchWatchlist()).rejects.toThrow();
  });
});
