/**
 * WHAT:  Tests for rewardChangeApi — the owner's reward status read (shape
 *        guard + block → copy), the amount RPC's refusal mapping, and the
 *        MONEY invariant that the charge call carries only the post id.
 * WHY:   Changing a live reward is a charge; the client must never send its
 *        amount with it (SECURITY_AND_TRUST §4). The amount goes through
 *        set_reward_renewal_amount, under the owner's JWT, where the lowering
 *        rule lives — and its refusals are what the owner reads, so the
 *        mapping is pinned too.
 * LINKS: src/features/payments/api/rewardChangeApi.ts;
 *        supabase/migrations/20261005130000_a_reward_can_be_changed.sql.
 */

import {
  CHANGE_REWARD_ERROR_MESSAGES,
  createRewardChangeIntent,
  fetchMyRewardStatus,
  setRewardRenewalAmount,
} from './rewardChangeApi';

const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const POST_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

const STATUS = {
  postStatus: 'active',
  mode: 'change',
  rewardId: 'r1',
  amountPence: 20000,
  capturedAt: '2026-10-01T10:00:00Z',
  feeAbsorbed: false,
  hasRecentSightings: false,
  block: null,
};

beforeEach(() => jest.clearAllMocks());

describe('fetchMyRewardStatus', () => {
  it('returns the owner’s reward status', async () => {
    mockRpc.mockResolvedValue({ data: STATUS, error: null });
    await expect(fetchMyRewardStatus(POST_ID)).resolves.toEqual({
      postStatus: 'active',
      mode: 'change',
      rewardId: 'r1',
      amountPence: 20000,
      capturedAt: '2026-10-01T10:00:00Z',
      // The server predates the term columns here: the client reads them as
      // null / false.
      termEndsAt: null,
      legacyTerm: false,
      rewardEndedAt: null,
      endedRewardPence: null,
      feeAbsorbed: false,
      hasRecentSightings: false,
      blockedMessage: null,
    });
    expect(mockRpc).toHaveBeenCalledWith('get_my_reward_status', { p_post_id: POST_ID });
  });

  it('passes the reward term through when the server sends it', async () => {
    mockRpc.mockResolvedValue({ data: { ...STATUS, termEndsAt: '2026-11-30T10:00:00Z' }, error: null });
    const status = await fetchMyRewardStatus(POST_ID);
    expect(status.termEndsAt).toBe('2026-11-30T10:00:00Z');
  });

  it('passes an ended reward through (20261006100000)', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ...STATUS,
        mode: 'add',
        rewardId: null,
        amountPence: null,
        capturedAt: null,
        rewardEndedAt: '2026-12-05T09:00:00Z',
        endedRewardPence: 20000,
      },
      error: null,
    });
    const status = await fetchMyRewardStatus(POST_ID);
    expect(status.rewardEndedAt).toBe('2026-12-05T09:00:00Z');
    expect(status.endedRewardPence).toBe(20000);
  });

  it('turns a block token into the owner-facing sentence', async () => {
    mockRpc.mockResolvedValue({ data: { ...STATUS, block: 'REFUND_PENDING' }, error: null });
    const status = await fetchMyRewardStatus(POST_ID);
    expect(status.blockedMessage).toBe(CHANGE_REWARD_ERROR_MESSAGES.REFUND_PENDING);
  });

  it('refuses a shape it does not recognise', async () => {
    mockRpc.mockResolvedValue({ data: { mode: 'sideways' }, error: null });
    await expect(fetchMyRewardStatus(POST_ID)).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });
});

describe('setRewardRenewalAmount', () => {
  it('writes the amount through the owner RPC', async () => {
    mockRpc.mockResolvedValue({ data: { amountPence: 35000 }, error: null });
    await setRewardRenewalAmount(POST_ID, 35000);
    expect(mockRpc).toHaveBeenCalledWith('set_reward_renewal_amount', {
      p_post_id: POST_ID,
      p_amount_pence: 35000,
    });
  });

  it('maps the lowering refusal to plain English', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'REWARD_LOWER_BLOCKED' } });
    await expect(setRewardRenewalAmount(POST_ID, 1000)).rejects.toMatchObject({
      code: 'REWARD_LOWER_BLOCKED',
      message: CHANGE_REWARD_ERROR_MESSAGES.REWARD_LOWER_BLOCKED,
    });
  });
});

describe('createRewardChangeIntent', () => {
  it('MONEY: sends only the post id — never an amount', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret' }, error: null });
    await expect(createRewardChangeIntent(POST_ID)).resolves.toBe('pi_secret');
    const [name, options] = mockInvoke.mock.calls[0];
    expect(name).toBe('create-payment-intent');
    expect(Object.keys(options.body)).toEqual(['postId']);
  });

  it('refuses a response with no client secret', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await expect(createRewardChangeIntent(POST_ID)).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });
});
