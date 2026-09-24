/**
 * WHAT:  Tests for setPostArchived — the RPC call and its error copy.
 * WHY:   The server enforces who may archive what (owner-only, closed-only);
 *        the app's job is to call it correctly and never show a raw server
 *        message. NOT_CLOSED in particular must explain itself, because it is
 *        the answer to "why can't I archive my live listing?".
 * LINKS: src/features/vehicles/api/archiveApi.ts, docs/TESTING.md.
 */

import { ArchiveError, setPostArchived } from './archiveApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

beforeEach(() => jest.clearAllMocks());

describe('setPostArchived', () => {
  it.each([true, false])('calls set_post_archived with archived=%s', async (archived) => {
    mockRpc.mockResolvedValue({ data: { postId: 'p1' }, error: null });

    await setPostArchived('p1', archived);

    expect(mockRpc).toHaveBeenCalledWith('set_post_archived', {
      p_post_id: 'p1',
      p_archived: archived,
    });
  });

  it('resolves to the server stamp, or null once unarchived', async () => {
    mockRpc.mockResolvedValue({
      data: { postId: 'p1', archivedAt: '2026-09-24T12:00:00Z' },
      error: null,
    });
    await expect(setPostArchived('p1', true)).resolves.toBe('2026-09-24T12:00:00Z');

    mockRpc.mockResolvedValue({ data: { postId: 'p1', archivedAt: null }, error: null });
    await expect(setPostArchived('p1', false)).resolves.toBeNull();
  });

  it('turns a known server code into words a person can act on', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'P0001: NOT_CLOSED' } });

    const failure = setPostArchived('p1', true);

    await expect(failure).rejects.toBeInstanceOf(ArchiveError);
    await expect(failure).rejects.toMatchObject({
      code: 'NOT_CLOSED',
      message: 'Only finished listings can be archived. A live listing stays in view.',
    });
  });

  it('never shows an unknown server message', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'relation "x" does not exist' } });

    await expect(setPostArchived('p1', true)).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'We couldn’t update that listing. Please try again.',
    });
  });
});
