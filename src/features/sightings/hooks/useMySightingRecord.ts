/**
 * WHAT:  useMySightingRecord — loads the signed-in spotter's OWN sighting
 *        record (my_sighting_record, one round trip) for the My Reports screen.
 *        Standard status/refresh shape, keyed by user, revalidating silently on
 *        refocus.
 * WHY:   Mirrors useMyPosts/useWatchlist exactly, and for the same reasons:
 *        guests are instantly ready+empty (the screen invites, never errors,
 *        signed out); a user switch never flashes the previous account's
 *        reports; and refocus revalidates silently, which matters more here than
 *        anywhere else — the thing a spotter comes back to check is whether an
 *        owner has ruled since last time, and that changes while they are
 *        elsewhere in the app.
 *
 *        Keeping the fetch in a hook rather than the screen is not only house
 *        style: a screen-level `useEffect` that calls setState trips
 *        react-hooks/set-state-in-effect, and the fix is this shape — every
 *        write happens after an await.
 * LINKS: src/features/sightings/api/sightingApi.ts (fetchMySightingRecord);
 *        src/features/sightings/screens/MySightingsScreen.tsx (consumer);
 *        src/features/vehicles/hooks/useMyPosts.ts (the pattern).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth';

import { fetchMySightingRecord, type MySightingRecordEntry } from '../api/sightingApi';

export type MySightingRecordStatus = 'loading' | 'ready' | 'error';

export interface UseMySightingRecordResult {
  status: MySightingRecordStatus;
  entries: MySightingRecordEntry[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  retry: () => void;
}

export function useMySightingRecord(): UseMySightingRecordResult {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;

  // Keyed by user — another user's (or a stale) result never renders.
  const [loaded, setLoaded] = useState<{
    userId: string;
    entries: MySightingRecordEntry[];
  } | null>(null);
  const [errorFor, setErrorFor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    // initial: failure errors the screen. refresh: pull spinner, failure keeps
    // the list. silent: refocus revalidation, no spinner, failure keeps the list.
    (mode: 'initial' | 'refresh' | 'silent'): Promise<void> => {
      if (!userId) {
        return Promise.resolve();
      }
      const uid = userId;
      return Promise.resolve()
        .then(() => {
          if (mode === 'refresh') {
            setRefreshing(true);
          }
          return fetchMySightingRecord();
        })
        .then((entries) => {
          setLoaded({ userId: uid, entries });
          setErrorFor(null);
        })
        .catch(() => {
          // fetchMySightingRecord already logged the failure. A failed refresh
          // must never blank a list the spotter is already reading.
          if (mode === 'initial') {
            setErrorFor(uid);
          }
        })
        .finally(() => {
          setRefreshing(false);
        });
    },
    [userId],
  );

  useEffect(() => {
    if (session.status === 'loading' || !userId) {
      return;
    }
    void load('initial');
  }, [session.status, userId, load]);

  // Silent revalidation on refocus. The whole point of this screen is "what did
  // the owner decide", and that answer arrives while the spotter is somewhere
  // else — so coming back must show the new verdict without a manual pull.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void load('silent');
    }, [load]),
  );

  const refresh = useCallback(() => load('refresh'), [load]);
  const retry = useCallback(() => {
    setErrorFor(null);
    void load('initial');
  }, [load]);

  const current = userId && loaded?.userId === userId ? loaded.entries : null;
  const status: MySightingRecordStatus =
    session.status === 'loading'
      ? 'loading'
      : !userId
        ? 'ready'
        : errorFor === userId
          ? 'error'
          : current
            ? 'ready'
            : 'loading';

  return {
    status,
    entries: current ?? [],
    refreshing,
    refresh,
    retry,
  };
}
