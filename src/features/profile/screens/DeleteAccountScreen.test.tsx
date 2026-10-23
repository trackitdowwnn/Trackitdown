/**
 * WHAT:  Tests for DeleteAccountScreen — the reasons it can't go yet, the
 *        type-DELETE gate, one request per tap, and what a refusal or success
 *        does next.
 * WHY:   The one irreversible action in the app. A button that's live before
 *        DELETE is typed, a double tap that sends twice, or a blocked account
 *        shown a button anyway is a Tier 1 failure; so is a refusal that says
 *        only "try again" when there's something specific to do.
 * LINKS: ./DeleteAccountScreen.tsx; ../api/profileApi.ts;
 *        ../lib/deletionReasons.ts.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DeleteAccountScreen } from './DeleteAccountScreen';

const mockFetchBlockers = jest.fn();
const mockLiveCount = jest.fn();
const mockRequestDeletion = jest.fn();
jest.mock('../api/profileApi', () => ({
  // A real class: the screen branches on `instanceof`.
  AccountDeletionError: class AccountDeletionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AccountDeletionError';
      this.code = code;
    }
  },
  fetchDeletionBlockers: (...a: unknown[]) => mockFetchBlockers(...a),
  fetchLiveListingCount: (...a: unknown[]) => mockLiveCount(...a),
  requestAccountDeletion: (...a: unknown[]) => mockRequestDeletion(...a),
}));

const mockBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, navigate: mockNavigate, push: jest.fn() }),
}));

let mockSession: { status: string; userId: string | null } = { status: 'signedIn', userId: 'u1' };
jest.mock('@/features/auth', () => ({ useSession: () => mockSession }));

const mockToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock(
  'react-native-safe-area-context',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    require('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { status: 'signedIn', userId: 'u1' };
  mockFetchBlockers.mockResolvedValue([]);
  mockLiveCount.mockResolvedValue(0);
  mockRequestDeletion.mockResolvedValue(undefined);
});

const deleteButton = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole('button', { name: 'Delete account' });

describe('blocked', () => {
  it('lists every reason and offers no button', async () => {
    mockFetchBlockers.mockResolvedValue([
      { code: 'LIVE_LISTING', count: 2 },
      { code: 'REWARD_ON_ITS_WAY', count: 1 },
    ]);
    const screen = await render(<DeleteAccountScreen />);

    expect(await screen.findByText('You can’t delete your account yet.')).toBeTruthy();
    expect(
      screen.getByText('2 listings have a reward or a recovery in progress. Close them first.'),
    ).toBeTruthy();
    expect(
      screen.getByText('A reward is waiting for you. Set up payouts to receive it.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
    expect(screen.queryByTestId('delete-account-input')).toBeNull();
  });

  it('offers a retry when the check itself fails — never a button on a guess', async () => {
    mockFetchBlockers.mockRejectedValueOnce(new Error('offline'));
    const screen = await render(<DeleteAccountScreen />);

    expect(await screen.findByText('We couldn’t check your account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
  });
});

describe('clear to delete', () => {
  it('says what goes and what stays', async () => {
    const screen = await render(<DeleteAccountScreen />);

    expect(await screen.findByText('Deleted')).toBeTruthy();
    expect(screen.getByText('Kept')).toBeTruthy();
    expect(screen.getByText('Payment records, for 6 years as the law requires')).toBeTruthy();
  });

  // ⚠️ 20261023140000: a live listing with no reward money goes WITH the
  // account — the owner must be told before the button, not surprised after.
  it('names a live listing it will take down, first under Deleted', async () => {
    mockLiveCount.mockResolvedValue(1);
    const screen = await render(<DeleteAccountScreen />);

    expect(await screen.findByText('Your live listing — taken down now')).toBeTruthy();
    expect(mockLiveCount).toHaveBeenCalledWith('u1');
  });

  it('says nothing about listings when there are none', async () => {
    const screen = await render(<DeleteAccountScreen />);
    await screen.findByText('Deleted');
    expect(screen.queryByTestId('delete-account-live-listings')).toBeNull();
  });

  it('won’t offer the button if the listing count can’t be read', async () => {
    mockLiveCount.mockRejectedValueOnce(new Error('offline'));
    const screen = await render(<DeleteAccountScreen />);

    expect(await screen.findByText('We couldn’t check your account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
  });

  it('⚠️ stays disabled until DELETE is typed', async () => {
    const screen = await render(<DeleteAccountScreen />);
    await screen.findByTestId('delete-account-input');

    expect(deleteButton(screen).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(deleteButton(screen));
    expect(mockRequestDeletion).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('delete-account-input'), 'DELET');
    expect(deleteButton(screen).props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('delete-account-input'), 'DELETE');
    expect(deleteButton(screen).props.accessibilityState.disabled).toBe(false);
  });

  it('deletes once, however fast the taps, then lands on Explore', async () => {
    let finish: () => void = () => {};
    mockRequestDeletion.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('delete-account-input'), 'delete');

    // Sequential taps: the second meets the loading button. (Same-tick taps —
    // the ref guard's real job — can't be driven here: two overlapping async
    // fireEvents corrupt the renderer for every later test.)
    await fireEvent.press(deleteButton(screen));
    await fireEvent.press(deleteButton(screen));
    expect(mockRequestDeletion).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/explore'));
    expect(mockToast).toHaveBeenCalledWith('Your account has been deleted', 'success');
    // Still busy until the screen unmounts — a late tap must not send again.
    await fireEvent.press(deleteButton(screen));
    expect(mockRequestDeletion).toHaveBeenCalledTimes(1);
  });

  it('a refusal shows the server’s reason and re-reads the list', async () => {
    const { AccountDeletionError } = jest.requireMock('../api/profileApi');
    mockRequestDeletion.mockRejectedValue(
      new AccountDeletionError(
        "A payout is still on its way to your bank. Try again once it's arrived.",
        'PAYOUT_ON_ITS_WAY',
      ),
    );
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('delete-account-input'), 'DELETE');
    await fireEvent.press(deleteButton(screen));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        "A payout is still on its way to your bank. Try again once it's arrived.",
        'error',
      ),
    );
    expect(mockFetchBlockers).toHaveBeenCalledTimes(2);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('an unknown failure degrades to a calm "try again"', async () => {
    mockRequestDeletion.mockRejectedValue(new Error('network down'));
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.changeText(await screen.findByTestId('delete-account-input'), 'DELETE');
    await fireEvent.press(deleteButton(screen));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        'We couldn’t delete your account. Please try again.',
        'error',
      ),
    );
  });
});

it('a guest (deep link) is told they are logged out — not a connection error', async () => {
  mockSession = { status: 'signedOut', userId: null };
  const screen = await render(<DeleteAccountScreen />);

  expect(await screen.findByText('You’re logged out')).toBeTruthy();
  expect(mockFetchBlockers).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
});

it('back leaves without deleting', async () => {
  const screen = await render(<DeleteAccountScreen />);
  await fireEvent.press(await screen.findByTestId('delete-account-back'));
  expect(mockBack).toHaveBeenCalled();
  expect(mockRequestDeletion).not.toHaveBeenCalled();
});
