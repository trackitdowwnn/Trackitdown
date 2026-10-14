/**
 * WHAT:  Tests for the +native-intent hook — Stripe's 3D Secure return.
 * WHY:   This runs on EVERY link the system hands the app. Getting it wrong
 *        either way is bad: miss Stripe's return and the "unmatched route"
 *        screen lands on top of a payment; catch too much and a sign-in or
 *        payouts link goes nowhere. And it must never throw.
 * LINKS: ./stripeReturn.ts; src/app/+native-intent.tsx.
 */

import { redirectSystemPath } from './stripeReturn';

const mockHandleURLCallback = jest.fn();
jest.mock('@stripe/stripe-react-native', () => ({
  handleURLCallback: (url: string) => mockHandleURLCallback(url),
}));

beforeEach(() => {
  mockHandleURLCallback.mockReset();
  mockHandleURLCallback.mockResolvedValue(true);
});

describe('redirectSystemPath', () => {
  it('⚠️ hands Stripe its return and STAYS on the payment (no redirect)', async () => {
    const url = 'trackitdown://stripe-redirect?payment_intent=pi_1';
    await expect(redirectSystemPath({ path: url, initial: false })).resolves.toBeNull();
    expect(mockHandleURLCallback).toHaveBeenCalledWith(url);
  });

  it('a cold start on Stripe’s return goes home — there is nowhere to stay', async () => {
    await expect(
      redirectSystemPath({ path: 'trackitdown://stripe-redirect', initial: true }),
    ).resolves.toBe('/');
  });

  it('⚠️ every other link passes through untouched, Stripe never consulted', async () => {
    for (const path of ['trackitdown://payouts?onboarding=complete', '/post/abc', 'trackitdown://auth']) {
      await expect(redirectSystemPath({ path, initial: false })).resolves.toBe(path);
    }
    expect(mockHandleURLCallback).not.toHaveBeenCalled();
  });

  it('⚠️ never throws, even when Stripe does', async () => {
    mockHandleURLCallback.mockRejectedValue(new Error('native module missing'));
    await expect(
      redirectSystemPath({ path: 'trackitdown://stripe-redirect', initial: false }),
    ).resolves.toBeNull();
  });
});
