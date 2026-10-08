/**
 * WHAT:  Tests for the reward-guidance cache: one request per point shared by
 *        the map step's warm-up, the reward step and the post's analytics
 *        line; a settled answer readable synchronously; a failure never
 *        remembered and never thrown.
 * WHY:   2026-10-08 — the guidance used to pop in above the reward slider a
 *        beat after the step arrived. It is now asked for when the map pin
 *        settles, so the reward step can start from it.
 * LINKS: ./bountyGuidanceApi.ts; ../hooks/useBountyGuidance.ts;
 *        ../components/postSteps.tsx (LastSeenWhereStep, BountyStep).
 */

import {
  fetchBountyGuidance,
  peekBountyGuidance,
  resetBountyGuidanceCache,
  warmBountyGuidance,
} from './bountyGuidanceApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const PAYLOAD = {
  rungs: [{ bounty_pence: 10000, reach: 12 }],
  local: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetBountyGuidanceCache();
  mockRpc.mockResolvedValue({ data: PAYLOAD, error: null });
});

describe('bounty guidance cache', () => {
  it('a warm-up and the step after it share ONE request', async () => {
    warmBountyGuidance(53.4794, -2.2453);
    const guidance = await fetchBountyGuidance(53.4794, -2.2453);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(guidance.rungs).toEqual([{ bountyPence: 10000, reach: 12 }]);
  });

  it('a settled answer can be read synchronously — the step starts from it', async () => {
    expect(peekBountyGuidance(53.4794, -2.2453)).toBeUndefined();
    await fetchBountyGuidance(53.4794, -2.2453);
    expect(peekBountyGuidance(53.4794, -2.2453)?.rungs).toHaveLength(1);
  });

  it('a failure reads as "nothing to say", is not remembered, and is asked again', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '500' } });
    await expect(fetchBountyGuidance(53.4794, -2.2453)).resolves.toEqual({ rungs: [], local: null });
    expect(peekBountyGuidance(53.4794, -2.2453)).toBeUndefined();

    await fetchBountyGuidance(53.4794, -2.2453);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('never throws — not even when the client throws synchronously', async () => {
    mockRpc.mockImplementationOnce(() => {
      throw new Error('misconfigured');
    });
    await expect(fetchBountyGuidance(53.4794, -2.2453)).resolves.toEqual({ rungs: [], local: null });
  });
});
