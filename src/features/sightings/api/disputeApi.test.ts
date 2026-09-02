/**
 * WHAT:  Tests for the spotter's dispute boundary — the no-oracle rule, the
 *        null-is-not-an-error decision, and the privacy of what crosses it.
 * WHY:   ⚠️ NO COVERAGE AT ALL until 2026-09-02, on the one lever a spotter has
 *        against an owner who closes a post without crediting anyone. It gates
 *        a 72-hour window on real money (ADR-0011), and every property worth
 *        having here fails SILENTLY:
 *
 *        1. **One token for every refusal.** The server answers "not yours",
 *           "window closed", "money already moved" and "already filed" with the
 *           identical DISPUTE_NOT_AVAILABLE, so that a spotter cannot probe for
 *           other people's sightings. A client that branched on anything finer
 *           would rebuild the oracle the server refuses to be.
 *        2. **null is a VALUE on the read.** DISPUTE_NOT_AVAILABLE means "there
 *           is nothing here for you", which the screen renders as the calm
 *           window-closed state. If this threw, every closed window would
 *           become "something went wrong" with a retry that can never succeed.
 *        3. **The statement is the spotter's own words**, and the sighting id
 *           is the only thing that may be logged with it.
 * LINKS: ./disputeApi.ts;
 *        supabase/migrations/20260805100000_refund_holds_and_disputes.sql;
 *        ../screens/SightingDisputeScreen.tsx (the only consumer);
 *        docs/decisions/ADR-0011-refund-holds-and-disputes.md.
 */

import { DisputeError, fetchDisputeContext, openDispute } from './disputeApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    error: (...args: unknown[]) => mockLogError(...args),
    debug: jest.fn(),
  }),
}));

const SIGHTING = 'cccc0000-0000-0000-0000-000000000001';

function context(overrides: Record<string, unknown> = {}) {
  return {
    car: { make: 'Ford', colour: 'Blue' },
    windowEndsAt: '2026-09-05T10:00:00Z',
    bountySharePence: 23750,
    dispute: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockRpc.mockReset();
  mockLogInfo.mockReset();
  mockLogWarn.mockReset();
  mockLogError.mockReset();
});

describe('fetchDisputeContext', () => {
  it('maps the payload the screen is allowed to see', async () => {
    mockRpc.mockResolvedValue({ data: context(), error: null });

    await expect(fetchDisputeContext(SIGHTING)).resolves.toEqual({
      car: { make: 'Ford', colour: 'Blue' },
      windowEndsAt: '2026-09-05T10:00:00Z',
      bountySharePence: 23750,
      dispute: null,
    });
    expect(mockRpc).toHaveBeenCalledWith('my_dispute_context', { p_sighting_id: SIGHTING });
  });

  it('⚠️ returns null — not a throw — when the server says NOT_AVAILABLE', async () => {
    // The screen renders this as the calm window-closed state. A throw would
    // turn every closed window into "something went wrong" behind a retry
    // button that can never succeed.
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'DISPUTE_NOT_AVAILABLE', code: 'P0001' },
    });

    await expect(fetchDisputeContext(SIGHTING)).resolves.toBeNull();
  });

  it('does not distinguish "not yours" from "window closed"', async () => {
    // ⚠️ THE NO-ORACLE RULE. The server deliberately answers every refusal with
    // the same token so a spotter cannot probe for someone else's sighting; a
    // client that told them apart would rebuild the oracle in the app.
    for (const message of [
      'DISPUTE_NOT_AVAILABLE',
      'DISPUTE_NOT_AVAILABLE: window closed',
      'P0001: DISPUTE_NOT_AVAILABLE',
    ]) {
      mockRpc.mockResolvedValue({ data: null, error: { message, code: 'P0001' } });
      await expect(fetchDisputeContext(SIGHTING)).resolves.toBeNull();
    }
  });

  it('throws showable copy on a genuine failure, never the server string', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table refund_holds', code: '42501' },
    });

    const error = await fetchDisputeContext(SIGHTING).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DisputeError);
    expect((error as DisputeError).message).toBe('We couldn’t load this. Please try again.');
    expect((error as DisputeError).message).not.toContain('permission denied');
  });

  it('fails loudly on a shape drift rather than rendering a dispute with no deadline', async () => {
    // windowEndsAt drives the countdown the whole screen is built around. A
    // missing one must not render as an empty clock.
    mockRpc.mockResolvedValue({ data: { car: { make: 'Ford' } }, error: null });

    const error = await fetchDisputeContext(SIGHTING).catch((err: unknown) => err);

    expect((error as DisputeError).code).toBe('BAD_SHAPE');
    expect(mockLogError).toHaveBeenCalled();
  });

  it('drops a dispute status it does not recognise rather than trusting it', async () => {
    mockRpc.mockResolvedValue({
      data: context({ dispute: { status: 'escalated', createdAt: 'x' } }),
      error: null,
    });

    const result = await fetchDisputeContext(SIGHTING);

    // A status this client cannot render is the same as no dispute, not a
    // half-rendered one — the union is closed on purpose.
    expect(result?.dispute).toBeNull();
  });

  it('treats a missing share as null (the money has already moved)', async () => {
    mockRpc.mockResolvedValue({ data: context({ bountySharePence: null }), error: null });
    await expect(fetchDisputeContext(SIGHTING)).resolves.toMatchObject({
      bountySharePence: null,
    });
  });
});

describe('openDispute', () => {
  it('sends a trimmed statement', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await openDispute(SIGHTING, '  I saw it on the 3rd.  ');

    expect(mockRpc).toHaveBeenCalledWith('open_dispute', {
      p_sighting_id: SIGHTING,
      p_statement: 'I saw it on the 3rd.',
    });
  });

  it('sends NULL rather than an empty string when nothing was written', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await openDispute(SIGHTING, '   ');

    // The statement is optional; '' would store an empty row for a human
    // reviewer to puzzle over.
    expect(mockRpc).toHaveBeenCalledWith('open_dispute', {
      p_sighting_id: SIGHTING,
      p_statement: null,
    });
  });

  it('turns the single refusal token into calm copy', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'DISPUTE_NOT_AVAILABLE', code: 'P0001' },
    });

    const error = await openDispute(SIGHTING, 'please').catch((err: unknown) => err);

    expect((error as DisputeError).code).toBe('DISPUTE_NOT_AVAILABLE');
    // "may have closed" — hedged deliberately, because this client genuinely
    // does not know which refusal it was, and must not imply it does.
    expect((error as DisputeError).message).toBe(
      'This one can’t be contested any more — the window may have closed.',
    );
  });

  it('distinguishes a transient failure from a refusal', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network', code: '08006' } });

    const error = await openDispute(SIGHTING, 'please').catch((err: unknown) => err);

    // Different copy AND a different code: one is "you cannot", the other is
    // "try again", and telling a spotter their window closed when the network
    // blipped would cost them a real bounty.
    expect((error as DisputeError).code).toBe('08006');
    expect((error as DisputeError).message).toBe('We couldn’t send this. Please try again.');
  });

  it('⚠️ PRIVACY: never logs the spotter’s statement', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await openDispute(SIGHTING, 'I followed it to 12 Oak Street and saw the plate');

    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'DISPUTE_NOT_AVAILABLE', code: 'P0001' },
    });
    await openDispute(SIGHTING, 'I followed it to 12 Oak Street and saw the plate').catch(
      () => {},
    );

    const logged = JSON.stringify([
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogError.mock.calls,
    ]);
    expect(logged).not.toContain('Oak Street');
    // The sighting id is the one identifier this path may carry.
    expect(logged).toContain(SIGHTING);
  });
});
