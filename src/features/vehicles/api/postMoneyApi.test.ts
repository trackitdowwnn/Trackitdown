/**
 * WHAT:  Tests for fetchPostMoney — the owner's money for one listing via the
 *        get_post_money RPC: the parsed reply, null for "nothing to show", a
 *        thrown error on failure, and a loud failure on a shape drift.
 * WHY:   The null contract is the point: "not your listing" and "nothing paid
 *        yet" are the same answer by design, and must never be confused with a
 *        failure (which usePostMoney handles by keeping the last good answer).
 *        A reply this build cannot read must throw rather than render money
 *        copy from garbage.
 * LINKS: ./postMoneyApi.ts; ../lib/postMoney.ts (postMoneySchema);
 *        supabase/migrations/20260925110000_money_you_can_see.sql; docs/TESTING.md.
 */

import type { PostMoney } from '../lib/postMoney';
import { fetchPostMoney } from './postMoneyApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const POST_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

const reply: PostMoney = {
  kind: 'bounty_escrow',
  pricing: 'fee_on_top',
  state: 'refund_on_hold',
  headlinePence: 52500,
  rewardPence: 50000,
  serviceFeePence: 2500,
  chargedPence: 52500,
  hasCreditedSighting: false,
  paid: null,
  refund: null,
  refundHold: { expiresAt: '2026-09-28T18:00:00Z', paused: false },
};

beforeEach(() => jest.clearAllMocks());

describe('fetchPostMoney', () => {
  it('asks get_post_money for this listing and returns the parsed money', async () => {
    mockRpc.mockResolvedValue({ data: reply, error: null });

    await expect(fetchPostMoney(POST_ID)).resolves.toEqual(reply);
    expect(mockRpc).toHaveBeenCalledWith('get_post_money', { p_post_id: POST_ID });
  });

  it('returns null — not an error — when there is nothing to show', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchPostMoney(POST_ID)).resolves.toBeNull();

    mockRpc.mockResolvedValue({ data: undefined, error: null });
    await expect(fetchPostMoney(POST_ID)).resolves.toBeNull();
  });

  it('throws the RPC error rather than reporting "nothing to show"', async () => {
    const error = { code: '42501', message: 'permission denied' };
    mockRpc.mockResolvedValue({ data: null, error });

    await expect(fetchPostMoney(POST_ID)).rejects.toBe(error);
  });

  it('fails loudly on a state this build does not know', async () => {
    mockRpc.mockResolvedValue({ data: { ...reply, state: 'teleported' }, error: null });
    await expect(fetchPostMoney(POST_ID)).rejects.toThrow();
  });

  it('fails loudly on a non-integer pence amount', async () => {
    mockRpc.mockResolvedValue({ data: { ...reply, chargedPence: 525.5 }, error: null });
    await expect(fetchPostMoney(POST_ID)).rejects.toThrow();
  });
});
