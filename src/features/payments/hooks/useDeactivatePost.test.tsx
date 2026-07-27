/**
 * WHAT:  Tests for useDeactivatePost — the two-way outcome over the deactivate
 *        Edge Function: 'done' (with the server's refund figures) on success and
 *        'failed' (with a user-facing message) when the API throws. Never throws.
 * WHY:   The detail screen branches entirely on this coarse outcome (toast the
 *        exact refund + refetch on done / toast the message on failed), so the
 *        mapping — and that a PaymentError's message surfaces — is the contract
 *        worth pinning. Drives the REAL paymentsApi over a mocked Edge invoke.
 * LINKS: src/features/payments/hooks/useDeactivatePost.ts, docs/TESTING.md.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook } from '@testing-library/react-native';

import { useDeactivatePost } from './useDeactivatePost';

const mockInvoke = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

/** Build a FunctionsHttpError whose response body is the given { error, code }. */
function httpError(body: unknown): FunctionsHttpError {
  const context = { json: () => Promise.resolve(body) } as unknown as Response;
  return new FunctionsHttpError(context);
}

beforeEach(() => jest.clearAllMocks());

async function deactivate() {
  const { result } = await renderHook(() => useDeactivatePost());
  return result.current.deactivate;
}

describe('useDeactivatePost', () => {
  it('returns "done" with the server refund figures on success', async () => {
    mockInvoke.mockResolvedValue({ data: { refundedPence: 49230, feePence: 770 }, error: null });
    await expect((await deactivate())('p1')).resolves.toEqual({
      outcome: 'done',
      result: { refundedPence: 49230, feePence: 770 },
      message: null,
    });
    expect(mockInvoke).toHaveBeenCalledWith('deactivate-post', { body: { postId: 'p1' } });
  });

  it('returns "failed" with the mapped message when the function errors', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError({ error: 'raw', code: 'POST_NOT_REFUNDABLE' }),
    });
    await expect((await deactivate())('p1')).resolves.toEqual({
      outcome: 'failed',
      result: null,
      message: 'This listing can’t be deactivated for a refund.',
    });
  });
});
