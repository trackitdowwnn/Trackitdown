/**
 * WHAT:  Tests for useAuthStanding — guest / incomplete / member resolution
 *        over the session + profiles-row check, the fail-safe on a check
 *        error, and the invalidateProfileCheck re-run.
 * WHY:   Standing is what the gate and the AuthSheet resolve on; 'member'
 *        must mean session AND profile row (a continued action may rely on
 *        the row), and a check failure must fail toward the profile step,
 *        never into the app.
 * LINKS: src/features/auth/hooks/useAuthStanding.ts, docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { invalidateProfileCheck, useAuthStanding } from './useAuthStanding';

const mockUseSession = jest.fn();
const mockHasProfile = jest.fn();

jest.mock('./useSession', () => ({ useSession: () => mockUseSession() }));
jest.mock('../api/authApi', () => ({ hasProfile: (...a: unknown[]) => mockHasProfile(...a) }));

const signedIn = { status: 'signedIn', userId: 'u1' };
const signedOut = { status: 'signedOut', userId: null };
const sessionLoading = { status: 'loading', userId: null };

beforeEach(() => jest.clearAllMocks());

describe('useAuthStanding', () => {
  it('is loading while the session restores', async () => {
    mockUseSession.mockReturnValue(sessionLoading);
    const { result } = await renderHook(() => useAuthStanding());
    expect(result.current).toBe('loading');
  });

  it('is guest when signed out', async () => {
    mockUseSession.mockReturnValue(signedOut);
    const { result } = await renderHook(() => useAuthStanding());
    expect(result.current).toBe('guest');
  });

  it('is member when signed in with a profile row', async () => {
    mockUseSession.mockReturnValue(signedIn);
    mockHasProfile.mockResolvedValue(true);
    const { result } = await renderHook(() => useAuthStanding());
    await waitFor(() => expect(result.current).toBe('member'));
  });

  it('is incomplete when signed in without a profile row', async () => {
    mockUseSession.mockReturnValue(signedIn);
    mockHasProfile.mockResolvedValue(false);
    const { result } = await renderHook(() => useAuthStanding());
    await waitFor(() => expect(result.current).toBe('incomplete'));
  });

  it('fails safe to incomplete when the profile check errors', async () => {
    mockUseSession.mockReturnValue(signedIn);
    mockHasProfile.mockRejectedValue(new Error('network'));
    const { result } = await renderHook(() => useAuthStanding());
    await waitFor(() => expect(result.current).toBe('incomplete'));
  });

  it('re-checks and flips to member after invalidateProfileCheck', async () => {
    mockUseSession.mockReturnValue(signedIn);
    mockHasProfile.mockResolvedValueOnce(false);
    const { result } = await renderHook(() => useAuthStanding());
    await waitFor(() => expect(result.current).toBe('incomplete'));

    mockHasProfile.mockResolvedValueOnce(true); // the row was just created
    await act(async () => {
      invalidateProfileCheck();
    });
    await waitFor(() => expect(result.current).toBe('member'));
  });

  it('a re-check for the SAME user never bounces through loading (stale-while-revalidate)', async () => {
    // Regression pin: a 'loading' blip here made the AuthSheet slide from the
    // profile step back to the OTP step for the duration of the re-check.
    mockUseSession.mockReturnValue(signedIn);
    let resolveRecheck: (v: boolean) => void = () => {};
    mockHasProfile.mockResolvedValueOnce(false);
    const { result } = await renderHook(() => useAuthStanding());
    await waitFor(() => expect(result.current).toBe('incomplete'));

    // Hold the re-check open so the in-flight window is observable.
    mockHasProfile.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (resolveRecheck = resolve)),
    );
    await act(async () => {
      invalidateProfileCheck();
    });
    expect(result.current).toBe('incomplete'); // stale, NOT 'loading'

    await act(async () => {
      resolveRecheck(true);
    });
    await waitFor(() => expect(result.current).toBe('member'));
  });
});
