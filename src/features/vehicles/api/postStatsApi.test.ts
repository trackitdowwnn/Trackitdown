/**
 * WHAT:  Tests for fetchPostStats — the snake_case → camelCase mapping, the
 *        `.strict()` guard, and the one behaviour the whole screen hangs on:
 *        a null payload is a VALUE, not a throw.
 * WHY:   This file exists because a review found the gap. PostStatsScreen's
 *        tests mock usePostStats wholesale, and usePostStats' own tests mock
 *        this module — so the null-is-not-an-error decision was asserted only
 *        DOWNSTREAM of the two places that actually make it. If fetchPostStats
 *        ever threw on null instead of returning it, every "not found" would
 *        become "something went wrong" with a retry that can never succeed, and
 *        nothing in the suite would have noticed.
 *
 *        The `.strict()` case matters for a specific reason: get_post_stats is
 *        an owner-face RPC whose shape is deliberately counts-only, and the
 *        migration's comment forbids it growing per-person granularity. A
 *        widened RPC must fail HERE, loudly, rather than handing the UI a field
 *        nobody reviewed — see post_detail_verification CHECK 16, which pins
 *        the same key set from the database side.
 * LINKS: ./postStatsApi.ts; supabase/migrations/20260807130000_post_stats.sql;
 *        docs/TESTING.md.
 */

import { fetchPostStats } from './postStatsApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    spotters_alerted: 128,
    created_at: '2026-07-08T12:00:00Z',
    expires_at: '2026-10-06T12:00:00Z',
    sightings_total: 3,
    sightings_unverified: 1,
    sightings_helpful: 1,
    sightings_credited: 1,
    first_sighting_at: '2026-07-10T18:00:00Z',
    last_sighting_at: '2026-07-12T09:00:00Z',
    sightings_by_day: [{ day: '2026-07-10', count: 2 }],
    conversations: 1,
    messages: 2,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('fetchPostStats', () => {
  it('maps every field to the app side', async () => {
    mockRpc.mockResolvedValue({ data: payload(), error: null });

    const stats = await fetchPostStats(ID);

    expect(mockRpc).toHaveBeenCalledWith('get_post_stats', { p_post_id: ID });
    expect(stats).toEqual({
      spottersAlerted: 128,
      createdAt: '2026-07-08T12:00:00Z',
      expiresAt: '2026-10-06T12:00:00Z',
      sightingsTotal: 3,
      sightingsUnverified: 1,
      sightingsHelpful: 1,
      sightingsCredited: 1,
      firstSightingAt: '2026-07-10T18:00:00Z',
      lastSightingAt: '2026-07-12T09:00:00Z',
      sightingsByDay: [{ day: '2026-07-10', count: 2 }],
      conversations: 1,
      messages: 2,
    });
  });

  // THE ONE THAT MATTERS. A post the caller does not own and a post that does
  // not exist are the same null from the server, by design, so neither can be
  // probed. Turning that into a throw turns "not found" into "try again".
  it('returns null rather than throwing when the post is not the caller’s', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(fetchPostStats(ID)).resolves.toBeNull();
  });

  it('throws on a real RPC error, so the hook can offer a retry', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });

    await expect(fetchPostStats(ID)).rejects.toThrow('denied');
  });

  // .strict(): the RPC's shape is counts-only on purpose and must not grow
  // per-person granularity. A new field is a review event, not a silent pass.
  it('rejects a payload that grew a field nobody reviewed', async () => {
    mockRpc.mockResolvedValue({ data: payload({ watchers: 9 }), error: null });

    await expect(fetchPostStats(ID)).rejects.toThrow();
  });

  it('rejects a payload missing a field the screen does arithmetic on', async () => {
    const { created_at: _dropped, ...withoutClock } = payload();
    mockRpc.mockResolvedValue({ data: withoutClock, error: null });

    await expect(fetchPostStats(ID)).rejects.toThrow();
  });

  // A draft never went live, so it carries no clock. The screen omits the
  // countdown entirely for these — but only if the schema lets the null past.
  it('accepts a null expiry (a draft that never went live)', async () => {
    mockRpc.mockResolvedValue({ data: payload({ expires_at: null }), error: null });

    await expect(fetchPostStats(ID)).resolves.toMatchObject({ expiresAt: null });
  });
});
