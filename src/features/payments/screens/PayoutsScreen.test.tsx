/**
 * WHAT:  Tests for the payouts screen — each state's copy, the browser call's
 *        exact arguments, and the two ways a single return can arrive.
 * WHY:   The redirect prefix and the double-fire are both silent failures: get
 *        the prefix wrong and Android hangs on an expired link with no way out;
 *        handle the return twice and every read doubles. Neither shows up in
 *        review, and neither is visible on iOS, which is where this will be
 *        demoed. So they are pinned here.
 * LINKS: ./PayoutsScreen.tsx; ../hooks/usePayoutAccount.ts;
 *        supabase/functions/connect-onboarding/index.ts; docs/TESTING.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';

import { PaymentError } from '@/shared/lib/functionError';
import { setPayoutSetupOutcome, takePayoutSetupOutcome } from '../lib/payoutSetupOutcome';
import { PayoutsScreen } from './PayoutsScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// The paid moment's seen-flag (paidMomentStorage).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockOpenAuth = jest.fn();
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuth(...args),
  dismissAuthSession: jest.fn(),
}));

// The Stripe SDK is a native module — importing it for real throws
// "TurboModuleRegistry … 'StripeSdk' could not be found". The onboarding
// component is rendered as a pressable stub so a test can trigger `onExit`,
// which is the only thing this screen actually does with it.
const mockLoadConnect = jest.fn(() => ({ __instance: true }));
jest.mock('@stripe/stripe-react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Text } = require('react-native');
  return {
    loadConnectAndInitialize: (...args: unknown[]) => mockLoadConnect(...(args as [])),
    ConnectComponentsProvider: ({ children }: { children: React.ReactNode }) => children,
    ConnectAccountOnboarding: ({ onExit }: { onExit: () => void }) =>
      React.createElement(Text, { testID: 'connect-onboarding', onPress: onExit }, 'onboarding'),
  };
});

const mockSetParams = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockCanGoBack = jest.fn(() => true);
let mockParams: { onboarding?: string } = {};
// The latest focus effect, so a test can play "Payouts comes back into view"
// (the setup wizard going back) by calling it.
let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: jest.fn(),
    push: mockPush,
    replace: mockReplace,
    setParams: mockSetParams,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {
    mockFocus = effect;
  },
}));

const mockRequireAuth = jest.fn();
jest.mock('@/features/auth', () => ({
  useRequireAuth: () => mockRequireAuth,
  useSession: () => ({ status: 'signedIn', userId: 'user-1' }),
}));

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

const mockStart = jest.fn();
const mockSubmitTokens = jest.fn();
const mockPendingCredit = jest.fn();
const mockLatestPayout = jest.fn();
const mockSyncAccount = jest.fn(async () => ({ needsBank: false }));
jest.mock('../api/payoutsApi', () => ({
  startConnectOnboarding: (...args: unknown[]) => mockStart(...args),
  submitPayoutTokens: (...args: unknown[]) => mockSubmitTokens(...args),
  fetchMyPendingCredit: (...args: unknown[]) => mockPendingCredit(...(args as [])),
  fetchMyLatestPayout: (...args: unknown[]) => mockLatestPayout(...(args as [])),
  syncMyPayoutAccount: (...args: unknown[]) => mockSyncAccount(...(args as [])),
}));

// The bounded re-checks run on a ten-second timer these tests never advance;
// `spent` is what the screen reads from them, so it is set directly.
let mockPollSpent = false;
jest.mock('../hooks/usePollWhileChecking', () => ({
  usePollWhileChecking: () => ({ spent: mockPollSpent }),
}));

// The tokenisers go straight to Stripe from the device; in a test they answer
// with opaque ids, which is also all the screen ever sees of them.
const mockIdentityToken = jest.fn();
const mockBankToken = jest.fn();
jest.mock('../api/stripeTokens', () => ({
  createIdentityToken: (...args: unknown[]) => mockIdentityToken(...args),
  createBankToken: (...args: unknown[]) => mockBankToken(...args),
}));

// The screen reads the signed-in email for the identity token.
jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { email: 'ada@example.com' } } })),
    },
  },
}));

const mockSettleReturn = jest.fn();
const mockRefresh = jest.fn();
let mockAccountState: { status: string; settling: boolean; account?: unknown };
jest.mock('../hooks/usePayoutAccount', () => ({
  get usePayoutAccount() {
    return () => ({
      account: null,
      ...mockAccountState,
      refresh: mockRefresh,
      settleReturn: mockSettleReturn,
    });
  },
}));

const STRIPE_URL = 'https://connect.stripe.com/setup/abc';

/** Payouts coming back into view, as it does when the setup wizard goes back. */
const refocus = async () => {
  await act(async () => {
    mockFocus?.();
  });
};

/** A credited reward, as my_pending_credit returns it. */
const CREDIT = {
  postId: 'post-1',
  transferPence: 19000,
  underReview: false,
  creditedAt: '2026-10-12T10:00:00Z',
  car: { make: 'BMW', colour: 'Blue' },
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  // Nothing left over from a previous test's wizard.
  takePayoutSetupOutcome(null);
  mockFocus = null;
  mockParams = {};
  mockAccountState = { status: 'notStarted', settling: false };
  mockStart.mockResolvedValue({ status: 'onboarding_session', clientSecret: 'accs_secret_123' });
  mockOpenAuth.mockResolvedValue({ type: 'success', url: 'trackitdown://payouts?onboarding=complete' });
  mockCanGoBack.mockReturnValue(true);
  // The default spotter here has a bounty waiting — under credit-time setup
  // that is the ONLY person the setup card exists for. The nothing-waiting
  // case gets its own tests.
  mockPendingCredit.mockResolvedValue(CREDIT);
  mockLatestPayout.mockResolvedValue(null);
  mockIdentityToken.mockResolvedValue('accttok_test_1');
  mockBankToken.mockResolvedValue('btok_test_1');
  mockSubmitTokens.mockResolvedValue('submitted');
});

describe('⚠️ the chip, the road and the trust line (redesign, 2026-10-14)', () => {
  it.each([
    ['notStarted', 'details', 'Not set up'],
    ['unfinished', 'details', 'Action needed'],
    ['verifying', 'check', 'Being checked'],
    ['ready', 'sent', 'On its way'],
  ])('⚠️ %s: the hero’s chip says the state, the road marks the step', async (status, current, chip) => {
    // The state is legible before a word is read: the chip in the hero, and
    // the road's current marker — never a third telling of it in a title.
    mockAccountState = { status, settling: false };
    const { getByTestId, getByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByTestId(`payouts-steps-current-${current}`)).toBeTruthy();
    expect(getByTestId('payouts-chip')).toBeTruthy();
    expect(getByText(chip)).toBeTruthy();
  });

  it('marks ready as "Ready" with the chip when there is no road left to show', async () => {
    mockPendingCredit.mockResolvedValue(null);
    mockAccountState = { status: 'ready', settling: false };
    const { getByText, queryByTestId } = await act(async () => render(<PayoutsScreen />));

    expect(getByText('Ready')).toBeTruthy();
    expect(queryByTestId('payouts-steps')).toBeNull();
  });

  it('⚠️ never reads as an error, even when something is needed', async () => {
    // `danger` is deliberately unused here. A red chip on a screen about money
    // someone is owed says "your money is in trouble" when what is true is
    // "Stripe needs another field". The rejected paths render their own cards.
    mockAccountState = { status: 'unfinished', settling: false };
    const { queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(queryByText(/error|problem|failed|rejected/i)).toBeNull();
  });

  it('⚠️ says "never store", never "never see"', async () => {
    // The claim that is true. PayoutTermsNotice records the distinction:
    // the server-side route this app used to take saw the details in transit, so
    // "never see" is the sentence a regulator would quote back. This footnote
    // reintroduced it once already, within a minute of being written.
    const { getByTestId } = await act(async () => render(<PayoutsScreen />));

    expect(getByTestId('payouts-trust').props.children).toMatch(/never store/i);
    expect(getByTestId('payouts-trust').props.children).not.toMatch(/never see/i);
  });

  it('the trust line sits beside the step that takes the details — not once they’re sent', async () => {
    mockAccountState = { status: 'verifying', settling: false };
    const { queryByTestId } = await act(async () => render(<PayoutsScreen />));
    expect(queryByTestId('payouts-trust')).toBeNull();
  });
});

describe('what each state says', () => {
  it('invites a guest in rather than showing them an empty setup screen', async () => {
    mockAccountState = { status: 'guest', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));

    await act(async () => {
      fireEvent.press(getByText('Log in'));
    });
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'payouts' });
  });

  it('offers setup when a reward is waiting — the amount is the hero', async () => {
    const { getByTestId, getByText, getByLabelText } = await act(async () => render(<PayoutsScreen />));
    expect(getByTestId('payouts-journey')).toBeTruthy();
    expect(getByTestId('payouts-hero')).toBeTruthy();
    expect(getByText('£190')).toBeTruthy();
    // ⚠️ ONE accessible stop for the hero: three separate stops would deliver
    // the number without the words that give it meaning. The label pins the
    // promise rather than the layout.
    expect(
      getByLabelText(
        'You’ve earned £190, for helping find a blue BMW. Add your details to get paid. Not set up.',
      ),
    ).toBeTruthy();
  });

  it('⚠️ names the car by colour and make — never the plate', async () => {
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('for helping find a blue BMW')).toBeTruthy();
  });

  it('says NOTHING to set up when nothing is waiting — because there isn’t', async () => {
    // Credit-time setup made "no setup" literal. A never-credited spotter who
    // finds this screen (deep link, old bookmark) must not be walked into a
    // form about money that does not exist.
    mockPendingCredit.mockResolvedValue(null);
    const { getByText, queryByTestId } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Nothing to set up')).toBeTruthy();
    expect(queryByTestId('payouts-journey')).toBeNull();
    expect(queryByTestId('payouts-hero')).toBeNull();
  });

  it('tells someone mid-way that their progress is saved', async () => {
    mockAccountState = { status: 'unfinished', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Finish your details to get paid')).toBeTruthy();
    expect(getByText(/progress is saved/i)).toBeTruthy();
  });

  it('puts the waiting on our partner, never on the spotter', async () => {
    // The distinction the feature turns on: nothing is being asked of them.
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Your details are being checked')).toBeTruthy();
    expect(queryByText(/Finish your details/)).toBeNull();
    // On arrival the app is checking with Stripe itself, and says so
    // (2026-10-14); the "minutes, sometimes a day" line follows once it stops.
    expect(getByText(/Checking with our payment partner now/)).toBeTruthy();
  });

  it('⚠️ the amount stays the hero while the money moves (it used to vanish on ready)', async () => {
    mockAccountState = { status: 'ready', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('£190')).toBeTruthy();
    expect(getByText('Sending your reward')).toBeTruthy();
  });

  it('confirms when money can actually reach them', async () => {
    mockPendingCredit.mockResolvedValue(null);
    mockAccountState = { status: 'ready', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Payouts are on')).toBeTruthy();
    // Not a dead end: they can still change where the money goes.
    expect(getByText('Update bank details')).toBeTruthy();
  });

  it('⚠️ settling outranks the derived state — waiting for confirmation, never "continue"', async () => {
    mockAccountState = { status: 'unfinished', settling: true };
    const { getByText, getByTestId, queryByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText(/Waiting for confirmation/)).toBeTruthy();
    expect(getByTestId('payouts-steps-current-check-working')).toBeTruthy();
    // The derived state would have blamed them for stopping half way.
    expect(queryByText('Continue setting up')).toBeNull();
  });
});

describe('our own steps come first (the setup wizard, 2026-10-13)', () => {
  it('opens the setup wizard rather than handing straight to Stripe', async () => {
    // The window in which we may submit bank details at all closes the moment a
    // session exists, so the server says details_required until our steps run.
    mockStart.mockResolvedValue({ status: 'details_required' });
    const { getByText, queryByTestId } = await act(async () => render(<PayoutsScreen />));

    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });

    expect(mockPush).toHaveBeenCalledWith('/payout-setup');
    expect(queryByTestId('connect-onboarding')).toBeNull();
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it('arms the settling window when the wizard comes back having sent', async () => {
    // Same as a return from Stripe: until the webhook lands, someone who just
    // sent everything reads like someone who gave up.
    await act(async () => render(<PayoutsScreen />));
    setPayoutSetupOutcome('submitted', 'user-1');
    await refocus();

    expect(mockSettleReturn).toHaveBeenCalledTimes(1);
  });

  it('does nothing on an ordinary return — no outcome, no settling', async () => {
    // Backing out of the wizard, or coming back from anywhere else.
    await act(async () => render(<PayoutsScreen />));
    await refocus();

    expect(mockSettleReturn).not.toHaveBeenCalled();
  });

  it('reads an outcome once: a second return does not settle again', async () => {
    await act(async () => render(<PayoutsScreen />));
    setPayoutSetupOutcome('submitted', 'user-1');
    await refocus();
    await refocus();

    expect(mockSettleReturn).toHaveBeenCalledTimes(1);
  });

  it('offers Stripe when our steps cannot describe them', async () => {
    // A company, or a non-UK account. Our fields have no word for either, so
    // without this the spotter is gated forever behind steps that can never
    // satisfy Stripe — permanently unpayable.
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    setPayoutSetupOutcome('rejected', 'user-1');
    await refocus();

    expect(getByTestId('payouts-details-rejected')).toBeTruthy();
    mockStart.mockResolvedValue({ status: 'onboarding_session', clientSecret: 'accs_1' });
    await act(async () => {
      fireEvent.press(getByText('Set up another way'));
    });
    // Spends the prefill window deliberately, which beats being unpayable.
    expect(mockStart).toHaveBeenCalledWith({ skipPrefill: true });
  });

  it('⚠️ ignores an outcome another user left behind', async () => {
    // A stale 'rejected' would show this spotter a button that spends their
    // prefill window for good (security review, 2026-10-13).
    const { queryByTestId } = await act(async () => render(<PayoutsScreen />));
    setPayoutSetupOutcome('rejected', 'someone-else');
    await refocus();

    expect(queryByTestId('payouts-details-rejected')).toBeNull();
    expect(mockSettleReturn).not.toHaveBeenCalled();
  });

  it('⚠️ never offers "Set up another way" once details have been sent', async () => {
    // Being checked or ready: the button would have no purpose and one
    // irreversible effect. The account's own state wins.
    mockAccountState = { status: 'verifying', settling: false };
    const { queryByTestId, getByTestId } = await act(async () => render(<PayoutsScreen />));
    setPayoutSetupOutcome('rejected', 'user-1');
    await refocus();

    expect(queryByTestId('payouts-details-rejected')).toBeNull();
    expect(getByTestId('payouts-journey')).toBeTruthy();
  });

  it('…or lets them try our steps again', async () => {
    // A typo can read as a refusal too; Stripe is not the only way past.
    const { getByText, queryByTestId } = await act(async () => render(<PayoutsScreen />));
    setPayoutSetupOutcome('rejected', 'user-1');
    await refocus();

    await act(async () => {
      fireEvent.press(getByText('Try our steps again'));
    });
    expect(mockPush).toHaveBeenCalledWith('/payout-setup');
    expect(queryByTestId('payouts-details-rejected')).toBeNull();
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe('setting up — inside the app', () => {
  it('opens NO browser: setup renders in the app', async () => {
    // The whole point of the embedded component. A browser hop here was the
    // clunkiest moment in the product, at the point where someone is deciding
    // whether to trust us with their bank details.
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    await act(async () => {
      fireEvent.press(getByText('Start the check'));
    });

    expect(getByTestId('connect-onboarding')).toBeTruthy();
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it('⚠️ announces Stripe’s step before opening it — who, why, how long', async () => {
    // Stripe's own screen used to arrive unannounced, in Stripe's styling,
    // asking for things our steps hadn't — which reads as "something broke".
    const { getByText, getByTestId, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });

    expect(getByTestId('payouts-stripe-intro')).toBeTruthy();
    expect(getByText(/about two minutes/)).toBeTruthy();
    expect(queryByTestId('connect-onboarding')).toBeNull();
  });

  it('"Not now" on the heads-up goes back to where they were, with nothing opened', async () => {
    const { getByText, queryByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    await act(async () => {
      fireEvent.press(getByText('Not now'));
    });

    expect(queryByTestId('payouts-stripe-intro')).toBeNull();
    expect(queryByTestId('connect-onboarding')).toBeNull();
    expect(getByText('Add your details')).toBeTruthy();
  });

  it('no heads-up for someone who just chose "Set up another way" — that was the yes', async () => {
    const { getByText, getByTestId, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );
    setPayoutSetupOutcome('rejected', 'user-1');
    await refocus();
    await act(async () => {
      fireEvent.press(getByText('Set up another way'));
    });

    expect(queryByTestId('payouts-stripe-intro')).toBeNull();
    expect(getByTestId('connect-onboarding')).toBeTruthy();
  });

  it('settles when the component closes — exiting is not proof of anything', async () => {
    // `onExit` is exactly as much of a promise as the browser redirect was:
    // none. Someone can back out half way, and only the webhook knows.
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    await act(async () => {
      fireEvent.press(getByText('Start the check'));
    });
    mockSettleReturn.mockClear();

    await act(async () => {
      fireEvent.press(getByTestId('connect-onboarding'));
    });
    expect(mockSettleReturn).toHaveBeenCalledTimes(1);
  });
});

describe('opening Stripe in a browser (update + fallback only)', () => {
  it('passes the BARE return prefix — the query string would not match on Android', async () => {
    mockStart.mockResolvedValue({ status: 'onboarding_required', url: STRIPE_URL });
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(STRIPE_URL, 'trackitdown://payouts');
  });

  it('settles on a dismiss too — Android reports success that way', async () => {
    mockStart.mockResolvedValue({ status: 'onboarding_required', url: STRIPE_URL });
    mockOpenAuth.mockResolvedValue({ type: 'dismiss' });
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    expect(mockSettleReturn).toHaveBeenCalled();
  });

  it('opens no browser when the server says there is nothing to do', async () => {
    mockStart.mockResolvedValue({ status: 'already_enabled' });
    mockAccountState = { status: 'unfinished', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Continue setting up'));
    });
    expect(mockOpenAuth).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('explains an expired link instead of failing at them', async () => {
    mockStart.mockResolvedValue({ status: 'onboarding_required', url: STRIPE_URL });
    mockOpenAuth.mockResolvedValue({
      type: 'success',
      url: 'trackitdown://payouts?onboarding=refresh',
    });
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    expect(getByText(/link expired/i)).toBeTruthy();
  });

  it('surfaces a failure without leaving the button stuck', async () => {
    // The Android re-entry throw lands here too.
    mockStart.mockResolvedValue({ status: 'onboarding_required', url: STRIPE_URL });
    mockOpenAuth.mockRejectedValue(new Error('WebBrowser is already open'));
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
    // Back to a tappable label, not stuck on "Opening Stripe…".
    expect(getByText('Add your details')).toBeTruthy();
  });
});

describe('changing bank details — in the app, no browser', () => {
  // The browser hop this replaced was a DEAD END for legacy Express accounts:
  // Stripe refuses account_update links when it collects requirements, the
  // server fell back to already_enabled, and the button was a spinner to
  // nowhere. Found on a real phone, 2026-08-04.
  const fillBankForm = async (getByTestId: (id: string) => unknown) => {
    const type = async (id: string, value: string) => {
      await act(async () => {
        fireEvent.changeText(getByTestId(id) as never, value);
      });
    };
    await type('bank-sort-code', '10-88-00');
    await type('bank-account-number', '00012345');
    await type('bank-confirm-account-number', '00012345');
  };

  beforeEach(() => {
    mockAccountState = { status: 'ready', settling: false };
    // Nothing in flight: "Payouts are on" and its one button.
    mockPendingCredit.mockResolvedValue(null);
  });

  it('opens the three-field form, not a browser', async () => {
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Update bank details'));
    });
    expect(getByTestId('bank-details-form')).toBeTruthy();
    expect(mockOpenAuth).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('sends ONE bank token and no identity token', async () => {
    // Identity is already with Stripe; resending it would create a second
    // account. The server's RE-BANK branch keys off exactly this shape.
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Update bank details'));
    });
    await fillBankForm(getByTestId);
    await act(async () => {
      fireEvent.press(getByText('Save new account'));
    });

    // Digits only — the token must not carry the dashes someone typed.
    expect(mockBankToken).toHaveBeenCalledWith({ sortCode: '108800', accountNumber: '00012345' });
    expect(mockIdentityToken).not.toHaveBeenCalled();
    expect(mockSubmitTokens).toHaveBeenCalledWith({ bankToken: 'btok_test_1' });
    expect(mockShowToast).toHaveBeenCalledWith('Done — rewards will go to your new account.');
  });

  it('offers Stripe’s own page when the in-app change is refused', async () => {
    mockBankToken.mockRejectedValue(
      new PaymentError('Stripe couldn’t accept that bank account.', 'DETAILS_REJECTED'),
    );
    mockStart.mockResolvedValue({ status: 'update_available', url: STRIPE_URL });

    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Update bank details'));
    });
    await fillBankForm(getByTestId);
    await act(async () => {
      fireEvent.press(getByText('Save new account'));
    });
    expect(getByTestId('payouts-bank-rejected')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Update another way'));
    });
    // The server decides which surface that is: an account_update link for v2
    // accounts, a LOGIN LINK for legacy Express — either way, a browser.
    expect(mockOpenAuth).toHaveBeenCalledWith(STRIPE_URL, 'trackitdown://payouts');
  });
});

describe('the return', () => {
  it('settles from the deep link alone — iOS never navigates, but a cold start does', async () => {
    mockParams = { onboarding: 'complete' };
    const view = await act(async () => render(<PayoutsScreen />));
    expect(mockSettleReturn).toHaveBeenCalledTimes(1);

    // And exactly once, however many times the screen re-renders with the param
    // still on the URL. Guarded by a ref rather than by clearing the param,
    // which would be a navigation side effect for a problem that only exists
    // if you arrive here twice with the same query string.
    await act(async () => {
      view.rerender(<PayoutsScreen />);
    });
    expect(mockSettleReturn).toHaveBeenCalledTimes(1);
  });

  it('handles ONE return when Android fires both paths', async () => {
    // The highest-value test on the browser path. On Android
    // openAuthSessionAsync resolves AND the deep link navigates, for the same
    // single journey. settleReturn is idempotent, but the screen must not treat
    // these as two returns. Still reachable: the update flow and the
    // hosted-link fallback both go through the browser.
    mockStart.mockResolvedValue({ status: 'onboarding_required', url: STRIPE_URL });
    mockParams = { onboarding: 'complete' };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    mockSettleReturn.mockClear();

    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    // One press → one settle. The param was already consumed on mount.
    expect(mockSettleReturn).toHaveBeenCalledTimes(1);
  });

  it('shows the expired-link line when Stripe sends us back to refresh', async () => {
    mockParams = { onboarding: 'refresh' };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText(/link expired/i)).toBeTruthy();
  });
});

describe('getting out', () => {
  it('goes somewhere real when a deep link left nothing behind', async () => {
    mockCanGoBack.mockReturnValue(false);
    const { getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByTestId('payouts-back'));
    });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/profile');
  });
});

describe('the progress tracker (2026-10-13)', () => {
  it('shows where they are: details next, everything else still to come', async () => {
    const { getByTestId } = await act(async () => render(<PayoutsScreen />));

    expect(getByTestId('payouts-steps')).toBeTruthy();
    expect(getByTestId('payouts-steps-current-details')).toBeTruthy();
    expect(getByTestId('payouts-steps-upcoming-check')).toBeTruthy();
    expect(getByTestId('payouts-steps-upcoming-sent')).toBeTruthy();
    expect(getByTestId('payouts-steps-upcoming-bank')).toBeTruthy();
  });

  it('the button lives ON the step that needs it — one, not a card of its own', async () => {
    mockStart.mockResolvedValue({ status: 'details_required' });
    const { getByTestId, getAllByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByTestId('payouts-steps-current-details-action')).toBeTruthy();
    expect(getAllByText('Add your details')).toHaveLength(1);
  });

  it('puts the wait on Stripe while it checks', async () => {
    mockAccountState = { status: 'verifying', settling: false };
    const { getByTestId, getByLabelText } = await act(async () => render(<PayoutsScreen />));

    expect(getByTestId('payouts-steps-done-details')).toBeTruthy();
    expect(getByLabelText(/ID check, in progress\. Checking with our payment partner now/)).toBeTruthy();
    // ⚠️ "Some visual that something is happening" (owner, 2026-10-14): the
    // marker breathes while the app is actually checking.
    expect(getByTestId('payouts-steps-current-check-working')).toBeTruthy();
  });

  it('a spotter Stripe is waiting on gets no "checking" motion — nothing is happening until they act', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: true } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { queryByTestId } = await act(async () => render(<PayoutsScreen />));
    expect(queryByTestId('payouts-steps-current-check-working')).toBeNull();
    mockSyncAccount.mockResolvedValue({ needsBank: false });
  });

  it('says nothing when there is nothing to track', async () => {
    mockPendingCredit.mockResolvedValue(null);
    const { queryByTestId } = await act(async () => render(<PayoutsScreen />));
    expect(queryByTestId('payouts-steps')).toBeNull();
  });

  it('stays in view on the heads-up before Stripe — a step on the road, not a detour', async () => {
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    expect(getByTestId('payouts-stripe-intro')).toBeTruthy();
    expect(getByTestId('payouts-steps')).toBeTruthy();
  });
});

describe('the end of the road — a reward sent (PR2b)', () => {
  it('shows every step done, and when the reward was sent', async () => {
    mockAccountState = { status: 'ready', settling: false };
    mockPendingCredit.mockResolvedValue(null);
    mockLatestPayout.mockResolvedValue({
      transferPence: 19000,
      sentAt: '2026-10-13T11:00:00Z',
    });
    const { getByTestId, getByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByTestId('payouts-steps-done-sent')).toBeTruthy();
    expect(getByTestId('payouts-steps-current-bank')).toBeTruthy();
    expect(getByText('Sent on 13 October')).toBeTruthy();
    expect(getByText('£190')).toBeTruthy();
  });
});

describe('⚠️ the paid moment — once, then a folded road (redesign, 2026-10-14)', () => {
  const paidAccount = {
    stripeAccountId: 'acct_1',
    onboardingComplete: true,
    payoutsEnabled: true,
    bankPayout: { status: 'paid', arrivalDate: '2026-10-16', createdAt: '2026-10-14T06:00:00Z' },
    bankReplacedAt: null,
  };

  beforeEach(() => {
    mockAccountState = { status: 'ready', settling: false, account: paidAccount };
    mockPendingCredit.mockResolvedValue(null);
    mockLatestPayout.mockResolvedValue({ transferPence: 19000, sentAt: '2026-10-13T11:00:00Z' });
  });

  it('first visit: a tick, "Thanks for helping", and the whole road — done', async () => {
    const { getByTestId, getByText, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );
    expect(getByTestId('payouts-paid-moment')).toBeTruthy();
    expect(getByText('Thanks for helping')).toBeTruthy();
    expect(getByText('Paid into your bank on 16 October')).toBeTruthy();
    expect(getByTestId('payouts-steps-done-bank')).toBeTruthy();
    expect(queryByTestId('payouts-steps-expand')).toBeNull();
  });

  it('every later visit: no celebration — the road folded to one line, openable', async () => {
    const first = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      first.unmount();
    });

    const { getByTestId, getByText, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );
    expect(queryByTestId('payouts-paid-moment')).toBeNull();
    expect(getByText('Paid')).toBeTruthy();
    expect(getByText('Paid 16 October · £190')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId('payouts-steps-expand'));
    });
    expect(getByTestId('payouts-steps-done-bank')).toBeTruthy();
  });
});

describe('⚠️ no payment provider named (owner request, 2026-10-13)', () => {
  /** Every visible text node that says "Stripe". */
  const named = (view: Awaited<ReturnType<typeof render>>) =>
    view.queryAllByText(/Stripe/).map((node) => String(node.props.children));

  it.each(['notStarted', 'unfinished', 'verifying', 'ready'])('%s says "Stripe" nowhere', async (status) => {
    mockAccountState = { status, settling: false };
    const view = await act(async () => render(<PayoutsScreen />));
    expect(named(view)).toEqual([]);
  });

  it('nor while settling, on the ID-check heads-up, or on the refusal card', async () => {
    mockAccountState = { status: 'unfinished', settling: true };
    const settling = await act(async () => render(<PayoutsScreen />));
    expect(named(settling)).toEqual([]);

    mockAccountState = { status: 'notStarted', settling: false };
    const intro = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(intro.getByText('Add your details'));
    });
    expect(intro.getByTestId('payouts-stripe-intro')).toBeTruthy();
    expect(named(intro)).toEqual([]);

    const refused = await act(async () => render(<PayoutsScreen />));
    setPayoutSetupOutcome('rejected', 'user-1');
    await refocus();
    expect(refused.getByTestId('payouts-details-rejected')).toBeTruthy();
    expect(named(refused)).toEqual([]);
  });
});

describe('⚠️ checks with Stripe instead of only waiting for the webhook (2026-10-13)', () => {
  it.each(['verifying', 'unfinished'])('%s: asks the server to check with Stripe, then re-reads', async (status) => {
    mockAccountState = { status, settling: false };
    await act(async () => render(<PayoutsScreen />));
    expect(mockSyncAccount).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it.each(['notStarted', 'ready', 'guest'])('%s: nothing to check — no call', async (status) => {
    mockAccountState = { status, settling: false };
    await act(async () => render(<PayoutsScreen />));
    expect(mockSyncAccount).not.toHaveBeenCalled();
  });

  it('once per visit — and again when the screen comes back into view', async () => {
    mockAccountState = { status: 'verifying', settling: false };
    await act(async () => render(<PayoutsScreen />));
    await refocus();
    expect(mockSyncAccount).toHaveBeenCalledTimes(2);
  });

  it('pull to refresh checks with Stripe, not just our row', async () => {
    // The way past any wait — so no "Check again" button competes with the
    // road's one action (redesign, 2026-10-14).
    mockAccountState = { status: 'unfinished', settling: true };
    const { getByTestId } = await act(async () => render(<PayoutsScreen />));
    mockSyncAccount.mockClear();
    await act(async () => {
      getByTestId('screen-scroll').props.refreshControl.props.onRefresh();
    });
    expect(mockSyncAccount).toHaveBeenCalledTimes(1);
  });
});

describe('⚠️ a missing bank is asked for in our own form, not Stripe’s screen (2026-10-13)', () => {
  afterEach(() => {
    mockSyncAccount.mockResolvedValue({ needsBank: false });
  });

  it('Stripe waiting on a bank: "Add your bank account" opens the bank form — no session', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: true });
    mockAccountState = { status: 'unfinished', settling: false };
    const { getByText, getByTestId, queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByText('Add your bank account to get paid')).toBeTruthy();
    expect(queryByText('Continue setting up')).toBeNull();
    await act(async () => {
      fireEvent.press(getByText('Add your bank account'));
    });
    expect(getByTestId('bank-details-form')).toBeTruthy();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('no bank needed: the card is as before', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: false });
    mockAccountState = { status: 'unfinished', settling: false };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));
    expect(queryByText('Add your bank account to get paid')).toBeNull();
    expect(getByText('Continue setting up')).toBeTruthy();
  });
});

describe('payout experience fixes (2026-10-14)', () => {
  it('⚠️ a reward check that FAILED never says "Nothing to set up" — it offers a retry', async () => {
    mockPendingCredit.mockRejectedValueOnce(new Error('offline'));
    mockAccountState = { status: 'notStarted', settling: false };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByText('Couldn’t check for rewards')).toBeTruthy();
    expect(queryByText('Nothing to set up')).toBeNull();

    // The retry asks again — and this time there is a reward to set up for.
    mockPendingCredit.mockResolvedValueOnce({ postId: 'post-1', transferPence: 19000 });
    await act(async () => {
      fireEvent.press(getByText('Try again'));
    });
    expect(mockPendingCredit).toHaveBeenCalledTimes(2);
    expect(getByText('Add your details')).toBeTruthy();
  });

  it('nothing owed, read fine: "Nothing to set up", as before', async () => {
    mockPendingCredit.mockResolvedValue(null);
    mockAccountState = { status: 'notStarted', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Nothing to set up')).toBeTruthy();
  });

  it('while Stripe is checking there is no button — nothing for them to do', async () => {
    mockAccountState = { status: 'verifying', settling: false };
    const { queryByText } = await act(async () => render(<PayoutsScreen />));
    expect(queryByText('Add or update details')).toBeNull();
  });
});

describe('⚠️ a payout the bank refused asks for new details (2026-10-14)', () => {
  const bounced = (bankReplacedAt: string | null) => ({
    stripeAccountId: 'acct_1',
    onboardingComplete: true,
    payoutsEnabled: true,
    bankPayout: { status: 'failed', arrivalDate: '2026-10-16', createdAt: '2026-10-14T06:00:00Z' },
    bankReplacedAt,
  });

  it('on the road: the bank step needs them — "!" and "Update bank details" opens our form', async () => {
    mockPendingCredit.mockResolvedValue(null);
    mockLatestPayout.mockResolvedValue({ transferPence: 19000, sentAt: '2026-10-13T11:00:00Z' });
    mockAccountState = { status: 'ready', settling: false, account: bounced(null) };
    const { getByText, getByTestId, getByLabelText } = await act(async () =>
      render(<PayoutsScreen />),
    );

    expect(getByTestId('payouts-steps-attention-bank')).toBeTruthy();
    expect(getByLabelText(/In your bank, needs you\. .*safe and waiting for you/)).toBeTruthy();
    expect(getByText('Action needed')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Update bank details'));
    });
    expect(getByTestId('bank-details-form')).toBeTruthy();
    // Our own form — never a session at Stripe.
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('⚠️ no reward in view any more: still says so — never "Payouts are on"', async () => {
    mockPendingCredit.mockResolvedValue(null);
    mockAccountState = { status: 'ready', settling: false, account: bounced(null) };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByText('Your bank couldn’t accept it')).toBeTruthy();
    expect(queryByText('Payouts are on')).toBeNull();
    await act(async () => {
      fireEvent.press(getByText('Update bank details'));
    });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('new details since the refusal: back to "Payouts are on", no alarm', async () => {
    mockPendingCredit.mockResolvedValue(null);
    mockAccountState = {
      status: 'ready',
      settling: false,
      account: bounced('2026-10-15T09:00:00Z'),
    };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(queryByText('Your bank couldn’t accept it')).toBeNull();
    expect(getByText('Payouts are on')).toBeTruthy();
  });
});

describe('⚠️ a payout held for a check says so, never "on its way" (2026-10-14)', () => {
  it('payouts on, reward held for review: the tracker says a check, not that it moved', async () => {
    mockPendingCredit.mockResolvedValue({ ...CREDIT, underReview: true });
    mockAccountState = { status: 'ready', settling: false };
    const { getByText, queryByText, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );

    expect(getByText('A quick check before we send it')).toBeTruthy();
    expect(queryByText(/On its way/)).toBeNull();
    // Nothing for them to do: no button, and the marker doesn't pretend to work.
    expect(queryByTestId('payouts-steps-current-sent-action')).toBeNull();
    expect(queryByTestId('payouts-steps-current-sent-working')).toBeNull();
  });

  it('no check: "on its way", as before', async () => {
    mockPendingCredit.mockResolvedValue(CREDIT);
    mockAccountState = { status: 'ready', settling: false };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByText(/On its way/)).toBeTruthy();
    expect(queryByText(/A quick check before we send it/)).toBeNull();
  });
});

describe('⚠️ waiting on THEM is said plainly, never "being checked" (2026-10-14)', () => {
  afterEach(() => {
    mockSyncAccount.mockResolvedValue({ needsBank: false });
  });

  it('Stripe wants a photo ID: the card says so, and the tracker says who it waits on', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: true } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText, queryByText, getByLabelText, getByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );

    expect(getByText('We need one more thing from you')).toBeTruthy();
    expect(queryByText('Your details are being checked')).toBeNull();
    // "!" on the check, spoken "needs you" — shape, not colour.
    expect(getByTestId('payouts-steps-attention-check')).toBeTruthy();
    expect(getByLabelText(/ID check, needs you/)).toBeTruthy();
    // The old line told them to wait for a check that was waiting on them.
    expect(queryByText(/Usually a few minutes/)).toBeNull();
  });

  it('"Start the check" opens the check straight away — the card already explained it', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: true } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText, getByTestId, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );

    await act(async () => {
      fireEvent.press(getByText('Start the check'));
    });
    // Nothing extra reaches the server: skipIntro is the app's alone.
    expect(mockStart).toHaveBeenCalledWith({});
    expect(queryByTestId('payouts-stripe-intro')).toBeNull();
    expect(getByTestId('connect-onboarding')).toBeTruthy();
  });

  it('leaving the check asks Stripe again, not just our row', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: true } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Start the check'));
    });
    mockSyncAccount.mockClear();

    await act(async () => {
      fireEvent.press(getByTestId('connect-onboarding'));
    });
    expect(mockSyncAccount).toHaveBeenCalledTimes(1);
    expect(mockSettleReturn).toHaveBeenCalled();
  });

  it('a missing bank comes first — ours to ask, and quicker', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: true, needsAction: true } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByText('Add your bank account to get paid')).toBeTruthy();
    expect(queryByText('We need one more thing from you')).toBeNull();
  });

  it('Stripe still reviewing: "being checked", as before', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: false } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByText('Your details are being checked')).toBeTruthy();
    expect(queryByText('We need one more thing from you')).toBeNull();
  });
});

describe('⚠️ a check that failed is said as one, with a way to ask again (2026-10-16)', () => {
  afterEach(() => {
    mockSyncAccount.mockResolvedValue({ needsBank: false });
    mockPollSpent = false;
  });

  it('the check failed: "couldn’t check", never "being checked" — and Check again asks again', async () => {
    mockPollSpent = true;
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: false, failed: true } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByText('We couldn’t check your details just now')).toBeTruthy();
    expect(queryByText('Your details are being checked')).toBeNull();

    mockSyncAccount.mockClear();
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: true, failed: false } as never);
    await act(async () => {
      fireEvent.press(getByText('Check again'));
    });
    expect(mockSyncAccount).toHaveBeenCalledTimes(1);
    // The answer that comes back is the one the screen tells.
    expect(getByText('We need one more thing from you')).toBeTruthy();
  });

  it('the automatic checks have stopped: Check again sits beside "being checked"', async () => {
    mockPollSpent = true;
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: false, failed: false } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));

    expect(getByText('Your details are being checked')).toBeTruthy();
    expect(getByText('Check again')).toBeTruthy();
  });

  it('while the automatic checks run: no button — the screen is already asking', async () => {
    mockSyncAccount.mockResolvedValue({ needsBank: false, needsAction: false, failed: false } as never);
    mockAccountState = { status: 'verifying', settling: false };
    const { queryByText } = await act(async () => render(<PayoutsScreen />));

    expect(queryByText('Check again')).toBeNull();
  });
});
