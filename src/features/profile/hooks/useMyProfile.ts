/**
 * WHAT:  useMyProfile — session-aware loader for my own profile row:
 *        'loading' → 'signedOut' | 'ready' (with profile) | 'error', plus
 *        refresh() for after edits.
 * WHY:   Real auth doesn't exist yet, so signedOut is a first-class state
 *        the Profile tab renders calmly (with a __DEV__ sample-data preview
 *        handled by the screen, not smuggled in here — this hook only ever
 *        reports the truth).
 * LINKS: src/features/auth (useSession); src/features/profile/api/profileApi.ts.
 */

import { useCallback, useEffect, useState } from 'react';

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

export function useMyProfile(): MyProfileState & { refresh: () => void } {
  const session = useSession();
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<FetchResult | null>(null);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

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
    return { status: 'loading', refresh }; // fetch in flight for this key
  }
  if (result.outcome === 'error') {
    return { status: 'error', refresh };
  }
  return { status: 'ready', profile: result.outcome, refresh };
}
