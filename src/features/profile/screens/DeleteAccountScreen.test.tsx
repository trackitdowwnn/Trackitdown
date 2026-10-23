/**
 * WHAT:  Tests for DeleteAccountScreen — the reasons it can't go yet, proving
 *        it's them (an email code, or Apple re-sign-in), one request per tap,
 *        and what a refusal or success does next.
 * WHY:   The one irreversible action in the app. A button that's live before
 *        the code is in, a wrong code that still deletes, a double tap that
 *        sends twice, or a blocked account shown a button anyway is a Tier 1
 *        failure; so is a refusal that says only "try again" when there's
 *        something specific to do.
 * LINKS: ./DeleteAccountScreen.tsx; ../api/profileApi.ts;
 *        ../lib/deletionReasons.ts; src/features/auth/api/authApi.ts.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DeleteAccountScreen } from './DeleteAccountScreen';

const mockFetchBlockers = jest.fn();
const mockLiveCount = jest.fn();
const mockIdentity = jest.fn();
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
  fetchIdentityCheck: (...a: unknown[]) => mockIdentity(...a),
  requestAccountDeletion: (...a: unknown[]) => mockRequestDeletion(...a),
}));

const mockBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, navigate: mockNavigate, push: jest.fn() }),
}));

let mockSession: { status: string; userId: string | null } = { status: 'signedIn', userId: 'u1' };
const mockSendCode = jest.fn();
const mockConfirmCode = jest.fn();
const mockConfirmApple = jest.fn();
jest.mock('@/features/auth', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { TextInput } = require('react-native');
  return {
    useSession: () => mockSession,
    AuthActionError: class AuthActionError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
    sendIdentityCode: (...a: unknown[]) => mockSendCode(...a),
    confirmIdentityWithCode: (...a: unknown[]) => mockConfirmCode(...a),
    confirmIdentityWithApple: (...a: unknown[]) => mockConfirmApple(...a),
    // The boxes are auth's own (tested there); a plain input stands in.
    OtpInput: ({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) => (
      <TextInput testID="otp" value={value} onChangeText={onChangeText} />
    ),
  };
});

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
  mockIdentity.mockResolvedValue({ kind: 'code', email: 'ollie@example.com' });
  mockSendCode.mockResolvedValue(undefined);
  mockConfirmCode.mockResolvedValue('u1');
  mockConfirmApple.mockResolvedValue('u1');
  mockRequestDeletion.mockResolvedValue(undefined);
});

type Screen = Awaited<ReturnType<typeof render>>;
const deleteButton = (screen: Screen) => screen.getByRole('button', { name: 'Delete account' });

/** Ask for the code, then type it in. */
async function enterCode(screen: Screen, code = '123456') {
  await fireEvent.press(await screen.findByRole('button', { name: 'Email me a code' }));
  await fireEvent.changeText(await screen.findByTestId('otp'), code);
}

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
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
  });

  it('offers a retry when the check itself fails — never a button on a guess', async () => {
    mockFetchBlockers.mockRejectedValueOnce(new Error('offline'));
    const screen = await render(<DeleteAccountScreen />);

    expect(await screen.findByText('We couldn’t check your account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
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

  it('won’t offer a way through if the listing count can’t be read', async () => {
    mockLiveCount.mockRejectedValueOnce(new Error('offline'));
    const screen = await render(<DeleteAccountScreen />);

    expect(await screen.findByText('We couldn’t check your account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
  });
});

describe('proving it’s them', () => {
  it('first offers to email a code to their (masked) address — no delete button yet', async () => {
    const screen = await render(<DeleteAccountScreen />);

    expect(await screen.findByText('We’ll email a code to o•••@example.com.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
    expect(screen.queryByText('ollie@example.com')).toBeNull();
  });

  it('sends the code to their address', async () => {
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Email me a code' }));
    expect(mockSendCode).toHaveBeenCalledWith('ollie@example.com');
    expect(await screen.findByText('Enter the code we sent to o•••@example.com.')).toBeTruthy();
  });

  it('⚠️ the red button stays disabled until all six digits are in', async () => {
    const screen = await render(<DeleteAccountScreen />);
    await enterCode(screen, '12345');
    expect(deleteButton(screen).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(deleteButton(screen));
    expect(mockConfirmCode).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('otp'), '123456');
    expect(deleteButton(screen).props.accessibilityState.disabled).toBe(false);
  });

  it('⚠️ a wrong code deletes nothing and says so', async () => {
    const { AuthActionError } = jest.requireMock('@/features/auth');
    mockConfirmCode.mockRejectedValue(
      new AuthActionError('That code didn’t match — check the latest email.', 'INVALID_OTP'),
    );
    const screen = await render(<DeleteAccountScreen />);
    await enterCode(screen);
    await fireEvent.press(deleteButton(screen));

    expect(
      await screen.findByText('That code didn’t match — check the latest email.'),
    ).toBeTruthy();
    expect(mockRequestDeletion).not.toHaveBeenCalled();
  });

  // ⚠️ The Apple sheet can hand back a different Apple ID: deleting THAT
  // account and saying "yours is deleted" would be a silent erasure failure.
  it('a proof for a DIFFERENT account deletes nothing', async () => {
    mockIdentity.mockResolvedValue({ kind: 'apple' });
    mockConfirmApple.mockResolvedValue('someone-else');
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Confirm with Apple and delete' }),
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        'That’s a different account. Sign in again with yours.',
        'error',
      ),
    );
    expect(mockRequestDeletion).not.toHaveBeenCalled();
  });

  it('a send failure says why and keeps them on the first step', async () => {
    const { AuthActionError } = jest.requireMock('@/features/auth');
    mockSendCode.mockRejectedValue(
      new AuthActionError('Too many codes requested — please try again later.', 'OTP_RATE_LIMIT'),
    );
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Email me a code' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        'Too many codes requested — please try again later.',
        'error',
      ),
    );
    expect(screen.queryByTestId('otp')).toBeNull();
  });

  it('an Apple account confirms with Apple instead (relay addresses get no codes)', async () => {
    mockIdentity.mockResolvedValue({ kind: 'apple' });
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Confirm with Apple and delete' }),
    );
    await waitFor(() => expect(mockRequestDeletion).toHaveBeenCalled());
    expect(mockSendCode).not.toHaveBeenCalled();
  });

  it('a cancelled Apple sheet deletes nothing', async () => {
    mockIdentity.mockResolvedValue({ kind: 'apple' });
    mockConfirmApple.mockResolvedValue(null);
    const screen = await render(<DeleteAccountScreen />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Confirm with Apple and delete' }),
    );
    await waitFor(() => expect(mockConfirmApple).toHaveBeenCalled());
    expect(mockRequestDeletion).not.toHaveBeenCalled();
  });
});

describe('deleting', () => {
  it('verifies the code, deletes once however fast the taps, then lands on Explore', async () => {
    let finish: () => void = () => {};
    mockRequestDeletion.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const screen = await render(<DeleteAccountScreen />);
    await enterCode(screen);

    // Sequential taps: the second meets the loading button. (Same-tick taps —
    // the ref guard's real job — can't be driven here: two overlapping async
    // fireEvents corrupt the renderer for every later test.)
    await fireEvent.press(deleteButton(screen));
    await fireEvent.press(deleteButton(screen));
    await waitFor(() => expect(mockRequestDeletion).toHaveBeenCalledTimes(1));
    expect(mockConfirmCode).toHaveBeenCalledWith('ollie@example.com', '123456');

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
    await enterCode(screen);
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

  // A code works once: a retry straight after a refusal must not re-verify
  // it (that would fail, and spend another email from the hourly budget).
  it('a retry soon after a refusal doesn’t re-verify the used code', async () => {
    const { AccountDeletionError } = jest.requireMock('../api/profileApi');
    mockRequestDeletion
      .mockRejectedValueOnce(
        new AccountDeletionError('Try again in a moment.', 'INTENT_NOT_CANCELLED'),
      )
      .mockResolvedValueOnce(undefined);
    const screen = await render(<DeleteAccountScreen />);
    await enterCode(screen);
    await fireEvent.press(deleteButton(screen));
    await waitFor(() => expect(mockRequestDeletion).toHaveBeenCalledTimes(1));

    await fireEvent.press(deleteButton(screen));
    await waitFor(() => expect(mockRequestDeletion).toHaveBeenCalledTimes(2));
    expect(mockConfirmCode).toHaveBeenCalledTimes(1);
  });

  it('REAUTH_REQUIRED sends them back to ask for a new code', async () => {
    const { AccountDeletionError } = jest.requireMock('../api/profileApi');
    mockRequestDeletion.mockRejectedValue(
      new AccountDeletionError('Please confirm it’s you first.', 'REAUTH_REQUIRED'),
    );
    const screen = await render(<DeleteAccountScreen />);
    await enterCode(screen);
    await fireEvent.press(deleteButton(screen));

    expect(await screen.findByRole('button', { name: 'Email me a code' })).toBeTruthy();
    expect(mockToast).toHaveBeenCalledWith('Please confirm it’s you first.', 'error');
  });

  it('an unknown failure degrades to a calm "try again"', async () => {
    mockRequestDeletion.mockRejectedValue(new Error('network down'));
    const screen = await render(<DeleteAccountScreen />);
    await enterCode(screen);
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
