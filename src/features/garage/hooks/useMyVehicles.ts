/**
 * WHAT:  useMyVehicles — loads the caller's saved cars (list_my_vehicles, one
 *        round trip) for the garage. Standard status/refresh shape, keyed by
 *        user, revalidating silently on screen refocus.
 * WHY:   Mirrors useMyPosts/useWatchlist exactly: guests are instantly
 *        ready+empty (the garage invites, never errors, signed out); a user
 *        switch never flashes the previous account's cars — which matters more
 *        here than elsewhere, since a saved car is a plate; and refocus
 *        revalidates silently so a car added, edited or reported stolen appears
 *        on return without a manual pull (/my-cars is a pushed page, so coming
 *        back from the add flow refocuses it).
 * LINKS: src/features/garage/api/garageApi.ts;
 *        src/features/garage/screens/MyCarsScreen.tsx (consumer);
 *        src/features/vehicles/hooks/useMyPosts.ts (the pattern).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth';

import { listMyVehicles } from '../api/garageApi';
import { publishSavedCarCount } from '../lib/savedCarSignal';
import type { SavedVehicle } from '../types';

export type MyVehiclesStatus = 'loading' | 'ready' | 'error';

export interface UseMyVehiclesResult {
  status: MyVehiclesStatus;
  vehicles: SavedVehicle[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  retry: () => void;
}

export function useMyVehicles(): UseMyVehiclesResult {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;

  // SAFETY: loaded data is keyed by user, so another user's (or a stale) garage
  // can never render. State writes happen after the await.
  const [loaded, setLoaded] = useState<{ userId: string; vehicles: SavedVehicle[] } | null>(null);
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
          return listMyVehicles();
        })
        .then((vehicles) => {
          setLoaded({ userId: uid, vehicles });
          setErrorFor(null);
          // Prime the shared nudge signal for free — this screen has just paid
          // for the answer, so the Profile row and the feed card never need to
          // fetch it themselves. publishSavedCarCount no-ops when unchanged, so
          // the refocus revalidation doesn't wake subscribers for nothing.
          publishSavedCarCount(uid, vehicles.length);
        })
        .catch(() => {
          // listMyVehicles already logged the failure.
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

  // Derived per-session view: guests are instantly ready and empty.
  const current = userId && loaded?.userId === userId ? loaded.vehicles : null;
  const status: MyVehiclesStatus =
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
    vehicles: current ?? [],
    refreshing,
    refresh,
    retry,
  };
}
