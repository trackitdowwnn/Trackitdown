/**
 * WHAT:  Tests for useBountyPayment — the three-way outcome mapping over Stripe's
 *        PaymentSheet: 'paid' on success, 'cancelled' when the user dismisses the
 *        sheet (PaymentSheetError.Canceled), and 'failed' on an init error or a
 *        decline. Also that a failed init never presents the sheet.
 * WHY:   The wizard branches entirely on this coarse outcome (route on paid /
 *        keep the wizard with a calm retry line on cancelled / show a retry
 *        message on failed), so the mapping from Stripe's SDK shape is the
 *        contract worth pinning. Never throws — always resolves an outcome.
 * LINKS: src/features/payments/hooks/useBountyPayment.ts, docs/TESTING.md.
 */

import { renderHook } from '@testing-library/react-native';

import { useBountyPayment } from './useBountyPayment';

const mockInit = jest.fn();
const mockPresent = jest.fn();
// Stripe initialises after the screen's transition (2026-10-07), so the
// sheet must wait for it — pinned by call order below.
const mockEnsureReady = jest.fn(async () => {});
jest.mock('../lib/stripeReady', () => ({ ensureStripeReady: () => mockEnsureReady() }));
jest.mock('@stripe/stripe-react-native', () => ({
  PaymentSheetError: { Canceled: 'Canceled' },
  useStripe: () => ({ initPaymentSheet: mockInit, presentPaymentSheet: mockPresent }),
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEnsureReady.mockResolvedValue(undefined);
});

async function payBounty() {
  const { result } = await renderHook(() => useBountyPayment());
  return result.current.payBounty;
}

describe('useBountyPayment', () => {
  it('waits for Stripe to be initialised before opening the sheet', async () => {
    mockInit.mockResolvedValue({ error: undefined });
    mockPresent.mockResolvedValue({ error: undefined });

    await (await payBounty())('secret');
    expect(mockEnsureReady.mock.invocationCallOrder[0]).toBeLessThan(
      mockInit.mock.invocationCallOrder[0],
    );
  });

  it('a failed Stripe init is a retryable failure, and no sheet opens', async () => {
    mockEnsureReady.mockRejectedValue(new Error('native init failed'));

    const result = await (await payBounty())('secret');
    expect(result.outcome).toBe('failed');
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('returns "paid" when the sheet completes', async () => {
    mockInit.mockResolvedValue({ error: undefined });
    mockPresent.mockResolvedValue({ error: undefined });

    await expect((await payBounty())('secret')).resolves.toEqual({ outcome: 'paid', message: null });
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentClientSecret: 'secret' }),
    );
  });

  it('returns "cancelled" when the user dismisses the sheet', async () => {
    mockInit.mockResolvedValue({ error: undefined });
    mockPresent.mockResolvedValue({ error: { code: 'Canceled', message: 'x' } });

    await expect((await payBounty())('secret')).resolves.toEqual({
      outcome: 'cancelled',
      message: null,
    });
  });

  it('returns "failed" with a retry message on a decline', async () => {
    mockInit.mockResolvedValue({ error: undefined });
    mockPresent.mockResolvedValue({ error: { code: 'Failed', message: 'card declined' } });

    const result = await (await payBounty())('secret');
    expect(result.outcome).toBe('failed');
    expect(result.message).toMatch(/try again/i);
  });

  it('returns "failed" and never presents the sheet when init fails', async () => {
    mockInit.mockResolvedValue({ error: { code: 'Failed', message: 'bad secret' } });

    const result = await (await payBounty())('secret');
    expect(result.outcome).toBe('failed');
    expect(mockPresent).not.toHaveBeenCalled();
  });
});
