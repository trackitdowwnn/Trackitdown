/**
 * WHAT:  Tests for useProfileTab — the label/icon across all four states
 *        (guest, incomplete, member-no-avatar, member-with-avatar), the LIVE
 *        avatar swap on invalidateMyProfile (EditProfile save → tab icon),
 *        and the hold-and-sheet tabPress contract: a non-member's press is
 *        prevented and gated with 'tab_profile', a member's press is not
 *        touched, and the continuation lands on the Profile tab.
 * WHY:   This hook encodes the deliberate Profile-only override of "tabs get
 *        invitations, sheets fire on actions" (features/auth/README.md) — a
 *        regression here either walls a guest mid-app or navigates them onto
 *        a screen they dismissed the sheet to avoid. It runs against the REAL
 *        useMyProfile so the shared-invalidation liveness is what's proven,
 *        not a mock of it.
 * LINKS: src/features/profile/hooks/useProfileTab.ts; docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { MyProfile } from '../types';
import { invalidateMyProfile } from './useMyProfile';
import { useProfileTab } from './useProfileTab';

const mockStanding = jest.fn();
const mockRequireAuth = jest.fn();
const mockUseSession = jest.fn();
const mockFetchMyProfile = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@/features/auth', () => ({
  useAuthStanding: () => mockStanding(),
  useRequireAuth: () => mockRequireAuth,
  useSession: () => mockUseSession(),
}));
jest.mock('../api/profileApi', () => ({
  fetchMyProfile: (...a: unknown[]) => mockFetchMyProfile(...a),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}));

const signedIn = { status: 'signedIn', userId: 'u1' };
const signedOut = { status: 'signedOut', userId: null };

const profileWith = (avatarUrl: string | null): MyProfile => ({
  id: 'u1',
  firstName: 'Ollie',
  displayName: 'Ollie B',
  avatarUrl,
  createdAt: '2026-01-01T00:00:00Z',
  counters: { sightingsReported: 0, sightingsHelpful: 0, recoveriesCredited: 0 },
});

const pressEvent = () => ({ preventDefault: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('label and icon across the four states', () => {
  it('guest: "Profile", person icon (no iconUri)', async () => {
    mockStanding.mockReturnValue('guest');
    mockUseSession.mockReturnValue(signedOut);
    const { result } = await renderHook(() => useProfileTab());
    expect(result.current.label).toBe('Profile');
    expect(result.current.iconUri).toBeNull();
  });

  it('incomplete (orphaned session) reads as signed-out: "Profile", no iconUri', async () => {
    mockStanding.mockReturnValue('incomplete');
    mockUseSession.mockReturnValue(signedIn);
    mockFetchMyProfile.mockResolvedValue(profileWith(null));
    const { result } = await renderHook(() => useProfileTab());
    expect(result.current.label).toBe('Profile');
    expect(result.current.iconUri).toBeNull();
  });

  it('member without an avatar: "You", person icon stays (no initials substitute)', async () => {
    mockStanding.mockReturnValue('member');
    mockUseSession.mockReturnValue(signedIn);
    mockFetchMyProfile.mockResolvedValue(profileWith(null));
    const { result } = await renderHook(() => useProfileTab());
    await waitFor(() => expect(result.current.label).toBe('You'));
    expect(result.current.iconUri).toBeNull();
  });

  it('member with an avatar: "You" plus the avatar as iconUri', async () => {
    mockStanding.mockReturnValue('member');
    mockUseSession.mockReturnValue(signedIn);
    mockFetchMyProfile.mockResolvedValue(profileWith('https://cdn/avatars/u1.jpg?v=1'));
    const { result } = await renderHook(() => useProfileTab());
    await waitFor(() =>
      expect(result.current.iconUri).toBe('https://cdn/avatars/u1.jpg?v=1'),
    );
    expect(result.current.label).toBe('You');
  });
});

describe('live avatar changes', () => {
  it('invalidateMyProfile (EditProfile save) swaps the tab avatar without a remount', async () => {
    mockStanding.mockReturnValue('member');
    mockUseSession.mockReturnValue(signedIn);
    mockFetchMyProfile.mockResolvedValue(profileWith('https://cdn/avatars/u1.jpg?v=1'));
    const { result } = await renderHook(() => useProfileTab());
    await waitFor(() =>
      expect(result.current.iconUri).toBe('https://cdn/avatars/u1.jpg?v=1'),
    );

    // The upload replaced the photo; updated_at cache-busts the URL (?v=2).
    mockFetchMyProfile.mockResolvedValue(profileWith('https://cdn/avatars/u1.jpg?v=2'));
    await act(async () => {
      invalidateMyProfile();
    });
    await waitFor(() =>
      expect(result.current.iconUri).toBe('https://cdn/avatars/u1.jpg?v=2'),
    );
  });

  it('iconUri survives the refetch window — no flicker to the person icon', async () => {
    mockStanding.mockReturnValue('member');
    mockUseSession.mockReturnValue(signedIn);
    mockFetchMyProfile.mockResolvedValue(profileWith('https://cdn/avatars/u1.jpg?v=1'));
    const { result } = await renderHook(() => useProfileTab());
    await waitFor(() =>
      expect(result.current.iconUri).toBe('https://cdn/avatars/u1.jpg?v=1'),
    );

    // Hold the refetch open: the stale-while-revalidate window is observable.
    let resolveRefetch: (p: MyProfile) => void = () => {};
    mockFetchMyProfile.mockImplementationOnce(
      () => new Promise<MyProfile>((resolve) => (resolveRefetch = resolve)),
    );
    await act(async () => {
      invalidateMyProfile();
    });
    // Mid-refetch (e.g. a Profile-tab refocus): the OLD avatar stays put.
    expect(result.current.iconUri).toBe('https://cdn/avatars/u1.jpg?v=1');
    expect(result.current.label).toBe('You');

    await act(async () => {
      resolveRefetch(profileWith('https://cdn/avatars/u1.jpg?v=2'));
    });
    await waitFor(() =>
      expect(result.current.iconUri).toBe('https://cdn/avatars/u1.jpg?v=2'),
    );
  });
});

describe('tabPress: hold-and-sheet for non-members only', () => {
  it('guest press is prevented and gated with tab_profile — navigation untouched', async () => {
    mockStanding.mockReturnValue('guest');
    mockUseSession.mockReturnValue(signedOut);
    const { result } = await renderHook(() => useProfileTab());

    const event = pressEvent();
    result.current.listeners.tabPress(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockRequireAuth).toHaveBeenCalledWith({
      context: 'tab_profile',
      run: expect.any(Function),
    });
    // Dismissing the sheet drops the intent (gate behaviour): nothing here
    // navigated, so the guest stays exactly where they were.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("the gate's continuation lands on the Profile tab", async () => {
    mockStanding.mockReturnValue('guest');
    mockUseSession.mockReturnValue(signedOut);
    const { result } = await renderHook(() => useProfileTab());

    result.current.listeners.tabPress(pressEvent());
    const intent = mockRequireAuth.mock.calls[0][0] as { run: () => void };
    intent.run();
    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/profile');
  });

  it('a member press is left alone (normal navigation, no gate)', async () => {
    mockStanding.mockReturnValue('member');
    mockUseSession.mockReturnValue(signedIn);
    mockFetchMyProfile.mockResolvedValue(profileWith(null));
    const { result } = await renderHook(() => useProfileTab());
    await waitFor(() => expect(result.current.label).toBe('You'));

    const event = pressEvent();
    result.current.listeners.tabPress(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it("'loading' standing gates too — the sheet self-resolves for a restoring member", async () => {
    mockStanding.mockReturnValue('loading');
    mockUseSession.mockReturnValue({ status: 'loading', userId: null });
    const { result } = await renderHook(() => useProfileTab());

    const event = pressEvent();
    result.current.listeners.tabPress(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'tab_profile' }),
    );
  });
});
