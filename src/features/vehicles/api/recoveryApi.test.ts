/**
 * WHAT:  Tests for claimRecovery's `nextStep` mapping — the server names the
 *        money path and this layer must pass that name through faithfully.
 * WHY:   This mapping is the seam where a MONEY contract crosses into the
 *        client, and it silently broke once. `claim_recovery` gained a third
 *        answer, `done` (ADR-0014: a no-reward listing has no money leg, so the
 *        post is ALREADY terminal and no second call follows), while this file
 *        still read `=== 'payout' ? 'payout' : 'refund'`. `done` collapsed into
 *        `refund`, which sent every no-reward recovery into refund-recovery —
 *        a 409 on an already-terminal post — so a recovery that SUCCEEDED
 *        surfaced to the owner as an error, and the credited spotter was never
 *        told. Nothing on the server side could catch that: `claim_recovery`
 *        was correct and its SQL check passed.
 * LINKS: src/features/vehicles/api/recoveryApi.ts;
 *        supabase/migrations/20260820110000_no_bounty_listing_fee.sql
 *          (claim_recovery returns nextStep=done);
 *        src/features/vehicles/screens/RecoverPostScreen.tsx (the consumer);
 *        docs/decisions/ADR-0014-no-bounty-listings.md.
 */

import { claimRecovery } from './recoveryApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

/** Shape the RPC returns on success. */
function claimed(nextStep: string, creditedSightingId: string | null = null) {
  return { data: { postId: 'p1', creditedSightingId, nextStep }, error: null };
}

beforeEach(() => {
  mockRpc.mockReset();
});

describe('claimRecovery nextStep mapping', () => {
  it.each([
    ['payout', 'payout'],
    ['refund', 'refund'],
    // The one that regressed. MONEY: `done` must NOT become `refund` — the
    // caller uses it to decide whether to invoke a second Edge Function at all.
    ['done', 'done'],
  ])('passes the server\'s %s through as %s', async (server, expected) => {
    mockRpc.mockResolvedValue(claimed(server));

    const result = await claimRecovery('p1', null);

    expect(result.nextStep).toBe(expected);
  });

  it('falls back to refund for an unrecognised value', async () => {
    // `refund` is the safe fallback because it is the branch that re-checks
    // everything server-side; it is NOT a safe destination for `done`.
    mockRpc.mockResolvedValue(claimed('something-new'));

    const result = await claimRecovery('p1', null);

    expect(result.nextStep).toBe('refund');
  });

  it('carries the credited sighting id alongside a done claim', async () => {
    // A no-reward listing still credits a spotter — that credit IS their whole
    // reward (ADR-0014), so it must survive the mapping.
    mockRpc.mockResolvedValue(claimed('done', 'sighting-9'));

    const result = await claimRecovery('p1', 'sighting-9');

    expect(result).toEqual({ nextStep: 'done', creditedSightingId: 'sighting-9' });
  });
});
