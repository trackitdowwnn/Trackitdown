/**
 * WHAT:  useMyAlerts — session-aware loader for the caller's alerts:
 *        'loading' → 'signedOut' | 'ready' (a list) | 'error', plus a
 *        module-level invalidation every mounted instance subscribes to.
 * WHY:   Three surfaces must agree the instant an alert is saved or deleted:
 *        the list screen, the Profile summary row, and the Explore nudge card
 *        — which exists precisely BECAUSE the list is empty. Without shared
 *        invalidation, creating your first alert would leave the feed still
 *        inviting you to do what you just did.
 *        Shape copied from useMyProfile deliberately (keyed FetchResult +
 *        useSyncExternalStore version counter) — that is this codebase's
 *        answer to cache invalidation; there is no TanStack Query here.
 * LINKS: ../api/alertsApi.ts; src/features/profile/hooks/useMyProfile.ts
 *        (the pattern); ../components/AlertNudgeCard.tsx (a consumer).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

// Direct module path, NOT the '@/features/auth' barrel — that barrel exports
// AuthGate, which reaches AsyncStorage, and this hook IS exported from the
// notifications barrel that chatApi/sightingApi import. See index.ts.
import { useSession } from '@/features/auth/hooks/useSession';

import { fetchMyAlerts } from '../api/alertsApi';
import type { Alert } from '../types';

export type MyAlertsState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'error' }
  /** `alerts` is empty when the user simply hasn't made one — a normal state,
   *  not an error, and the one the nudge card exists for. */
  | { status: 'ready'; alerts: Alert[] };

interface FetchResult {
  key: string;
  outcome: Alert[] | 'error';
}

let alertsVersion = 0;
const versionSubscribers = new Set<() => void>();
function subscribeVersion(cb: () => void): () => void {
  versionSubscribers.add(cb);
  return () => versionSubscribers.delete(cb);
}
function getVersion(): number {
  return alertsVersion;
}

/** Re-fetch alerts everywhere they are mounted. Call after any alert write. */
export function invalidateMyAlerts(): void {
  alertsVersion += 1;
  versionSubscribers.forEach((cb) => cb());
}

export function useMyAlerts(): MyAlertsState & { refresh: () => void } {
  const session = useSession();
  const generation = useSyncExternalStore(subscribeVersion, getVersion);
  const [result, setResult] = useState<FetchResult | null>(null);

  // The state machine is DERIVED below; the effect only records outcomes.
  const key = session.status === 'signedIn' ? `${session.userId}:${generation}` : null;

  useEffect(() => {
    if (!key || session.status !== 'signedIn') return;
    let cancelled = false;
    fetchMyAlerts()
      .then((alerts) => {
        if (!cancelled) setResult({ key, outcome: alerts });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, outcome: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [key, session.status]);

  const refresh = invalidateMyAlerts;

  if (session.status === 'loading') return { status: 'loading', refresh };
  if (session.status === 'signedOut') return { status: 'signedOut', refresh };

  if (!result || result.key !== key) {
    // Stale-while-revalidate across invalidation bumps for the SAME user, so
    // saving doesn't bounce the list through a spinner. The userId prefix
    // makes cross-user reuse impossible; a stale error is never reused.
    if (result && result.outcome !== 'error' && result.key.split(':')[0] === session.userId) {
      return { status: 'ready', alerts: result.outcome, refresh };
    }
    return { status: 'loading', refresh };
  }
  if (result.outcome === 'error') return { status: 'error', refresh };
  return { status: 'ready', alerts: result.outcome, refresh };
}
