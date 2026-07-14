/**
 * WHAT:  Tests for useAuthGate — the guest-first landing decision: splash
 *        while restoring, onboarding on first launch, the app for everyone
 *        else (member or guest).
 * WHY:   Guest-first is the load-bearing behaviour: a signed-OUT user must
 *        land in the app (not an auth wall) — regressing that reintroduces
 *        the wall the deferred-auth rework removed.
 * LINKS: src/features/auth/hooks/useAuthGate.ts, docs/TESTING.md.
 */

import { renderHook } from '@testing-library/react-native';

import { useAuthGate } from './useAuthGate';

const mockUseSession = jest.fn();
const mockUseOnboardingGate = jest.fn();

jest.mock('./useSession', () => ({ useSession: () => mockUseSession() }));
jest.mock('./useOnboardingGate', () => ({ useOnboardingGate: () => mockUseOnboardingGate() }));

const signedIn = { status: 'signedIn', userId: 'u1' };
const signedOut = { status: 'signedOut', userId: null };
const sessionLoading = { status: 'loading', userId: null };

beforeEach(() => jest.clearAllMocks());

describe('useAuthGate', () => {
  it('is loading while either the session or onboarding flag is loading', async () => {
    mockUseOnboardingGate.mockReturnValue('loading');
    mockUseSession.mockReturnValue(sessionLoading);
    const { result } = await renderHook(() => useAuthGate());
    expect(result.current).toBe('loading');
  });

  it('is loading while only the session is loading (onboarding seen)', async () => {
    mockUseOnboardingGate.mockReturnValue('seen');
    mockUseSession.mockReturnValue(sessionLoading);
    const { result } = await renderHook(() => useAuthGate());
    expect(result.current).toBe('loading');
  });

  it('routes to onboarding when unseen (before anything else)', async () => {
    mockUseOnboardingGate.mockReturnValue('unseen');
    mockUseSession.mockReturnValue(signedOut);
    const { result } = await renderHook(() => useAuthGate());
    expect(result.current).toBe('onboarding');
  });

  it('lands a signed-OUT user in the app as a guest — no auth wall', async () => {
    mockUseOnboardingGate.mockReturnValue('seen');
    mockUseSession.mockReturnValue(signedOut);
    const { result } = await renderHook(() => useAuthGate());
    expect(result.current).toBe('app');
  });

  it('lands a signed-in user in the app', async () => {
    mockUseOnboardingGate.mockReturnValue('seen');
    mockUseSession.mockReturnValue(signedIn);
    const { result } = await renderHook(() => useAuthGate());
    expect(result.current).toBe('app');
  });
});
