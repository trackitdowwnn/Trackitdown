/**
 * WHAT:  Tests for useWatchToggle — member toggles (optimistic flip, API
 *        persist, "Added" toast with a View action, quiet removal), the
 *        failure revert + error toast, and the guest gate: the intent
 *        continuation completes the watch post-auth, logging the
 *        conversion, and reads watch state at RUN time, not tap time.
 * WHY:   This hook IS the feature's surface API on every card and header;
 *        a stale continuation would un-watch a post the user just watched
 *        through the auth sheet — the exact conversion moment we care
 *        about most.
 * LINKS: src/features/watchlist/hooks/useWatchToggle.ts;
 *        src/features/watchlist/lib/watchedStore.ts; docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { SessionState } from '@/features/auth';

import { isWatchedNow, resetWatchedStoreForTests, setWatched } from '../lib/watchedStore';
import { useWatchToggle } from './useWatchToggle';

const mockAddWatch = jest.fn(async (_postId: string) => {});
const mockRemoveWatch = jest.fn(async (_postId: string) => {});
const mockFetchWatchedPostIds = jest.fn(async (): Promise<string[]> => []);
jest.mock('../api/watchlistApi', () => ({
  addWatch: (postId: string) => mockAddWatch(postId),
  removeWatch: (postId: string) => mockRemoveWatch(postId),
  fetchWatchedPostIds: () => mockFetchWatchedPostIds(),
}));

let mockSession: SessionState;
// Member: run the intent immediately (the gate's member path). Guest: store
// the continuation so tests can run it "post-auth".
let mockPendingIntent: { context: string; run?: () => void } | null;
const mockRequireAuth = jest.fn((intent: { context: string; run?: () => void }) => {
  if (mockSession.status === 'signedIn') {
    intent.run?.();
  } else {
    mockPendingIntent = intent;
  }
});
jest.mock('@/features/auth', () => ({
  useRequireAuth: () => mockRequireAuth,
  useSession: () => mockSession,
}));

const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => ({
  useToast: () => ({ show: mockToastShow }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetWatchedStoreForTests();
  mockPendingIntent = null;
  mockSession = { status: 'signedIn', userId: 'user-1' };
  mockAddWatch.mockResolvedValue(undefined);
  mockRemoveWatch.mockResolvedValue(undefined);
  mockFetchWatchedPostIds.mockResolvedValue([]);
});

describe('member toggle', () => {
  it('adds optimistically, persists, and shows the success toast with a View action', async () => {
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));
    expect(result.current.watched).toBe(false);

    await act(async () => {
      result.current.toggle();
    });

    expect(result.current.watched).toBe(true);
    expect(mockAddWatch).toHaveBeenCalledWith('post-1');
    expect(mockToastShow).toHaveBeenCalledWith(
      'Added to your watchlist',
      'success',
      expect.objectContaining({ label: 'View', onPress: expect.any(Function) }),
    );

    // The View action navigates to the Watchlist tab.
    const action = mockToastShow.mock.calls[0][2] as { onPress: () => void };
    action.onPress();
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/watchlist');
    await unmount();
  });

  it('reverts the flip and shows an error toast when the add fails', async () => {
    mockAddWatch.mockRejectedValueOnce(new Error('rls says no'));
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'detail'));

    await act(async () => {
      result.current.toggle();
    });

    await waitFor(() => expect(result.current.watched).toBe(false));
    expect(mockToastShow).toHaveBeenCalledWith(
      "Couldn't add to your watchlist — try again.",
      'error',
    );
    await unmount();
  });

  it('removes quietly — no success toast, just the delete', async () => {
    mockFetchWatchedPostIds.mockResolvedValue(['post-1']);
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'watchlist'));
    await waitFor(() => expect(result.current.watched).toBe(true));

    await act(async () => {
      result.current.toggle();
    });

    expect(result.current.watched).toBe(false);
    expect(mockRemoveWatch).toHaveBeenCalledWith('post-1');
    expect(mockToastShow).not.toHaveBeenCalled();
    await unmount();
  });

  it('reverts a failed removal and says so', async () => {
    mockFetchWatchedPostIds.mockResolvedValue(['post-1']);
    mockRemoveWatch.mockRejectedValueOnce(new Error('offline'));
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));
    await waitFor(() => expect(result.current.watched).toBe(true));

    await act(async () => {
      result.current.toggle();
    });

    await waitFor(() => expect(result.current.watched).toBe(true));
    expect(mockToastShow).toHaveBeenCalledWith("Couldn't remove — try again.", 'error');
    await unmount();
  });
});

describe('guest gate', () => {
  beforeEach(() => {
    mockSession = { status: 'signedOut', userId: null };
  });

  it('gates the tap with the watch_post context and does nothing until the continuation runs', async () => {
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));

    await act(async () => {
      result.current.toggle();
    });

    expect(mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'watch_post', run: expect.any(Function) }),
    );
    expect(result.current.watched).toBe(false);
    expect(mockAddWatch).not.toHaveBeenCalled();

    // Post-auth: the stored continuation completes the watch and logs the
    // conversion path (asserted via effects: persisted add + watched state).
    await act(async () => {
      mockPendingIntent?.run?.();
    });

    expect(isWatchedNow('post-1')).toBe(true);
    expect(mockAddWatch).toHaveBeenCalledWith('post-1');
    await unmount();
  });

  it('the continuation reads watch state at RUN time, not tap time', async () => {
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'map'));

    // Tap while unwatched (tap-time state says "next = add").
    await act(async () => {
      result.current.toggle();
    });

    // Before the continuation runs, hydration-after-login reveals the post
    // is ALREADY watched (e.g. watched on another device).
    await act(async () => {
      setWatched('post-1', true);
    });

    await act(async () => {
      mockPendingIntent?.run?.();
    });

    // A stale render-captured value would re-add; the run-time read removes.
    expect(isWatchedNow('post-1')).toBe(false);
    expect(mockRemoveWatch).toHaveBeenCalledWith('post-1');
    expect(mockAddWatch).not.toHaveBeenCalled();
    await unmount();
  });
});
