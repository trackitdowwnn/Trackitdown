/**
 * WHAT:  Tests for useThreadPeer — loads the peer view for a signed-in
 *        participant, refreshes on refocus, fails SOFT, and never serves a
 *        stale thread's data after a switch.
 * WHY:   This data decorates a conversation (Seen, the profile tap); a
 *        failure to load it must degrade to "no decoration", never a broken
 *        thread. The stale-guard test is the load-bearing one (review C1):
 *        without it, a slow response for thread A landing after a switch to
 *        thread B would render B's "Seen" from A's marker and open A's
 *        peer profile from B's header.
 * LINKS: src/features/chat/hooks/useThreadPeer.ts;
 *        src/features/chat/api/chatApi.ts (fetchThreadPeer).
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { SessionState } from '@/features/auth';

import type { ThreadPeer } from '../api/chatApi';
import { useThreadPeer } from './useThreadPeer';

let mockFocusCallback: (() => void | (() => void)) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    mockFocusCallback = cb;
    // Simulate the first focus, as the real hook fires on mount-focus.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
    const { useEffect } = require('react');
    useEffect(() => cb(), [cb]);
  },
}));

let mockSession: SessionState;
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession,
}));

const mockFetch = jest.fn();
jest.mock('../api/chatApi', () => ({
  get fetchThreadPeer() {
    return mockFetch;
  },
}));

const OWNER_VIEW: ThreadPeer = {
  theirLastReadAt: '2026-07-15T10:00:00Z',
  blocked: false,
  peer: {
    firstName: 'Sam',
    avatarUrl: null,
    createdAt: '2026-05-01T10:00:00Z',
    counters: { sightingsReported: 4, sightingsHelpful: 2, recoveriesCredited: 1 },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  mockSession = { status: 'signedIn', userId: 'me' };
  mockFetch.mockResolvedValue(OWNER_VIEW);
});

describe('useThreadPeer', () => {
  it('loads the peer view for a signed-in participant', async () => {
    const { result, unmount } = await renderHook(() => useThreadPeer('t1'));

    await waitFor(() => expect(result.current).toEqual(OWNER_VIEW));
    expect(mockFetch).toHaveBeenCalledWith('t1');
    await unmount();
  });

  it('never fires for a guest', async () => {
    mockSession = { status: 'signedOut', userId: null };
    const { result, unmount } = await renderHook(() => useThreadPeer('t1'));

    expect(result.current).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    await unmount();
  });

  it('a spotter view carries the marker with no profile', async () => {
    const spotterView: ThreadPeer = { theirLastReadAt: '2026-07-15T10:00:00Z', blocked: false, peer: null };
    mockFetch.mockResolvedValue(spotterView);
    const { result, unmount } = await renderHook(() => useThreadPeer('t1'));

    await waitFor(() => expect(result.current).toEqual(spotterView));
    await unmount();
  });

  it('fails SOFT — a load error means no decoration, not a crash', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result, unmount } = await renderHook(() => useThreadPeer('t1'));

    await act(async () => {});
    expect(result.current).toBeNull();
    await unmount();
  });

  it('refetches on refocus — the peer reads while this screen is blurred', async () => {
    const { result, unmount } = await renderHook(() => useThreadPeer('t1'));
    await waitFor(() => expect(result.current).toEqual(OWNER_VIEW));

    const moved: ThreadPeer = { ...OWNER_VIEW, theirLastReadAt: '2026-07-15T12:00:00Z' };
    mockFetch.mockResolvedValue(moved);
    await act(async () => {
      mockFocusCallback?.();
    });

    await waitFor(() => expect(result.current).toEqual(moved));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('a stale response never lands after a thread switch', async () => {
    // Thread A's fetch hangs; we switch to thread B; A's response arrives
    // late. Serving it would show B's header with A's peer.
    let releaseA: (value: ThreadPeer) => void = () => {};
    mockFetch.mockImplementationOnce(
      () => new Promise<ThreadPeer>((resolve) => (releaseA = resolve)),
    );
    const bView: ThreadPeer = { theirLastReadAt: '2026-07-15T13:00:00Z', blocked: false, peer: null };

    const { result, rerender, unmount } = await renderHook(
      ({ id }: { id: string }) => useThreadPeer(id),
      { initialProps: { id: 'thread-a' } },
    );

    mockFetch.mockResolvedValue(bView);
    await act(async () => {
      rerender({ id: 'thread-b' });
    });
    await waitFor(() => expect(result.current).toEqual(bView));

    await act(async () => {
      releaseA(OWNER_VIEW);
    });

    expect(result.current).toEqual(bView);
    await unmount();
  });

  it('clears the previous thread’s peer while the switch is in flight', async () => {
    const { result, rerender, unmount } = await renderHook(
      ({ id }: { id: string }) => useThreadPeer(id),
      { initialProps: { id: 'thread-a' } },
    );
    await waitFor(() => expect(result.current).toEqual(OWNER_VIEW));

    // Thread B's fetch never resolves: A's peer must not be shown meanwhile.
    mockFetch.mockImplementation(() => new Promise<ThreadPeer>(() => {}));
    await act(async () => {
      rerender({ id: 'thread-b' });
    });

    expect(result.current).toBeNull();
    await unmount();
  });
});
