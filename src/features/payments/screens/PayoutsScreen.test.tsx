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
jest.mock('../api/payoutsApi', () => ({
  startConnectOnboarding: (...args: unknown[]) => mockStart(...args),
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
  mockStart.mockResolvedValue({ status: 'onboarding_required', url: STRIPE_URL });
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

describe('opening Stripe', () => {
  it('passes the BARE return prefix — the query string would not match on Android', async () => {
    const { getByText } = await act(async () => render(<PayoutsScreen />));
    await act(async () => {
      fireEvent.press(getByText('Set up payouts'));
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(STRIPE_URL, 'trackitdown://payouts');
  });

  it('settles on a dismiss too — Android reports success that way', async () => {
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
    // The highest-value test here. On Android openAuthSessionAsync resolves AND
    // the deep link navigates, for the same single journey. settleReturn is
    // idempotent, but the screen must not treat these as two returns.
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
