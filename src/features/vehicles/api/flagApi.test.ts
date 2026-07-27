/**
 * WHAT:  Tests for flagApi — flagPost forwards ONLY the post id to the flag_post
 *        RPC (reporter_id is server-pinned), and rethrows a Supabase error.
 * WHY:   The report path is the reactive safety net behind live-on-payment; the
 *        client must never attribute a report (reporter_id is auth.uid() on the
 *        server) and must surface failures so the screen can offer a retry.
 * LINKS: src/features/vehicles/api/flagApi.ts, docs/TESTING.md.
 */

import { flagPost } from './flagApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

beforeEach(() => jest.clearAllMocks());

describe('flagPost', () => {
  it('calls flag_post with ONLY the post id (reporter is server-pinned)', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await flagPost('p1');
    expect(mockRpc).toHaveBeenCalledWith('flag_post', { p_post_id: 'p1' });
    const [, params] = mockRpc.mock.calls[0];
    expect(Object.keys(params)).toEqual(['p_post_id']); // no reporter_id from the client
  });

  it('rethrows a Supabase error', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'boom', code: 'P0001' } });
    await expect(flagPost('p1')).rejects.toMatchObject({ code: 'P0001' });
  });
});
