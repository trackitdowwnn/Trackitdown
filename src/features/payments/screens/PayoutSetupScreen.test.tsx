/**
 * WHAT:  Tests for the payout-setup wizard and its host — the three steps, the
 *        review, and the one send.
 * WHY:   It replaced a single eleven-field form (2026-10-13), and the old
 *        form's promises have to survive the move: nothing reaches Stripe
 *        before "Send my details" (the prefill window), the terms are shown
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
const mockFirstName = jest.fn();
jest.mock('../api/payoutsApi', () => ({
  submitPayoutTokens: (...args: unknown[]) => mockSubmitTokens(...args),
  fetchMyFirstName: () => mockFirstName(),
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

/** Every step answered, ending on the last one — the bank, and the send.
 *  (Three screens since PR6: the review folded into the bank step.) */
async function walkToSend(view: View) {
  await type(view, 'payout-first-name', 'Ada');
  await type(view, 'payout-last-name', 'Lovelace');
  await type(view, 'payout-dob', '01041990');
  await type(view, 'payout-phone', '07700 900123');
  await next(view);
  await type(view, 'payout-postcode', 'm11aa');
  await type(view, 'payout-address-1', '12 Bridge Street');
  await type(view, 'payout-city', 'Manchester');
  await next(view);
  await type(view, 'payout-sort-code', '108800');
  await type(view, 'payout-account-number', '00012345');
  await type(view, 'payout-confirm-account-number', '00012345');
}

async function send(view: View) {
  await waitForSubmitArm();
  await act(async () => {
    fireEvent.press(view.getByText('Send my details'));
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
  mockFirstName.mockResolvedValue(null);
});

describe('the steps', () => {
  it('⚠️ three screens, not four: about you → address → bank, which sends', async () => {
    // Owner: "setup feels long" (2026-10-14). The review folded into the bank
    // step; there is no fourth screen to reach.
    const view = await render(<PayoutSetupScreen />);
    expect(view.getByText('Who are we paying?')).toBeTruthy();

    await walkToSend(view);

    expect(view.getByText('Where should your reward go?')).toBeTruthy();
    expect(view.getByText('Check and send')).toBeTruthy();
    expect(view.getByText('Send my details')).toBeTruthy();
    expect(view.queryByText('Next')).toBeNull();
  });

  it('says where they are and how long is left, on every step', async () => {
    const view = await render(<PayoutSetupScreen />);
    expect(view.getByText('Step 1 of 3 · about a minute')).toBeTruthy();
    await type(view, 'payout-first-name', 'Ada');
    await type(view, 'payout-last-name', 'Lovelace');
    await type(view, 'payout-dob', '01041990');
    await type(view, 'payout-phone', '07700 900123');
    await next(view);
    expect(view.getByText('Step 2 of 3 · under a minute left')).toBeTruthy();
  });

  it('starts the first name from their profile — a suggestion they can change', async () => {
    mockFirstName.mockResolvedValue('Ada');
    const view = await render(<PayoutSetupScreen />);
    await waitFor(() => expect(view.getByTestId('payout-first-name').props.value).toBe('Ada'));

    await type(view, 'payout-first-name', 'Augusta');
    expect(view.getByTestId('payout-first-name').props.value).toBe('Augusta');
  });

  it('⚠️ never puts the suggestion over what they already typed', async () => {
    let resolve: (name: string) => void = () => {};
    mockFirstName.mockReturnValue(new Promise<string>((r) => (resolve = r)));
    const view = await render(<PayoutSetupScreen />);
    await type(view, 'payout-first-name', 'Augusta');
    await act(async () => {
      resolve('Ada');
    });
    expect(view.getByTestId('payout-first-name').props.value).toBe('Augusta');
  });

  it('asks for the postcode first, in capitals, and only a UK one', async () => {
    const view = await render(<PayoutSetupScreen />);
    await type(view, 'payout-first-name', 'Ada');
    await type(view, 'payout-last-name', 'Lovelace');
    await type(view, 'payout-dob', '01041990');
    await type(view, 'payout-phone', '07700 900123');
    await next(view);

    // First in the step, as the phone's autofill expects.
    const inputs = view.getAllByTestId(/^payout-(postcode|address-1|address-2|city)$/);
    expect(inputs[0]?.props.testID).toBe('payout-postcode');

    await type(view, 'payout-postcode', 'sw1a1aa');
    expect(view.getByTestId('payout-postcode').props.value).toBe('SW1A1AA');

    await type(view, 'payout-postcode', '12345');
    await act(async () => {
      fireEvent(view.getByTestId('payout-postcode'), 'blur');
    });
    expect(view.getByText('Enter a UK postcode, like M1 1AA')).toBeTruthy();
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
    await type(view, 'payout-phone', '07700 900123');
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
    await type(view, 'payout-phone', '07700 900123');
    await next(view);
    await type(view, 'payout-address-1', '12 Bridge Street');
    await type(view, 'payout-city', 'Manchester');
    await type(view, 'payout-postcode', 'M1 1AA');
    await next(view);
    await type(view, 'payout-sort-code', '108800');
    await type(view, 'payout-account-number', '00012345');
    await type(view, 'payout-confirm-account-number', '00012354');
    // ⚠️ SAID WHILE THE BOX IS STILL FOCUSED (code review, 2026-10-13): a tap
    // on the disabled button blurs nothing, so waiting for a blur left the
    // refusal unexplained. Full length counts as finished.
    expect(view.getByText('These don’t match — check both')).toBeTruthy();
    await send(view);

    // Nothing leaves while they don't match.
    expect(mockIdentityToken).not.toHaveBeenCalled();
    expect(mockSubmitTokens).not.toHaveBeenCalled();
  });

  it('…and says an impossible date the moment it is complete', async () => {
    const view = await render(<PayoutSetupScreen />);
    await type(view, 'payout-dob', '31022000');
    expect(view.getByText('Use the format DD/MM/YYYY')).toBeTruthy();
  });
});

describe('check and send — on the bank step (PR6)', () => {
  it('checks the other two steps in one place', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);

    expect(view.getByText('Ada Lovelace · born 01/04/1990 · 07700 900123')).toBeTruthy();
    expect(view.getByText('12 Bridge Street, Manchester, M11AA')).toBeTruthy();
  });

  it('Edit goes to that step, and "Done" comes straight back to send', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('payout-summary-address-edit'));
    });
    expect(view.getByText('Where do you live?')).toBeTruthy();
    await type(view, 'payout-city', 'Salford');
    await act(async () => {
      fireEvent.press(view.getByText('Done'));
    });

    expect(view.getByText('Where should your reward go?')).toBeTruthy();
    expect(view.getByText('12 Bridge Street, Salford, M11AA')).toBeTruthy();
    // The bank they'd typed is still there.
    expect(view.getByTestId('payout-sort-code').props.value).toBe('10-88-00');
  });

  it('⚠️ shows the terms FIRST on the step that sends — "Send" is the acceptance', async () => {
    // The identity token attests the terms were SHOWN. The send button is
    // pinned, so the terms open the step (on screen on arrival, with it),
    // never below fields they could be scrolled past.
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);

    const order = view.getAllByTestId(/^payout-(terms|sort-code)$/).map((n) => n.props.testID);
    expect(order).toEqual(['payout-terms', 'payout-sort-code']);
    expect(view.getByText('Stripe Connected Account Agreement')).toBeTruthy();
    // Saying "done" and then showing an ID check would be a bait and switch.
    expect(view.getByText(/may be asked to verify your identity/i)).toBeTruthy();
  });

  it('labels sit ABOVE every box, hint first (owner, 2026-10-16: "all over the place")', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);
    // A floating label carries no hint on the input; a label above does.
    expect(view.getByTestId('payout-sort-code').props.accessibilityHint).toBe('6 digits');
    expect(view.getByTestId('payout-account-number').props.accessibilityHint).toBe('8 digits');
    expect(view.getByTestId('payout-confirm-account-number').props.accessibilityLabel).toBe(
      'Confirm account number',
    );
  });

  it('⚠️ names no payment provider — except the agreement, which the law needs', async () => {
    // Owner request (2026-10-13): no "Stripe" in the app's own words. The one
    // exception is the Connected Account Agreement's name: the identity token
    // attests it was shown, so its link must say what it is.
    const view = await render(<PayoutSetupScreen />);
    const named = () =>
      view
        .queryAllByText(/Stripe/)
        .map((node) => String(node.props.children))
        .filter((text) => text !== 'Stripe Connected Account Agreement');

    expect(named()).toEqual([]);
    await walkToSend(view);
    expect(named()).toEqual([]);
    // Not vacuous: the query does see the one name allowed to stay.
    expect(view.queryAllByText(/Stripe/).length).toBeGreaterThan(0);
  });

  it('⚠️ says "never store", never "never see"', async () => {
    // "Never see" is the claim a regulator would test hardest, and it was
    // false for the server-side route this app used to take.
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);

    expect(view.getByText(/never store them/i)).toBeTruthy();
    expect(view.queryByText(/never see/i)).toBeNull();
  });
});

describe('the send', () => {
  it('⚠️ reaches Stripe only on "Send my details" — the prefill window', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);

    expect(mockIdentityToken).not.toHaveBeenCalled();
    expect(mockBankToken).not.toHaveBeenCalled();
    expect(mockSubmitTokens).not.toHaveBeenCalled();
  });

  it('tokenises on the phone and sends only the two ids', async () => {
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);
    await send(view);

    await waitFor(() => expect(mockSubmitTokens).toHaveBeenCalled());
    expect(mockIdentityToken).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Ada',
        lastName: 'Lovelace',
        // Stripe's YYYY-MM-DD, from the DD/MM/YYYY they typed.
        dob: '1990-04-01',
        // The international form Stripe takes, from "07700 900123".
        phone: '+447700900123',
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
    await walkToSend(view);
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
    await walkToSend(view);
    await send(view);

    await waitFor(() => expect(view.getByText(/Those details couldn’t be accepted/)).toBeTruthy());
    expect(view.getByText(/go back for another way to set up/)).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockSubmitTokens).not.toHaveBeenCalled();
    expect(view.getByTestId('payout-account-number').props.value).toBe('00012345');
    // …and should they give up, Payouts offers Stripe's own route.
    expect(takePayoutSetupOutcome('user-1')).toBe('rejected');
  });

  it('…and a retry that then goes through is what Payouts hears', async () => {
    mockIdentityToken
      .mockRejectedValueOnce(new PaymentError('No.', 'DETAILS_REJECTED'))
      .mockResolvedValue('accttok_test_2');
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);
    await send(view);
    await waitFor(() => expect(view.getByText(/couldn’t be accepted/)).toBeTruthy());

    await send(view);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(takePayoutSetupOutcome('user-1')).toBe('submitted');
  });

  it('⚠️ an account that already existed is never celebrated as a new one', async () => {
    // The server kept nothing it was sent; "rewards go to your new account"
    // would be a promise about money that isn't true.
    mockSubmitTokens.mockResolvedValue('already_exists');
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);
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
    await walkToSend(view);
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
    await walkToSend(view);
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
    await walkToSend(view);
    await send(view);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());

    expect(takePayoutSetupOutcome('someone-else')).toBeNull();
    // …and the take drops it: it is not waiting for user-1 either.
    expect(takePayoutSetupOutcome('user-1')).toBeNull();
  });

  it('any other failure stays put, answers intact, with a message to retry on', async () => {
    mockSubmitTokens.mockRejectedValue(new Error('network'));
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);
    await send(view);

    await waitFor(() =>
      expect(view.getByText('We couldn’t send your details. Please try again.')).toBeTruthy(),
    );
    expect(mockBack).not.toHaveBeenCalled();
    expect(takePayoutSetupOutcome('user-1')).toBeNull();
    // Still on the last step, with what they typed.
    expect(view.getByTestId('payout-sort-code').props.value).toBe('10-88-00');
  });

  it('⚠️ logs nothing they typed when a send fails', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {}),
    );
    mockSubmitTokens.mockRejectedValue(
      new PaymentError('Something went wrong.', 'STRIPE_ERROR'),
    );
    const view = await render(<PayoutSetupScreen />);
    await walkToSend(view);
    await send(view);
    await waitFor(() => expect(view.getByText('Something went wrong.')).toBeTruthy());

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const typed of ['Lovelace', '1990', '108800', '00012345', 'Bridge', 'M1 1AA']) {
      expect(logged).not.toContain(typed);
    }
    spies.forEach((spy) => spy.mockRestore());
  });
});
