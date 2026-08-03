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
const mockSubmitDetails = jest.fn();
jest.mock('../api/payoutsApi', () => ({
  startConnectOnboarding: (...args: unknown[]) => mockStart(...args),
  submitPayoutDetails: (...args: unknown[]) => mockSubmitDetails(...args),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockAccountState = { status: 'notStarted', settling: false };
  mockStart.mockResolvedValue({ status: 'onboarding_session', clientSecret: 'accs_secret_123' });
  mockOpenAuth.mockResolvedValue({ type: 'success', url: 'trackitdown://payouts?onboarding=complete' });
  mockCanGoBack.mockReturnValue(true);
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

  it('offers setup when nothing has started', async () => {
    const { getByTestId } = await act(async () => render(<PayoutsScreen />));
    expect(getByTestId('payouts-notStarted')).toBeTruthy();
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
      fireEvent.press(getByText('Set up payouts'));
    });

    expect(getByTestId('payout-details-form')).toBeTruthy();
    expect(queryByTestId('connect-onboarding')).toBeNull();
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it('promises plainly that we never keep the bank details', async () => {
    mockStart.mockResolvedValue({ status: 'details_required' });
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Set up payouts'));
    });
    expect(getByText(/never see or store your bank details/i)).toBeTruthy();
  });

  it('does not claim they are finished — Stripe still has questions', async () => {
    // Saying "done" and then showing a Stripe verification screen would be a
    // bait and switch.
    mockStart.mockResolvedValue({ status: 'details_required' });
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Set up payouts'));
    });
    expect(getByText(/Stripe will ask you to confirm/i)).toBeTruthy();
  });
});

describe('setting up — inside the app', () => {
  it('opens NO browser: setup renders in the app', async () => {
    // The whole point of the embedded component. A browser hop here was the
    // clunkiest moment in the product, at the point where someone is deciding
    // whether to trust us with their bank details.
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Set up payouts'));
    });

    expect(getByTestId('connect-onboarding')).toBeTruthy();
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it('settles when the component closes — exiting is not proof of anything', async () => {
    // `onExit` is exactly as much of a promise as the browser redirect was:
    // none. Someone can back out half way, and only the webhook knows.
    const { getByText, getByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Set up payouts'));
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
      fireEvent.press(getByText('Set up payouts'));
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(STRIPE_URL, 'trackitdown://payouts');
  });

  it('still uses the browser to CHANGE details — Stripe has no RN component for it', async () => {
    mockStart.mockResolvedValue({ status: 'update_available', url: STRIPE_URL });
    mockAccountState = { status: 'ready', settling: false };
    const { getByText, queryByTestId } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Update bank details'));
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(STRIPE_URL, 'trackitdown://payouts');
    expect(queryByTestId('connect-onboarding')).toBeNull();
  });

  it('settles on a dismiss too — Android reports success that way', async () => {
    mockStart.mockResolvedValue({ status: 'onboarding_required', url: STRIPE_URL });
    mockOpenAuth.mockResolvedValue({ type: 'dismiss' });
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Set up payouts'));
    });
    expect(mockSettleReturn).toHaveBeenCalled();
  });

  it('opens no browser when the server says there is nothing to do', async () => {
    mockStart.mockResolvedValue({ status: 'already_enabled' });
    mockAccountState = { status: 'ready', settling: false };
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Update bank details'));
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
      fireEvent.press(getByText('Set up payouts'));
    });
    expect(getByText(/link expired/i)).toBeTruthy();
  });

  it('surfaces a failure without leaving the button stuck', async () => {
    // The Android re-entry throw lands here too.
    mockStart.mockResolvedValue({ status: 'onboarding_required', url: STRIPE_URL });
    mockOpenAuth.mockRejectedValue(new Error('WebBrowser is already open'));
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Set up payouts'));
    });
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
    // Back to a tappable label, not stuck on "Opening Stripe…".
    expect(getByText('Set up payouts')).toBeTruthy();
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
      fireEvent.press(getByText('Set up payouts'));
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
