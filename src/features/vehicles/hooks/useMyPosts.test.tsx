/**
 * WHAT:  Tests for useMyPosts — guests resolve instantly empty (never error),
 *        a signed-in user loads their posts to 'ready', and a failed initial
 *        load surfaces 'error'. The session-keying + refresh idioms mirror
 *        useWatchlist (whose own test covers the shared edge cases).
 * WHY:   The My Listings screen branches entirely on this hook's status, and the
 *        guest-empty-not-error rule is the one that keeps the signed-out screen
 *        an invitation rather than a failure.
 * LINKS: src/features/vehicles/hooks/useMyPosts.ts, docs/TESTING.md.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useMyPosts } from './useMyPosts';

const mockListMyPosts = jest.fn();
jest.mock('../api/myPostsApi', () => ({
  listMyPosts: () => mockListMyPosts(),
}));

const mockUseSession = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockUseSession(),
}));

// useFocusEffect: no-op here — the mount fetch comes from the plain useEffect,
// and invoking the focus callback on every render would loop the refetch.
jest.mock('expo-router', () => ({
  useFocusEffect: () => {},
}));

beforeEach(() => jest.clearAllMocks());

const summary = {
  id: 'p1',
  photos: [],
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: null,
  status: 'draft' as const,
  lastSeenAt: '2026-07-08T12:00:00Z',
  bountyPence: 50000,
};

describe('useMyPosts', () => {
  it('resolves a guest to ready + empty without calling the API', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
    const { result } = await renderHook(() => useMyPosts());
    expect(result.current.status).toBe('ready');
    expect(result.current.posts).toEqual([]);
    expect(mockListMyPosts).not.toHaveBeenCalled();
  });

  it('loads a signed-in user’s posts to ready', async () => {
    mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'u1' });
    mockListMyPosts.mockResolvedValue([summary]);
    const { result } = await renderHook(() => useMyPosts());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.posts).toEqual([summary]);
  });

  it('surfaces error when the initial load fails', async () => {
    mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'u1' });
    mockListMyPosts.mockRejectedValue(new Error('boom'));
    const { result } = await renderHook(() => useMyPosts());
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
