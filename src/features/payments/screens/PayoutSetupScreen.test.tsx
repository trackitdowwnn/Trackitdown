/**
 * WHAT:  Tests for the payout-setup wizard and its host — the three steps, the
 *        review, and the one send.
 * WHY:   It replaced a single eleven-field form (2026-10-13), and the old
 *        form's promises have to survive the move: nothing reaches Stripe
 *        before "Send to Stripe" (the prefill window), the terms are shown
 *        before that button (a legal claim), nothing typed is logged, a failed
 *        send keeps every answer, and a refusal our fields can't fix sends the
 *        spotter back to Payouts with a way past.
 * LINKS: ./PayoutSetupScreen.tsx; ../lib/payoutSetupFlow.tsx;
 *        ../components/payoutSetupSteps.tsx; ../lib/payoutSetupOutcome.ts.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { PaymentError } from '@/shared/lib/functionError';

import { takePayoutSetupOutcome } from '../lib/payoutSetupOutcome';
import { PayoutSetupScreen } from './PayoutSetupScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: jest.fn(),
    replace: mockReplace,
    canGoBack: () => mockCanGoBack(),
  }),
}));

const mockSession = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession(),
}));

const mockGetUser = jest.fn();

const mockShowToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    get useToast() {
      return () => ({ show: mockShowToast });
    },
  };
});

jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      getUser: () => mockGetUser(),
    },
  },
}));

const mockSubmitTokens = jest.fn();
jest.mock('../api/payoutsApi', () => ({
  submitPayoutTokens: (...args: unknown[]) => mockSubmitTokens(...args),
}));

const mockIdentityToken = jest.fn();
const mockBankToken = jest.fn();
jest.mock('../api/stripeTokens', () => ({
  createIdentityToken: (...args: unknown[]) => mockIdentityToken(...args),
  createBankToken: (...args: unknown[]) => mockBankToken(...args),
}));

type View = Awaited<ReturnType<typeof render>>;

const type = async (view: View, testID: string, value: string) => {
  await act(async () => {
    fireEvent.changeText(view.getByTestId(testID), value);
  });
};

const next = async (view: View) => {
  await act(async () => {
    fireEvent.press(view.getByText('Next'));
  });
};

/** The submitting screen ignores its button for a moment after arriving
 *  (useWizardController's SUBMIT_ARM_MS); wait as a person would. */
const waitForSubmitArm = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });

/** Every step answered, ending on the review screen. */
async function walkToReview(view: View) {
  await type(view, 'payout-first-name', 'Ada');
  await type(view, 'payout-last-name', 'Lovelace');
  await type(view, 'payout-dob', '01041990');
  await next(view);
  await type(view, 'payout-address-1', '12 Bridge Street');
  await type(view, 'payout-city', 'Manchester');
  await type(view, 'payout-postcode', 'M1 1AA');
  await next(view);
  await type(view, 'payout-sort-code', '108800');
  await type(view, 'payout-account-number', '00012345');
  await type(view, 'payout-confirm-account-number', '00012345');
  await next(view);
}

async function send(view: View) {
  await waitForSubmitArm();
  await act(async () => {
    fireEvent.press(view.getByText('Send to Stripe'));
  });
}

beforeEach(() => {
  // These walk the steps faster than any thumb; each move otherwise locks
  // navigation for its transition.
  jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
  jest.clearAllMocks();
  takePayoutSetupOutcome(null);
  mockCanGoBack.mockReturnValue(true);
  mockSession.mockReturnValue({ status: 'signedIn', userId: 'user-1' });
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'ada@example.com' } },
    error: null,
  });
  mockIdentityToken.mockResolvedValue('accttok_test_1');
  mockBankToken.mockResolvedValue('btok_test_1');
  mockSubmitTokens.mockResolvedValue('submitted');
});

describe('the steps', () => {
  it('walks about you → address → bank → check and send', async () => {
    const view = await render(<PayoutSetupScreen />);
    expect(view.getByText('Who are we paying?')).toBeTruthy();

    await walkToReview(view);

    expect(view.getByText('Check and send')).toBeTruthy();
    expect(view.getByText('Send to Stripe')).toBeTruthy();
  });

  it('stays on a step until it is answered', async () => {
    const view = await render(<PayoutSetupScreen />);
    await next(view);
    expect(view.getByText('Who are we paying?')).toBeTruthy();
    expect(view.queryByText('Where do you live?')).toBeNull();
  });

  it('says what is wrong once a field is left, and stops as soon as it is edited', async () => {
    const view = await render(<PayoutSetupScreen />);
    await type(view, 'payout-dob', '3102');
    await act(async () => {
      fireEvent(view.getByTestId('payout-dob'), 'blur');
    });
    expect(view.getByText('Use the format DD/MM/YYYY')).toBeTruthy();

    await type(view, 'payout-dob', '310');
    expect(view.queryByText('Use the format DD/MM/YYYY')).toBeNull();
  });

  it('types the separators: 12-34-56 and DD/MM/YYYY', async () => {
    const view = await render(<PayoutSetupScreen />);
    await type(view, 'payout-dob', '01041990');
    expect(view.getByTestId('payout-dob').props.value).toBe('01/04/1990');

    await type(view, 'payout-first-name', 'Ada');
    await type(view, 'payout-last-name', 'Lovelace');
    await next(view);
    await type(view, 'payout-address-1', '12 Bridge Street');
    await type(view, 'payout-city', 'Manchester');
    await type(view, 'payout-postcode', 'M1 1AA');
    await next(view);
    await type(view, 'payout-sort-code', '108800');
    expect(view.getByTestId('payout-sort-code').props.value).toBe('10-88-00');
  });

  it('catches mismatched account numbers before the review', async () => {
    const view = await render(<PayoutSetupScreen />);
    await type(view, 'payout-first-name', 'Ada');
    await type(view, 'payout-last-name', 'Lovelace');
    await type(view, 'payout-dob', '01041990');
    await next(view);
    await type(view, 'payout-address-1', '12 Bridge Street');
    await type(view, 'payout-city', 'Manchester');
    await type(view, 'payout-postcode', 'M1 1AA');
    await next(view);
    await type(view, 'payout-sort-code', '108800');
    await type(view, 'payout-account-number', '00012345');
    await type(view, 'payout-confirm-account-number', '00012354');
    // ⚠️ SAID WHILE THE BOX IS STILL FOCUSED (code review, 2026-10-13): a tap
    // on the disabled Next blurs nothing, so waiting for a blur left the
    // refusal unexplained. Full length counts as finished.
    expect(view.getByText('These don’t match — check both')).toBeTruthy();
    await next(view);

    expect(view.queryByText('Check and send')).toBeNull();
  });

  it('…and says an impossible date the moment it is complete', async () => {
    const view = await render(<PayoutSetupScreen />);
    await type(view, 'payout-dob', '31022000');
    expect(view.getByText('Use the format DD/MM/YYYY')).toBeTruthy();
  });
});

describe('the review', () => {
  it('confirms the account by its last four, never the whole number', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);

    expect(view.getByText('Sort code 10-88-00 · account ending 2345')).toBeTruthy();
    expect(view.queryByText(/00012345/)).toBeNull();
  });

  it('shows the terms before the button — "Send" is the acceptance', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);

    expect(view.getByTestId('payout-terms')).toBeTruthy();
    expect(view.getByText('Stripe Connected Account Agreement')).toBeTruthy();
    // Saying "done" and then showing Stripe's check would be a bait and switch.
    expect(view.getByText(/may ask to verify your identity/i)).toBeTruthy();
  });

  it('⚠️ says "never store", never "never see"', async () => {
    // "Never see" is the claim a regulator would test hardest, and it was
    // false for the server-side route this app used to take.
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);

    expect(view.getByText(/never store them/i)).toBeTruthy();
    expect(view.queryByText(/never see/i)).toBeNull();
  });
});

describe('the send', () => {
  it('⚠️ reaches Stripe only on "Send to Stripe" — the prefill window', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);

    expect(mockIdentityToken).not.toHaveBeenCalled();
    expect(mockBankToken).not.toHaveBeenCalled();
    expect(mockSubmitTokens).not.toHaveBeenCalled();
  });

  it('tokenises on the phone and sends only the two ids', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);

    await waitFor(() => expect(mockSubmitTokens).toHaveBeenCalled());
    expect(mockIdentityToken).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Ada',
        lastName: 'Lovelace',
        // Stripe's YYYY-MM-DD, from the DD/MM/YYYY they typed.
        dob: '1990-04-01',
        // Digits, not the dashes on screen.
        sortCode: '108800',
        accountNumber: '00012345',
      }),
      'ada@example.com',
    );
    expect(mockSubmitTokens).toHaveBeenCalledWith({
      accountToken: 'accttok_test_1',
      bankToken: 'btok_test_1',
    });
  });

  it('goes back to Payouts having left "submitted" for it', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(takePayoutSetupOutcome('user-1')).toBe('submitted');
  });

  it('⚠️ a refusal STAYS, answers intact — a typo reads exactly like one', async () => {
    // Ejecting on the first refusal discarded eleven answers and offered the
    // one path that can't be undone (security review, 2026-10-13).
    mockIdentityToken.mockRejectedValue(
      new PaymentError('Stripe couldn’t accept those details.', 'DETAILS_REJECTED'),
    );
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);

    await waitFor(() => expect(view.getByText(/Stripe couldn’t accept those details/)).toBeTruthy());
    expect(view.getByText(/go back for another way to set up/)).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockSubmitTokens).not.toHaveBeenCalled();
    expect(view.getByText('Sort code 10-88-00 · account ending 2345')).toBeTruthy();
    // …and should they give up, Payouts offers Stripe's own route.
    expect(takePayoutSetupOutcome('user-1')).toBe('rejected');
  });

  it('…and a retry that then goes through is what Payouts hears', async () => {
    mockIdentityToken
      .mockRejectedValueOnce(new PaymentError('No.', 'DETAILS_REJECTED'))
      .mockResolvedValue('accttok_test_2');
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);
    await waitFor(() => expect(view.getByText(/Stripe couldn’t accept/)).toBeTruthy());

    await send(view);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(takePayoutSetupOutcome('user-1')).toBe('submitted');
  });

  it('⚠️ an account that already existed is never celebrated as a new one', async () => {
    // The server kept nothing it was sent; "rewards go to your new account"
    // would be a promise about money that isn't true.
    mockSubmitTokens.mockResolvedValue('already_exists');
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/already set up.*Update bank details/));
    // Payouts still re-reads, to say where things actually stand.
    expect(takePayoutSetupOutcome('user-1')).toBe('submitted');
  });

  it('⚠️ a deep link with nothing beneath still has a way out — to Payouts', async () => {
    // With the edge swipe off, a bare back() here would be no way out at all.
    mockCanGoBack.mockReturnValue(false);
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/payouts'));
    expect(mockBack).not.toHaveBeenCalled();
    // Payouts' first focus picks the outcome up.
    expect(takePayoutSetupOutcome('user-1')).toBe('submitted');
  });

  it('sends a guest to Payouts before they type a thing', async () => {
    mockSession.mockReturnValue({ status: 'signedOut' });
    await render(<PayoutSetupScreen />);
    expect(mockReplace).toHaveBeenCalledWith('/payouts');
  });

  it('an unreachable session is a retry, not "log in again"', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('offline') });
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);

    await waitFor(() =>
      expect(view.getByText('We couldn’t send your details. Please try again.')).toBeTruthy(),
    );
    expect(view.queryByText(/log in again/)).toBeNull();
    expect(mockIdentityToken).not.toHaveBeenCalled();
  });

  it('⚠️ leaves its outcome for THIS user only', async () => {
    // Someone else signing in before Payouts next looks must not inherit it.
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());

    expect(takePayoutSetupOutcome('someone-else')).toBeNull();
    // …and the take drops it: it is not waiting for user-1 either.
    expect(takePayoutSetupOutcome('user-1')).toBeNull();
  });

  it('any other failure stays put, answers intact, with a message to retry on', async () => {
    mockSubmitTokens.mockRejectedValue(new Error('network'));
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);

    await waitFor(() =>
      expect(view.getByText('We couldn’t send your details. Please try again.')).toBeTruthy(),
    );
    expect(mockBack).not.toHaveBeenCalled();
    expect(takePayoutSetupOutcome('user-1')).toBeNull();
    // Still on review, with what they typed.
    expect(view.getByText('Sort code 10-88-00 · account ending 2345')).toBeTruthy();
  });

  it('⚠️ logs nothing they typed when a send fails', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {}),
    );
    mockSubmitTokens.mockRejectedValue(
      new PaymentError('Something went wrong.', 'STRIPE_ERROR'),
    );
    const view = await render(<PayoutSetupScreen />);
    await walkToReview(view);
    await send(view);
    await waitFor(() => expect(view.getByText('Something went wrong.')).toBeTruthy());

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const typed of ['Lovelace', '1990', '108800', '00012345', 'Bridge', 'M1 1AA']) {
      expect(logged).not.toContain(typed);
    }
    spies.forEach((spy) => spy.mockRestore());
  });
});
