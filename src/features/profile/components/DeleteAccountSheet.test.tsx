/**
 * WHAT:  Tests for DeleteAccountSheet — the reasons it can't go yet, the
 *        type-DELETE gate, one request per tap, and what a refusal or success
 *        does next.
 * WHY:   The one irreversible action in the app. A button that's live before
 *        DELETE is typed, a double tap that sends twice, or a blocked account
 *        shown a button anyway is a Tier 1 failure; so is a refusal that says
 *        only "try again" when there's something specific to do.
 * LINKS: ./DeleteAccountSheet.tsx; ../api/profileApi.ts; ../lib/deletionReasons.ts.
 */

import { act, createRef } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { BottomSheetRef } from '@/shared/ui';

import { DeleteAccountSheet } from './DeleteAccountSheet';

const mockFetchBlockers = jest.fn();
const mockLiveCount = jest.fn();
const mockRequestDeletion = jest.fn();
jest.mock('../api/profileApi', () => ({
  // A real class: the sheet branches on `instanceof`.
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

const mockNavigate = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate, push: mockPush }) }));

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

jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => this.setState({ visible: true });
    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetScrollView: (props: object) => React.createElement(ReactNative.ScrollView, props),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchBlockers.mockResolvedValue([]);
  mockLiveCount.mockResolvedValue(0);
  mockRequestDeletion.mockResolvedValue(undefined);
});

/** Render the sheet and open it, as Profile's row does. */
async function openSheet() {
  const ref = createRef<BottomSheetRef>();
  const screen = await render(<DeleteAccountSheet ref={ref} userId="u1" />);
  await act(async () => {
    ref.current?.open();
  });
  return screen;
}

type Screen = Awaited<ReturnType<typeof render>>;
const deleteButton = (screen: Screen) => screen.getByRole('button', { name: 'Delete account' });

describe('blocked', () => {
  it('lists every reason and offers no button', async () => {
    mockFetchBlockers.mockResolvedValue([
      { code: 'LIVE_LISTING', count: 2 },
      { code: 'REWARD_ON_ITS_WAY', count: 1 },
    ]);
    const screen = await openSheet();

    expect(await screen.findByText('Before you can delete')).toBeTruthy();
    // Each reason a row: a short title, and what to do beneath it.
    expect(screen.getByText('2 listings in progress')).toBeTruthy();
    expect(screen.getByText('A reward for you')).toBeTruthy();
    expect(screen.getByText('Set up payouts to receive it first.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
    expect(screen.queryByTestId('delete-account-input')).toBeNull();
  });

  // A reason with a place to fix it opens that place — not a dead end.
  it.each([
    ['LIVE_LISTING', '/my-posts'],
    ['REWARD_ON_ITS_WAY', '/payouts'],
  ])('%s opens %s', async (code, path) => {
    mockFetchBlockers.mockResolvedValue([{ code, count: 1 }]);
    const screen = await openSheet();
    await fireEvent.press(await screen.findByTestId(`delete-account-reason-${code}`));
    expect(mockPush).toHaveBeenCalledWith(path);
  });

  it('offers a retry when the check itself fails — never a button on a guess', async () => {
    mockLiveCount.mockRejectedValueOnce(new Error('offline'));
    const screen = await openSheet();

    expect(await screen.findByText('We couldn’t check your account.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('delete-account-input')).toBeTruthy();
  });
});

describe('clear to delete', () => {
  it('says what goes, and nothing about what’s kept', async () => {
    const screen = await openSheet();

    expect(await screen.findByText('What’s deleted')).toBeTruthy();
    // Owner, 2026-10-23: no "What's kept" group in the sheet.
    expect(screen.queryByText('What’s kept')).toBeNull();
    // The warning sits right above the box they type in. (TextField reads
    // label + hint out on the field itself, so the Text is a11y-hidden.)
    expect(screen.getByText('This can’t be undone.', { includeHiddenElements: true })).toBeTruthy();
  });

  // ⚠️ 20261023140000: a live listing with no reward money goes WITH the
  // account — they must be told before the button, not surprised after.
  it('names a live listing it will take down, first under Deleted', async () => {
    mockLiveCount.mockResolvedValue(1);
    const screen = await openSheet();

    expect(await screen.findByText('Your live listing')).toBeTruthy();
    expect(screen.getByText('Taken down when you delete')).toBeTruthy();
    expect(mockLiveCount).toHaveBeenCalledWith('u1');
  });

  it('⚠️ stays disabled until DELETE is typed', async () => {
    const screen = await openSheet();
    await screen.findByTestId('delete-account-input');

    expect(deleteButton(screen).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(deleteButton(screen));
    expect(mockRequestDeletion).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('delete-account-input'), 'DELET');
    expect(deleteButton(screen).props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('delete-account-input'), 'delete');
    expect(deleteButton(screen).props.accessibilityState.disabled).toBe(false);
  });

  it('deletes once, however fast the taps, then lands on Explore', async () => {
    let finish: () => void = () => {};
    mockRequestDeletion.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const screen = await openSheet();
    await fireEvent.changeText(await screen.findByTestId('delete-account-input'), 'DELETE');

    // Sequential taps: the second meets the loading button. (Same-tick taps —
    // the ref guard's real job — can't be driven here: two overlapping async
    // fireEvents corrupt the renderer for every later test.)
    await fireEvent.press(deleteButton(screen));
    await fireEvent.press(deleteButton(screen));
    expect(mockRequestDeletion).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/explore'));
    expect(mockToast).toHaveBeenCalledWith('Your account has been deleted', 'success');
  });

  it('a refusal shows the server’s reason and re-reads the list', async () => {
    const { AccountDeletionError } = jest.requireMock('../api/profileApi');
    mockRequestDeletion.mockRejectedValue(
      new AccountDeletionError(
        "A payout is still on its way to your bank. Try again once it's arrived.",
        'PAYOUT_ON_ITS_WAY',
      ),
    );
    const screen = await openSheet();
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
    const screen = await openSheet();
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
