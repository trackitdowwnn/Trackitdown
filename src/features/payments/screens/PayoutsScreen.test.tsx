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

import { act, fireEvent, render } from '@testing-library/react-native';

import { PaymentError } from '@/shared/lib/functionError';
import { setPayoutSetupOutcome, takePayoutSetupOutcome } from '../lib/payoutSetupOutcome';
import { PayoutsScreen } from './PayoutsScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
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
jest.mock('../api/payoutsApi', () => ({
  startConnectOnboarding: (...args: unknown[]) => mockStart(...args),
  submitPayoutTokens: (...args: unknown[]) => mockSubmitTokens(...args),
  fetchMyPendingCredit: (...args: unknown[]) => mockPendingCredit(...(args as [])),
  fetchMyLatestPayout: (...args: unknown[]) => mockLatestPayout(...(args as [])),
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
let mockAccountState: { status: string; settling: boolean };
jest.mock('../hooks/usePayoutAccount', () => ({
  get usePayoutAccount() {
    return () => ({
      ...mockAccountState,
      account: null,
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

beforeEach(() => {
  jest.clearAllMocks();
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
  mockPendingCredit.mockResolvedValue({ postId: 'post-1', transferPence: 19000 });
  mockLatestPayout.mockResolvedValue(null);
  mockIdentityToken.mockResolvedValue('accttok_test_1');
  mockBankToken.mockResolvedValue('btok_test_1');
  mockSubmitTokens.mockResolvedValue('submitted');
});

describe('⚠️ the status chip and the trust line (Airbnb pass, 2026-08-26)', () => {
  it.each([
    ['notStarted', 'details'],
    ['unfinished', 'check'],
    ['verifying', 'check'],
    ['ready', 'reward'],
  ])('⚠️ %s: the tracker marks the state, in place of the chip', async (status, current) => {
    // The state must be legible before a word is read. Since the tracker
    // (2026-10-13) its current marker does that; a chip beside it was the
    // same fact twice (UI review).
    mockAccountState = { status, settling: false };
    const { getByTestId, queryByTestId } = await act(async () => render(<PayoutsScreen />));

    expect(getByTestId(`payouts-steps-current-${current}`)).toBeTruthy();
    expect(queryByTestId(`payouts-pill-${status}`)).toBeNull();
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
    mockAccountState = { status: 'verifying', settling: false };
    const { getByTestId } = await act(async () => render(<PayoutsScreen />));

    expect(getByTestId('payouts-trust')).toBeTruthy();
    expect(getByTestId('payouts-trust').props.children).toMatch(/never store them/i);
    expect(getByTestId('payouts-trust').props.children).not.toMatch(/never see/i);
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

  it('offers setup when a bounty is waiting for somewhere to land', async () => {
    const { getByTestId, getByText, getByLabelText } = await act(async () => render(<PayoutsScreen />));
    expect(getByTestId('payouts-notStarted')).toBeTruthy();
    // The earn moment: the same sentence the push used, with the same
    // server-derived number. Generic setup copy here would break the thread
    // that brought them.
    expect(getByTestId('payouts-earned')).toBeTruthy();
    // ⚠️ THE SENTENCE IS NOW TWO TEXTS, AND THE ACCESSIBLE LABEL IS WHAT PINS
    // IT. The Airbnb pass (2026-08-26) split "You've earned £190" into a quiet
    // label and the amount at display scale, so the figure is the first thing
    // with weight. That is TYPOGRAPHY ONLY: the card is one accessible node
    // whose label still reads the whole sentence, because three separate stops
    // would deliver the number without the words that give it meaning.
    // Asserting the label rather than the visible runs is what keeps this test
    // about the promise instead of about the layout.
    expect(getByText('£190')).toBeTruthy();
    expect(getByLabelText(/You’ve earned £190\. Your sighting led to a recovery/)).toBeTruthy();
  });

  it('says NOTHING to set up when nothing is waiting — because there isn’t', async () => {
    // Credit-time setup made "no setup" literal. A never-credited spotter who
    // finds this screen (deep link, old bookmark) must not be walked into a
    // form about money that does not exist.
    mockPendingCredit.mockResolvedValue(null);
    const { getByText, queryByTestId } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Nothing to set up')).toBeTruthy();
    expect(queryByTestId('payouts-notStarted')).toBeNull();
    expect(queryByTestId('payouts-earned')).toBeNull();
  });

  it('tells someone mid-way that their progress is saved', async () => {
    mockAccountState = { status: 'unfinished', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Pick up where you left off')).toBeTruthy();
    expect(getByText(/progress is saved/i)).toBeTruthy();
  });

  it('puts the waiting on STRIPE, never on the spotter', async () => {
    // The distinction the feature turns on: nothing is being asked of them.
    mockAccountState = { status: 'verifying', settling: false };
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Your details are being checked')).toBeTruthy();
    expect(queryByText('Pick up where you left off')).toBeNull();
    expect(getByText(/switch payouts on the moment it’s done/i)).toBeTruthy();
  });

  it('only asks "tell us where" while nobody has', async () => {
    // Under a tracker reading "Your details — done", it would contradict it.
    mockAccountState = { status: 'verifying', settling: false };
    const { getByLabelText, queryByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByLabelText('You’ve earned £190. Your sighting led to a recovery.')).toBeTruthy();
    expect(queryByText(/Tell us where to send it/)).toBeNull();
  });
  it('confirms when money can actually reach them', async () => {
    mockAccountState = { status: 'ready', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByText('Payouts are on')).toBeTruthy();
    // Not a dead end: they can still change where the money goes.
    expect(getByText('Update bank details')).toBeTruthy();
  });

  it('says "nearly there" while settling, never guessing at the outcome', async () => {
    mockAccountState = { status: 'unfinished', settling: true };
    const { getByTestId, queryByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByTestId('payouts-settling')).toBeTruthy();
    // The derived state would have blamed them for stopping half way.
    expect(queryByText('Pick up where you left off')).toBeNull();
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
    expect(getByTestId('payouts-verifying')).toBeTruthy();
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
    const { getByText, getByTestId, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    await act(async () => {
      fireEvent.press(getByText('Not now'));
    });

    expect(queryByTestId('payouts-stripe-intro')).toBeNull();
    expect(queryByTestId('connect-onboarding')).toBeNull();
    expect(getByTestId('payouts-notStarted')).toBeTruthy();
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
    expect(getByTestId('payouts-steps-upcoming-reward')).toBeTruthy();
  });

  it('puts the wait on Stripe while it checks', async () => {
    mockAccountState = { status: 'verifying', settling: false };
    const { getByTestId, getByLabelText } = await act(async () => render(<PayoutsScreen />));

    expect(getByTestId('payouts-steps-done-details')).toBeTruthy();
    expect(getByLabelText(/ID check, in progress\. .*switch payouts on/)).toBeTruthy();
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
    const { getByTestId, getByText, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );

    expect(getByTestId('payouts-steps-done-reward')).toBeTruthy();
    expect(getByText(/^Sent 13 October/)).toBeTruthy();
    // The tracker stands in for the chip here too.
    expect(queryByTestId('payouts-pill-ready')).toBeNull();
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
