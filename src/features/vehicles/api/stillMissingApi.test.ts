/**
 * WHAT:  Tests for the ADR-0019 liveness API — the list read that must never
 *        break the screen it rides on, and the confirm that must never show a
 *        person a Postgres string.
 * WHY:   These two calls have OPPOSITE failure policies, and getting either
 *        backwards is a real bug rather than a style question:
 *
 *        `listOpenStillMissingAsks` SWALLOWS. It is an addition to a screen
 *        that has its own job, so a failure must leave post detail working
 *        rather than turn it into an error state. Nothing is lost — the ask is
 *        a database row until it is answered.
 *
 *        `confirmStillMissing` THROWS, with copy this app wrote. It is a
 *        deliberate act by a person who is waiting to hear whether it worked.
 * LINKS: ./stillMissingApi.ts; ../lib/stillMissingError.ts;
 *        supabase/migrations/20260902140000_still_missing_check.sql;
 *        docs/decisions/ADR-0019-the-abandoned-post.md.
 */

import { StillMissingError } from '../lib/stillMissingError';

import { confirmStillMissing, listOpenStillMissingAsks } from './stillMissingApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const mockLogWarn = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

const POST = 'aaaaaaaa-0000-0000-0000-00000000000a';

beforeEach(() => {
  mockRpc.mockReset();
  mockLogWarn.mockReset();
});

describe('listOpenStillMissingAsks', () => {
  it('maps the payload to camelCase', async () => {
    mockRpc.mockResolvedValue({
      data: [{ post_id: POST, asked_at: '2026-09-02T10:00:00Z', ask_count: 2 }],
      error: null,
    });

    await expect(listOpenStillMissingAsks()).resolves.toEqual([
      { postId: POST, askedAt: '2026-09-02T10:00:00Z', askCount: 2 },
    ]);
  });

  it('returns [] rather than throwing when the RPC fails', async () => {
    // ⚠️ The banner is an ADDITION to post detail. If this threw, a transient
    // RPC failure would replace someone's listing with an error state — and the
    // ask would still be waiting in the database either way.
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } });

    await expect(listOpenStillMissingAsks()).resolves.toEqual([]);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('returns [] for a guest (null payload)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(listOpenStillMissingAsks()).resolves.toEqual([]);
  });

  it('fails loudly on a shape drift rather than rendering garbage', async () => {
    mockRpc.mockResolvedValue({ data: [{ post_id: 'not-a-uuid' }], error: null });
    await expect(listOpenStillMissingAsks()).rejects.toThrow();
  });
});

describe('confirmStillMissing', () => {
  it('calls the RPC with the post id', async () => {
    mockRpc.mockResolvedValue({ data: { confirmed: true }, error: null });
    await confirmStillMissing(POST);
    expect(mockRpc).toHaveBeenCalledWith('confirm_still_missing', { p_post_id: POST });
  });

  it('translates a known token into copy', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'POST_NOT_FOUND' } });

    const error = await confirmStillMissing(POST).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StillMissingError);
    expect((error as StillMissingError).code).toBe('POST_NOT_FOUND');
    expect((error as StillMissingError).message).toBe('We couldn’t update that listing.');
  });

  it('never shows an unknown server message to the user', async () => {
    const raw = 'permission denied for table posts';
    mockRpc.mockResolvedValue({ data: null, error: { message: raw, code: '42501' } });

    const error = await confirmStillMissing(POST).catch((err: unknown) => err);

    expect((error as StillMissingError).code).toBe('RPC_ERROR');
    expect((error as StillMissingError).message).not.toContain('permission denied');
    // The unknown token is not echoed into the logs either.
    expect(JSON.stringify(mockLogWarn.mock.calls)).not.toContain('permission denied');
  });

  it('treats a prototype key as UNKNOWN, not as a known token', async () => {
    // `token in MAP` would resolve `toString` off the prototype and hand a
    // FUNCTION to the user as their error text — the bug fixed at four other
    // sites on 2026-09-02. Object.hasOwn is why this one never had it.
    mockRpc.mockResolvedValue({ data: null, error: { message: 'toString' } });

    const error = await confirmStillMissing(POST).catch((err: unknown) => err);

    expect((error as StillMissingError).code).toBe('RPC_ERROR');
    expect(typeof (error as StillMissingError).message).toBe('string');
    expect((error as StillMissingError).message).toBe('Something went wrong. Please try again.');
  });
});
