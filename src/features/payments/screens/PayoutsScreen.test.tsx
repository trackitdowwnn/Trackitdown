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

import { PaymentError } from '../api/functionError';
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
const mockCanGoBack = jest.fn(() => true);
let mockParams: { onboarding?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: jest.fn(),
    push: jest.fn(),
    replace: mockReplace,
    setParams: mockSetParams,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: () => {},
}));

const mockRequireAuth = jest.fn();
jest.mock('@/features/auth', () => ({
  useRequireAuth: () => mockRequireAuth,
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
jest.mock('../api/payoutsApi', () => ({
  startConnectOnboarding: (...args: unknown[]) => mockStart(...args),
  submitPayoutTokens: (...args: unknown[]) => mockSubmitTokens(...args),
  fetchMyPendingCredit: (...args: unknown[]) => mockPendingCredit(...(args as [])),
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

/** Fill every required field so `submit()` reaches the api rather than zod. */
const fillForm = async (getByTestId: (id: string) => unknown) => {
  const type = async (id: string, value: string) => {
    await act(async () => {
      fireEvent.changeText(getByTestId(id) as never, value);
    });
  };
  await type('payout-first-name', 'Ada');
  await type('payout-last-name', 'Lovelace');
  await type('payout-dob', '01041990');
  await type('payout-address-1', '12 Bridge Street');
  await type('payout-city', 'Manchester');
  await type('payout-postcode', 'M1 1AA');
  await type('payout-sort-code', '108800');
  await type('payout-account-number', '00012345');
  await type('payout-confirm-account-number', '00012345');
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockAccountState = { status: 'notStarted', settling: false };
  mockStart.mockResolvedValue({ status: 'onboarding_session', clientSecret: 'accs_secret_123' });
  mockOpenAuth.mockResolvedValue({ type: 'success', url: 'trackitdown://payouts?onboarding=complete' });
  mockCanGoBack.mockReturnValue(true);
  // The default spotter here has a bounty waiting — under credit-time setup
  // that is the ONLY person the setup card exists for. The nothing-waiting
  // case gets its own tests.
  mockPendingCredit.mockResolvedValue({ postId: 'post-1', transferPence: 19000 });
  mockIdentityToken.mockResolvedValue('accttok_test_1');
  mockBankToken.mockResolvedValue('btok_test_1');
  mockSubmitTokens.mockResolvedValue('submitted');
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
    const { getByTestId, getByText } = await act(async () => render(<PayoutsScreen />));
    expect(getByTestId('payouts-notStarted')).toBeTruthy();
    // The earn moment: the same sentence the push used, with the same
    // server-derived number. Generic setup copy here would break the thread
    // that brought them.
    expect(getByTestId('payouts-earned')).toBeTruthy();
    expect(getByText('You’ve earned £190')).toBeTruthy();
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
    expect(getByText('Stripe is checking your details')).toBeTruthy();
    expect(queryByText('Pick up where you left off')).toBeNull();
    expect(getByText(/don’t need to wait here/i)).toBeTruthy();
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

describe('our own form comes first', () => {
  it('shows the native form rather than handing straight to Stripe', async () => {
    // The window in which we may submit bank details at all closes the moment a
    // session exists, so the server says details_required until our form runs.
    mockStart.mockResolvedValue({ status: 'details_required' });
    const { getByText, getByTestId, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );

    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });

    expect(getByTestId('payout-details-form')).toBeTruthy();
    expect(queryByTestId('connect-onboarding')).toBeNull();
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it('promises only what is true about the bank details', async () => {
    // It said "we never SEE or store" them, which is half false: they are
    // POSTed to our own Edge Function and held in memory on the way to Stripe.
    // "Pass straight on" and "never store" are both true; the other one is the
    // sentence a regulator would quote back.
    mockStart.mockResolvedValue({ status: 'details_required' });
    const { getByText, queryByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    expect(getByText(/never store them/i)).toBeTruthy();
    expect(queryByText(/never see/i)).toBeNull();
  });

  it('offers Stripe when our form cannot describe them', async () => {
    // A company, or a non-UK account. Our ten fields have no word for either,
    // so without this the spotter is gated forever behind a form that can
    // never satisfy Stripe — permanently unpayable.
    mockStart.mockResolvedValue({ status: 'details_required' });
    // The REAL PaymentError — the screen tests `instanceof`, and only the api
    // module is mocked, so `functionError` is the genuine article here. The
    // rejection comes from the identity tokeniser: Stripe refused the identity
    // itself, before anything reached our server.
    mockIdentityToken.mockRejectedValue(
      new PaymentError('Stripe couldn’t accept those details.', 'DETAILS_REJECTED'),
    );

    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    await fillForm(getByTestId);
    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(getByTestId('payouts-details-rejected')).toBeTruthy();
    mockStart.mockResolvedValue({ status: 'onboarding_session', clientSecret: 'accs_1' });
    await act(async () => {
      fireEvent.press(getByText('Continue with Stripe'));
    });
    // Spends the prefill window deliberately, which beats being unpayable.
    expect(mockStart).toHaveBeenCalledWith({ skipPrefill: true });
  });

  it('offers a way out of ten fields of bank and identity data', async () => {
    mockStart.mockResolvedValue({ status: 'details_required' });
    const { getByText, getByTestId, queryByTestId } = await act(async () =>
      render(<PayoutsScreen />),
    );
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    expect(getByTestId('payout-details-form')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Not now'));
    });
    // Back to the screen they came from, not out of the app entirely.
    expect(queryByTestId('payout-details-form')).toBeNull();
    expect(getByTestId('payouts-notStarted')).toBeTruthy();
  });

  it('does not claim they are finished — Stripe still has questions', async () => {
    // Saying "done" and then showing a Stripe verification screen would be a
    // bait and switch.
    mockStart.mockResolvedValue({ status: 'details_required' });
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
    });
    expect(getByText(/may ask to verify your identity/i)).toBeTruthy();
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

    expect(getByTestId('connect-onboarding')).toBeTruthy();
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it('settles when the component closes — exiting is not proof of anything', async () => {
    // `onExit` is exactly as much of a promise as the browser redirect was:
    // none. Someone can back out half way, and only the webhook knows.
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Add your details'));
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
    expect(mockShowToast).toHaveBeenCalledWith('Done — bounties will go to your new account.');
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
      fireEvent.press(getByText('Continue with Stripe'));
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
