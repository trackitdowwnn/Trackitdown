/**
 * WHAT:  Tests for useSession — the three states, the live subscription, and
 *        the two ways it must fail safe.
 * WHY:   ⚠️ NO COVERAGE until 2026-09-02, on the single source of session state
 *        for the whole app. Every feature asks this hook rather than touching
 *        supabase.auth, so its mistakes are everyone's:
 *
 *        1. **'loading' is a real state, not a synonym for signed-out.** If the
 *           hook started at 'signedOut', every screen would flash an auth
 *           invitation at a signed-in user on every cold start — and the auth
 *           gate would fire mid-action.
 *        2. **An unreadable session is signed-OUT, never a hang.** SecureStore
 *           can fail (a restored backup, a corrupt keychain entry). Leaving the
 *           app on 'loading' forever would be a blank screen with no way out.
 *        3. **It unsubscribes.** onAuthStateChange fires app-wide; a leaked
 *           subscription calls setState on an unmounted hook for the rest of
 *           the session, once per auth event, per mount that ever happened.
 * LINKS: ./useSession.ts; src/shared/api/supabase.ts; docs/ARCHITECTURE.md
 *        (the feature map: auth owns session state).
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useSession } from './useSession';

const mockGetSession = jest.fn();
const mockUnsubscribe = jest.fn();
let authCallback: ((event: string, session: unknown) => void) | null = null;

jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
  },
}));

const mockMarkStartup = jest.fn();
jest.mock('@/shared/lib/startupTrace', () => ({
  markStartup: (...args: unknown[]) => mockMarkStartup(...args),
}));

const USER = '11111111-1111-1111-1111-111111111111';

/** A getSession promise this test controls the resolution of. */
function deferredSession() {
  let resolve!: (value: { data: { session: unknown } }) => void;
  mockGetSession.mockReturnValue(
    new Promise<{ data: { session: unknown } }>((r) => {
      resolve = r;
    }),
  );
  return resolve;
}

beforeEach(() => {
  mockGetSession.mockReset().mockResolvedValue({ data: { session: null } });
  mockUnsubscribe.mockReset();
  mockMarkStartup.mockReset();
  authCallback = null;
});

describe('useSession', () => {
  it('⚠️ starts on loading, not signedOut', async () => {
    const resolve = deferredSession();
    const { result } = await renderHook(() => useSession());

    // Before the persisted session is known. Reporting signedOut here flashes
    // an auth invitation at a signed-in user on every cold start.
    expect(result.current).toEqual({ status: 'loading', userId: null });

    await act(async () => {
      resolve({ data: { session: null } });
    });
    expect(result.current.status).toBe('signedOut');
  });

  it('resolves to signedIn and carries the user id', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: USER } } } });
    const { result } = await renderHook(() => useSession());

    await waitFor(() => expect(result.current.status).toBe('signedIn'));
    expect(result.current.userId).toBe(USER);
  });

  it('resolves to signedOut when there is no persisted session', async () => {
    const { result } = await renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    expect(result.current.userId).toBeNull();
  });

  it('⚠️ treats an unreadable session as signed out rather than hanging', async () => {
    // SecureStore can fail — a restored backup, a corrupt keychain entry.
    // Staying on 'loading' would be a blank screen with no way out of it.
    mockGetSession.mockRejectedValue(new Error('keychain unavailable'));
    const { result } = await renderHook(() => useSession());

    await waitFor(() => expect(result.current.status).toBe('signedOut'));
  });

  it('follows a later sign-in without a remount', async () => {
    const { result } = await renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('signedOut'));

    await act(async () => {
      authCallback?.('SIGNED_IN', { user: { id: USER } });
    });

    expect(result.current).toEqual({ status: 'signedIn', userId: USER });
  });

  it('follows a sign-out, so nothing keeps rendering member state', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: USER } } } });
    const { result } = await renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('signedIn'));

    await act(async () => {
      authCallback?.('SIGNED_OUT', null);
    });

    expect(result.current).toEqual({ status: 'signedOut', userId: null });
  });

  it('⚠️ unsubscribes on unmount', async () => {
    const { unmount, result } = await renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('signedOut'));

    await act(async () => {
      unmount();
    });

    // onAuthStateChange is app-wide. A leaked subscription sets state on an
    // unmounted hook for every auth event thereafter, once per mount that ever
    // happened.
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not set state after unmount when the session resolves late', async () => {
    const resolve = deferredSession();
    const { unmount } = await renderHook(() => useSession());

    await act(async () => {
      unmount();
    });
    // The `cancelled` flag exists for exactly this: a slow keychain read that
    // lands after the screen has gone.
    await act(async () => {
      resolve({ data: { session: { user: { id: USER } } } });
    });

    // markStartup is inside the same guard, so its absence is the observable
    // proof that nothing ran after unmount.
    expect(mockMarkStartup).not.toHaveBeenCalled();
  });

  it('marks the startup phase once the session is known either way', async () => {
    const { result } = await renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe('signedOut'));

    expect(mockMarkStartup).toHaveBeenCalledWith('session_ready');
  });
});
