/**
 * WHAT:  useMyProfile — session-aware loader for my own profile row:
 *        'loading' → 'signedOut' | 'ready' (with profile) | 'error', plus
 *        refresh() for after edits. refresh()/invalidateMyProfile() bump a
 *        module-level version EVERY instance subscribes to, so a save in
 *        EditProfile updates the Profile screen AND the tab-bar avatar live.
 * WHY:   Real auth doesn't exist yet, so signedOut is a first-class state
 *        the Profile tab renders calmly (with a __DEV__ sample-data preview
 *        handled by the screen, not smuggled in here — this hook only ever
 *        reports the truth). The shared version is the house convention for
 *        cross-instance invalidation (useAuthStanding.invalidateProfileCheck).
 * LINKS: src/features/auth (useSession); src/features/profile/api/profileApi.ts;
 *        src/features/profile/hooks/useProfileTab.ts (tab-bar consumer).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { useSession } from '@/features/auth';

import { fetchMyProfile } from '../api/profileApi';
import type { MyProfile } from '../types';

export type MyProfileState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'error' }
  | { status: 'ready'; profile: MyProfile };

/** One fetch attempt's outcome, keyed so stale results never render. */
interface FetchResult {
  key: string;
  outcome: MyProfile | 'error';
}

// Module-level version shared by ALL instances: bumping it re-fetches every
// mounted useMyProfile (EditProfile save → Profile screen + tab-bar avatar).
let profileVersion = 0;
const versionSubscribers = new Set<() => void>();
function subscribeVersion(cb: () => void): () => void {
  versionSubscribers.add(cb);
  return () => versionSubscribers.delete(cb);
}
function getVersion(): number {
  return profileVersion;
}
/** Re-fetch my profile everywhere it is mounted (call after any profile write). */
export function invalidateMyProfile(): void {
  profileVersion += 1;
  versionSubscribers.forEach((cb) => cb());
}

export function useMyProfile(): MyProfileState & { refresh: () => void } {
  const session = useSession();
  const generation = useSyncExternalStore(subscribeVersion, getVersion);
  const [result, setResult] = useState<FetchResult | null>(null);

  // The state machine is DERIVED (below); the effect only records fetch
  // outcomes asynchronously — no synchronous setState cascades.
  const key = session.status === 'signedIn' ? `${session.userId}:${generation}` : null;

  useEffect(() => {
    if (!key || session.status !== 'signedIn') {
      return;
    }
    let cancelled = false;
    fetchMyProfile(session.userId)
      .then((profile) => {
        if (!cancelled) {
          setResult({ key, outcome: profile });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ key, outcome: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, session.status, session.userId]);

  // refresh keeps its old per-instance signature but now invalidates globally —
  // every caller wants "make what's on screen true", not "re-run my fetch".
  const refresh = invalidateMyProfile;

  if (session.status === 'loading') {
    return { status: 'loading', refresh };
  }
  if (session.status === 'signedOut') {
    return { status: 'signedOut', refresh };
  }
  // NOTE: result is deliberately not cleared on sign-out; a same-user
  // re-sign-in briefly shows the previous profile while refetching
  // (stale-while-revalidate). Keys make cross-user staleness impossible.
  if (!result || result.key !== key) {
    // Stale-while-revalidate across invalidation bumps for the SAME user: a
    // save or refocus must not bounce consumers through 'loading' — the
    // tab-bar avatar would visibly flicker to the person icon for a full
    // network roundtrip. The userId prefix keeps cross-user reuse impossible,
    // and a stale 'error' is never reused so a retry reads as loading.
    if (result && result.outcome !== 'error' && result.key.split(':')[0] === session.userId) {
      return { status: 'ready', profile: result.outcome, refresh };
    }
    return { status: 'loading', refresh }; // first fetch for this user in flight
  }
  if (result.outcome === 'error') {
    return { status: 'error', refresh };
  }
  return { status: 'ready', profile: result.outcome, refresh };
}
