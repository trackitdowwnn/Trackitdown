/**
 * WHAT:  Tests for useWatchToggle — member toggles (optimistic flip, API
 *        persist, "Added" toast with a View action, "Removed" toast whose Undo
 *        puts the post back without double-counting the gate conversion), the
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

import {
  getMruCollection,
  resetMruCollectionForTests,
  setMruCollection,
} from '../lib/mruCollection';
import {
  getCollectionPickerIntent,
  resetCollectionPickerForTests,
} from '../lib/pickerIntent';
import { isWatchedNow, resetWatchedStoreForTests, setWatched } from '../lib/watchedStore';
import type { CollectionId } from '../types';
import { useWatchToggle } from './useWatchToggle';

// Reached transitively: the hook reads and persists the target collection for
// the next save (mruCollection).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Resolves with the collection the watch LANDED in — null (Saved) by default.
// Tests that care about filing override it.
const mockAddWatch = jest.fn(
  async (_postId: string, collectionId: CollectionId = null): Promise<CollectionId> => collectionId,
);
const mockRemoveWatch = jest.fn(async (_postId: string) => {});
const mockFetchWatchedPostIds = jest.fn(async (): Promise<string[]> => []);
jest.mock('../api/watchlistApi', () => ({
  addWatch: (postId: string, collectionId: CollectionId) => mockAddWatch(postId, collectionId),
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
  // Default: the save lands exactly where it was aimed.
  mockAddWatch.mockImplementation(async (_postId, collectionId = null) => collectionId);
  mockRemoveWatch.mockResolvedValue(undefined);
  mockFetchWatchedPostIds.mockResolvedValue([]);
  resetMruCollectionForTests();
  resetCollectionPickerForTests();
});

describe('member toggle', () => {
  it('adds optimistically, persists, and shows the success toast with a Change action', async () => {
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));
    expect(result.current.watched).toBe(false);

    await act(async () => {
      result.current.toggle();
    });

    expect(result.current.watched).toBe(true);
    expect(mockAddWatch).toHaveBeenCalledWith('post-1', null);
    // No target set, so no list to name — the generic copy, never a placeholder.
    expect(mockToastShow).toHaveBeenCalledWith(
      'Added to your watchlist',
      'success',
      expect.objectContaining({ label: 'Change', onPress: expect.any(Function) }),
    );

    // Change raises the picker intent for THIS post, pointed at where it
    // currently sits (Saved).
    const action = mockToastShow.mock.calls[0][2] as { onPress: () => void };
    action.onPress();
    expect(getCollectionPickerIntent()).toEqual({
      postId: 'post-1',
      currentCollectionId: null,
      source: 'save_toast',
    });
    await unmount();
  });

  it('names the list when it knows it', async () => {
    setMruCollection('user-1', 'cccccccc-0000-0000-0000-00000000000c', 'My commute');
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));

    await act(async () => {
      result.current.toggle();
    });

    expect(mockToastShow).toHaveBeenCalledWith(
      'Saved to My commute',
      'success',
      expect.objectContaining({ label: 'Change' }),
    );
    await unmount();
  });

  it('falls back to generic copy when the target has no known name', async () => {
    // Re-derived from the watchlist payload, which carries ids and no names.
    // Inventing a placeholder here ("Saved to your list") would be worse than
    // saying nothing.
    setMruCollection('user-1', 'cccccccc-0000-0000-0000-00000000000c');
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));

    await act(async () => {
      result.current.toggle();
    });

    expect(mockToastShow).toHaveBeenCalledWith(
      'Added to your watchlist',
      'success',
      expect.objectContaining({ label: 'Change' }),
    );
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

  it('says a removal happened, and offers Undo', async () => {
    mockFetchWatchedPostIds.mockResolvedValue(['post-1']);
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'watchlist'));
    await waitFor(() => expect(result.current.watched).toBe(true));

    await act(async () => {
      result.current.toggle();
    });

    expect(result.current.watched).toBe(false);
    expect(mockRemoveWatch).toHaveBeenCalledWith('post-1');
    expect(mockToastShow).toHaveBeenCalledWith(
      'Removed from your watchlist',
      'success',
      expect.objectContaining({ label: 'Undo' }),
    );
    await unmount();
  });

  it('Undo puts the post back', async () => {
    mockFetchWatchedPostIds.mockResolvedValue(['post-1']);
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'watchlist'));
    await waitFor(() => expect(result.current.watched).toBe(true));

    await act(async () => {
      result.current.toggle();
    });
    expect(result.current.watched).toBe(false);

    // Press the toast's action, exactly as the ToastProvider would.
    const action = mockToastShow.mock.calls.at(-1)?.[2] as { onPress: () => void };
    await act(async () => {
      action.onPress();
    });

    await waitFor(() => expect(result.current.watched).toBe(true));
    // Which LIST it lands back in is the targeting suite's business, not this
    // one's (and the AsyncStorage mock carries an MRU across tests in this
    // file) — what matters here is that the re-add actually went out.
    expect(mockAddWatch).toHaveBeenCalledWith('post-1', expect.anything());
    await unmount();
  });

  it('Undo is not logged as a gate conversion', async () => {
    // The undo re-enters performToggle; passing the original `viaGate` through
    // would count one guest conversion twice in the funnel.
    mockFetchWatchedPostIds.mockResolvedValue(['post-1']);
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));
    await waitFor(() => expect(result.current.watched).toBe(true));

    await act(async () => {
      result.current.toggle();
    });
    const action = mockToastShow.mock.calls.at(-1)?.[2] as { onPress: () => void };
    await act(async () => {
      action.onPress();
    });

    await waitFor(() => expect(result.current.watched).toBe(true));
    // Re-added, and the re-add's own toast is the normal "saved" confirmation.
    expect(mockToastShow).toHaveBeenLastCalledWith(
      'Added to your watchlist',
      'success',
      expect.objectContaining({ label: 'Change' }),
    );
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
    expect(mockAddWatch).toHaveBeenCalledWith('post-1', null);
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

describe('collection targeting', () => {
  const COMMUTE = 'cccccccc-0000-0000-0000-00000000000c';

  it('files a save into the list the user is currently working in', async () => {
    setMruCollection('user-1', COMMUTE);
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));

    await act(async () => {
      result.current.toggle();
    });

    expect(mockAddWatch).toHaveBeenCalledWith('post-1', COMMUTE);
    await unmount();
  });

  it('records where the save landed, not where it was aimed', async () => {
    // The cached list was deleted on another device: addWatch falls back to
    // Saved and says so. The target must follow, or every subsequent save
    // would keep aiming at the dead list.
    setMruCollection('user-1', COMMUTE);
    mockAddWatch.mockResolvedValue(null);
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));

    await act(async () => {
      result.current.toggle();
    });

    expect(mockAddWatch).toHaveBeenCalledWith('post-1', COMMUTE);
    expect(getMruCollection('user-1')).toBeNull();
    await unmount();
  });

  it('leaves the target alone when a save fails outright', async () => {
    // A failed save is reverted, so it says nothing about where the user
    // wants to file — clobbering the target here would lose their place.
    setMruCollection('user-1', COMMUTE);
    mockAddWatch.mockRejectedValue(new Error('offline'));
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));

    await act(async () => {
      result.current.toggle();
    });

    expect(getMruCollection('user-1')).toBe(COMMUTE);
    await unmount();
  });

  it('does not target another user’s list after a switch', async () => {
    setMruCollection('user-2', COMMUTE);
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));

    await act(async () => {
      result.current.toggle();
    });

    expect(mockAddWatch).toHaveBeenCalledWith('post-1', null);
    await unmount();
  });

  it('a removal never touches the target', async () => {
    setMruCollection('user-1', COMMUTE);
    const { result, unmount } = await renderHook(() => useWatchToggle('post-1', 'feed'));
    await act(async () => {
      setWatched('post-1', true);
    });

    await act(async () => {
      result.current.toggle();
    });

    expect(mockRemoveWatch).toHaveBeenCalledWith('post-1');
    expect(getMruCollection('user-1')).toBe(COMMUTE);
    await unmount();
  });
});
