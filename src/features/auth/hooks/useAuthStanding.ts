/**
 * WHAT:  useAuthStanding — the user's auth standing for the deferred-auth gate:
 *        'loading' (session/profile still restoring) | 'guest' (signed out) |
 *        'incomplete' (signed in, no profiles row yet) | 'member' (signed in
 *        with a profile). Composes the session with a live profiles-row check.
 * WHY:   Guests browse freely, so standing is consulted per ACTION (via
 *        useRequireAuth), not per route. 'incomplete' is its own state so a
 *        cold start with an orphaned session (app killed mid-sign-up) browses
 *        as a guest-like user and the NEXT gated action opens the sheet
 *        directly at the profile step — never a full-screen wall.
 * LINKS: src/features/auth/gate/useRequireAuth.ts, components/AuthSheet.tsx
 *        (consumers); hooks/useAuthGate.ts (splash/onboarding only);
 *        authApi.hasProfile.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { hasProfile } from '../api/authApi';
import { useSession } from './useSession';

export type AuthStanding = 'loading' | 'guest' | 'incomplete' | 'member';

type ProfileState = 'unknown' | 'missing' | 'present';

// A tiny external store so a just-created profile forces the check to re-run
// (the session id is unchanged after createProfile, so deps alone wouldn't).
let profileCheckVersion = 0;
const profileCheckSubscribers = new Set<() => void>();
function subscribeProfileCheck(cb: () => void): () => void {
  profileCheckSubscribers.add(cb);
  return () => profileCheckSubscribers.delete(cb);
}
function getProfileCheckVersion(): number {
  return profileCheckVersion;
}
/** Call after creating (or confirming) the profile row so standing re-evaluates. */
export function invalidateProfileCheck(): void {
  profileCheckVersion += 1;
  profileCheckSubscribers.forEach((cb) => cb());
}

export function useAuthStanding(): AuthStanding {
  const session = useSession();
  const checkVersion = useSyncExternalStore(subscribeProfileCheck, getProfileCheckVersion);
  // The check is stored WITH the token it was for; the loading state is DERIVED
  // (stored token !== current token) rather than set synchronously in the effect
  // — so a new user / a bumped version reads as 'unknown' without a cascading
  // setState.
  const [checked, setChecked] = useState<{ token: string; result: ProfileState }>({
    token: '',
    result: 'missing',
  });

  const token = session.status === 'signedIn' ? `${session.userId}:${checkVersion}` : '';

  useEffect(() => {
    if (session.status !== 'signedIn') return undefined;
    let cancelled = false;
    hasProfile(session.userId)
      .then((exists) => {
        if (!cancelled) setChecked({ token, result: exists ? 'present' : 'missing' });
      })
      // Fail-safe: read as 'incomplete', whose only consequence is the sheet
      // opening at the profile step — which handles an existing row gracefully
      // (idempotent create). Better than blocking a real action on a blip.
      .catch(() => {
        if (!cancelled) setChecked({ token, result: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, [session.status, session.userId, token]);

  if (session.status === 'loading') return 'loading';
  if (session.status === 'signedOut') return 'guest';
  if (checked.token !== token) {
    // Stale-while-revalidate for the SAME user: an invalidateProfileCheck()
    // re-check must not bounce standing through 'loading' — the AuthSheet
    // derives its profile step from 'incomplete', and a loading blip there
    // would visibly slide the sheet back to the OTP step mid-signup. A stale
    // read is corrected the moment the re-check lands.
    const checkedUserId = checked.token.split(':')[0];
    if (checked.token !== '' && checkedUserId === session.userId) {
      return checked.result === 'present' ? 'member' : 'incomplete';
    }
    return 'loading'; // first check for this user still in flight
  }
  return checked.result === 'present' ? 'member' : 'incomplete';
}
