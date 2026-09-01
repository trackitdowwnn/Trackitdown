/**
 * WHAT:  Tests for BlockedAccountsScreen — the list, the undo, and the empty
 *        state that is the normal state.
 * WHY:   This screen is the ONLY way to reverse a block. The header action in
 *        chat disappears once blocked, so if this list fails to load, fails to
 *        unblock, or silently drops a row that is still blocked server-side,
 *        blocking becomes a one-way door — which is the difference between a
 *        control and a trap, and the reason App Store guideline 1.2 is not
 *        satisfied by the block action alone.
 *
 *        ⚠️ THE OUTBOUND-ONLY RULE IS ASSERTED HERE TOO. list_my_blocks must
 *        never return who blocked the CALLER; a screen that rendered such a
 *        row would tell a blocked person they were blocked, which ADR-0017
 *        refuses. The server owns that, but this is where it would become
 *        visible, so the fixture is shaped to catch a widened payload.
 * LINKS: ./BlockedAccountsScreen.tsx; ../api/blocksApi.ts;
 *        docs/decisions/ADR-0017-user-blocking.md.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { BlockedAccountsScreen } from './BlockedAccountsScreen';

const mockFetch = jest.fn();
const mockUnblock = jest.fn();
jest.mock('../api/blocksApi', () => ({
  fetchMyBlocks: (...a: unknown[]) => mockFetch(...a),
  unblockAccount: (...a: unknown[]) => mockUnblock(...a),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: jest.fn() }) }));

const mockToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const account = (over: Partial<{ id: string; firstName: string; createdAt: string }> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  firstName: 'Sam',
  createdAt: '2026-08-30T10:00:00Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue([account()]);
  mockUnblock.mockResolvedValue(undefined);
});

describe('the list', () => {
  it('shows each blocked account by first name', async () => {
    const { findByText } = await render(<BlockedAccountsScreen />);

    // ⚠️ FIRST NAME ONLY — the same passport rule as every other surface where
    // a person appears. A surname or an avatar here would be a privacy
    // regression, and blocksApi parses .strict() to make one fail loudly.
    expect(await findByText('Sam')).toBeTruthy();
  });

  it('offers an undo on every row', async () => {
    const { findByText } = await render(<BlockedAccountsScreen />);

    expect(await findByText('Unblock')).toBeTruthy();
  });

  it('⚠️ says nothing is wrong when the list is empty', async () => {
    // The normal state. The copy explains what blocking is FOR rather than
    // inviting anyone to go and use it.
    mockFetch.mockResolvedValue([]);
    const { findByText } = await render(<BlockedAccountsScreen />);

    expect(await findByText('You haven’t blocked anyone')).toBeTruthy();
  });

  it('offers a retry when the list cannot load', async () => {
    // Failing closed to an empty list would read as "you have blocked nobody",
    // which is a lie that hides the control someone came here to use.
    mockFetch.mockRejectedValue(new Error('offline'));
    const { findByText } = await render(<BlockedAccountsScreen />);

    expect(await findByText('We couldn’t load this')).toBeTruthy();
  });
});

describe('unblocking', () => {
  it('calls the server with that account, and drops the row', async () => {
    const { findByText, queryByText } = await render(<BlockedAccountsScreen />);

    fireEvent.press(await findByText('Unblock'));

    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith(account().id));
    await waitFor(() => expect(queryByText('Sam')).toBeNull());
  });

  it('⚠️ keeps the row when the server refused', async () => {
    // The critical one: dropping the row optimistically on failure would tell
    // someone they had unblocked a person they had not, and the only way to
    // discover otherwise is to try to message them.
    mockUnblock.mockRejectedValue(new Error('We couldn’t unblock that account.'));
    const { findByText } = await render(<BlockedAccountsScreen />);

    fireEvent.press(await findByText('Unblock'));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(await findByText('Sam')).toBeTruthy();
  });

  it('does not fire twice while a request is in flight', async () => {
    let release: (v?: unknown) => void = () => {};
    mockUnblock.mockReturnValue(new Promise((r) => { release = r; }));
    const { findByText } = await render(<BlockedAccountsScreen />);

    const button = await findByText('Unblock');
    fireEvent.press(button);
    fireEvent.press(button);

    expect(mockUnblock).toHaveBeenCalledTimes(1);
    release();
  });
});
