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
 *        (the pattern); ../components/AlertNudgeSheet.tsx (a consumer).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// Direct module path, NOT the '@/features/auth' barrel — that barrel exports
// AuthGate, which reaches AsyncStorage, and this hook IS exported from the
// notifications barrel that chatApi/sightingApi import. See index.ts.
//
// ⚠️ THE ONE SANCTIONED EXCEPTION to ARCHITECTURE.md rule 1, and it is load-
// bearing rather than lazy. Routing this through the auth barrel was tried on
// 2026-09-03 when the rule was first enforced: six suites died on
// "[@RNC/AsyncStorage]: NativeModule: AsyncStorage is null", because the barrel
// pulls AuthGate and this hook rides the notifications barrel into chatApi and
// sightingApi. The disable is narrow — one line, one symbol — and the reason is
// the paragraph above it.
// eslint-disable-next-line no-restricted-imports -- see above: the auth barrel drags AsyncStorage into two plain api modules
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

export function useMyAlerts(): MyAlertsState & {
  /** Global invalidation — every mounted instance refetches. The retry button. */
  refresh: () => void;
  /** The PULL. Local, and a failure keeps the list. */
  pull: () => Promise<void>;
  refreshing: boolean;
} {
  const session = useSession();
  const generation = useSyncExternalStore(subscribeVersion, getVersion);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  // ⚠️ THE PULL DOES NOT GO THROUGH invalidateMyAlerts, and that is the point.
  //
  // Invalidation drives the shared effect below, whose failure path records
  // `outcome: 'error'` — which the state machine turns into a full-page
  // ErrorState. Routed that way, one failed tug on a train would replace every
  // alert someone had with an error page. A pull is a request for NEWER facts,
  // never a reason to throw away the ones already on screen.
  //
  // It also keeps the spinner honest: `refreshing` is now true only for a
  // refetch a person asked for. Derived from the key comparison it also fired
  // when they flipped an alert switch or deleted one, both of which invalidate,
  // so the list animated a pull nobody pulled.
  const pull = useCallback(async () => {
    if (!key) return;
    setRefreshing(true);
    try {
      setResult({ key, outcome: await fetchMyAlerts() });
    } catch {
      // Keep what is on screen. The list is still true, just not newer.
    } finally {
      setRefreshing(false);
    }
  }, [key]);

  const idle = { refresh, pull, refreshing: false };

  if (session.status === 'loading') return { status: 'loading', ...idle };
  if (session.status === 'signedOut') return { status: 'signedOut', ...idle };

  if (!result || result.key !== key) {
    // Stale-while-revalidate across invalidation bumps for the SAME user, so
    // saving doesn't bounce the list through a spinner. The userId prefix
    // makes cross-user reuse impossible; a stale error is never reused.
    if (result && result.outcome !== 'error' && result.key.split(':')[0] === session.userId) {
      return { status: 'ready', alerts: result.outcome, refresh, pull, refreshing };
    }
    return { status: 'loading', ...idle };
  }
  if (result.outcome === 'error') return { status: 'error', ...idle };
  return { status: 'ready', alerts: result.outcome, refresh, pull, refreshing };
}
