/**
 * WHAT:  Tests for useInboxBadgeSync — the Inbox tab badge is counted at
 *        sign-in, on return to the foreground and when a push arrives, without
 *        the Inbox ever being opened; a failed half keeps its last value; a
 *        sign-out clears it.
 * WHY:   Owner report, 2026-09-24: the badge only appeared after the Inbox was
 *        opened, because the Inbox's own hooks were its only reporters.
 * LINKS: src/features/chat/hooks/useInboxBadgeSync.ts.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useInboxBadgeSync } from './useInboxBadgeSync';

const mockSetBadge = jest.fn();
jest.mock('@/shared/ui', () => ({ useTabBadges: () => ({ setBadge: mockSetBadge }) }));

const mockUseSession = jest.fn();
jest.mock('@/features/auth', () => ({ useSession: () => mockUseSession() }));

// The real aggregator, without the rest of the notifications barrel.
const mockUnreadCount = jest.fn();
jest.mock('@/features/notifications', () => ({
  ...jest.requireActual('@/features/notifications/lib/inboxBadge'),
  fetchUnreadNotificationCount: () => mockUnreadCount(),
}));
const mockFetchInbox = jest.fn();
jest.mock('../api/chatApi', () => ({ fetchInbox: () => mockFetchInbox() }));

let mockPushListener: (() => void) | null = null;
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (fn: () => void) => {
    mockPushListener = fn;
    return { remove: jest.fn() };
  },
}));

const { resetInboxBadge } = jest.requireActual('@/features/notifications/lib/inboxBadge');

const thread = (unreadCount: number) => ({ unreadCount });

let appStateListener: ((state: string) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  resetInboxBadge();
  mockPushListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListener = fn as (state: string) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'u1' });
  mockFetchInbox.mockResolvedValue([thread(2), thread(0)]);
  mockUnreadCount.mockResolvedValue(1);
});

afterEach(() => jest.restoreAllMocks());

const flush = () => act(async () => {});

describe('useInboxBadgeSync', () => {
  it('counts both halves at sign-in, without the Inbox being opened', async () => {
    await renderHook(() => useInboxBadgeSync());
    await flush();

    expect(mockSetBadge).toHaveBeenLastCalledWith('inbox', 3); // 2 chat + 1 center
  });

  it('recounts when the app returns to the foreground', async () => {
    await renderHook(() => useInboxBadgeSync());
    await flush();
    mockFetchInbox.mockResolvedValue([thread(5)]);

    await act(async () => {
      appStateListener?.('active');
    });

    expect(mockSetBadge).toHaveBeenLastCalledWith('inbox', 6);
  });

  it('recounts when a push arrives with the app open', async () => {
    await renderHook(() => useInboxBadgeSync());
    await flush();
    mockUnreadCount.mockResolvedValue(3);

    await act(async () => {
      mockPushListener?.();
    });

    expect(mockSetBadge).toHaveBeenLastCalledWith('inbox', 5);
  });

  it('keeps a half that failed to load at its last value', async () => {
    await renderHook(() => useInboxBadgeSync());
    await flush();
    mockFetchInbox.mockRejectedValue(new Error('offline'));
    mockUnreadCount.mockResolvedValue(0);

    await act(async () => {
      appStateListener?.('active');
    });

    expect(mockSetBadge).toHaveBeenLastCalledWith('inbox', 2); // chat's 2 kept
  });

  it('clears the badge for a guest and fetches nothing', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
    await renderHook(() => useInboxBadgeSync());
    await flush();

    expect(mockFetchInbox).not.toHaveBeenCalled();
    expect(mockSetBadge).toHaveBeenLastCalledWith('inbox', 0);
  });
});
