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
 *        back from the add flow refocuses it). Seeds from the shared garage
 *        cache, so a screen mounted after the garage is known renders it on
 *        its first frame (the report flow's slide-up, 2026-10-07).
 * LINKS: src/features/garage/api/garageApi.ts;
 *        src/features/garage/screens/MyCarsScreen.tsx (consumer);
 *        src/features/vehicles/hooks/useMyPosts.ts (the pattern).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth';

import { listMyVehicles } from '../api/garageApi';
import { garageFor, isGarageFresh, publishGarage } from '../lib/savedCarSignal';
import type { SavedVehicle } from '../types';

/** A cached garage younger than this is trusted as-is on mount — the + button
 *  loaded it moments ago, so the report host doesn't fetch it again. */
const FRESH_ENOUGH_MS = 30_000;

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
  // Seeded from the shared garage cache, so a screen that mounts after the
  // garage is already known (the report host, during its slide-up) renders
  // its real content on the FIRST frame instead of a loading beat.
  const [loaded, setLoaded] = useState<{ userId: string; vehicles: SavedVehicle[] } | null>(
    () => {
      const cached = garageFor(userId);
      return cached ? { userId: cached.userId, vehicles: cached.vehicles } : null;
    },
  );
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
          // Prime the shared garage cache for free — this screen has just paid
          // for the answer, so the nudges and the report flow never need to
          // fetch it themselves. publishGarage no-ops when unchanged, so the
          // refocus revalidation doesn't wake subscribers for nothing.
          publishGarage(uid, vehicles);
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
    if (garageFor(userId)) {
      // Already showing the cached garage (see `current` below): never an
      // error screen over it. Revalidate quietly unless it was loaded moments
      // ago.
      if (!isGarageFresh(userId, FRESH_ENOUGH_MS)) {
        void load('silent');
      }
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
  // Falls back to the shared cache, so a mount after the garage is known — or
  // a user switch onto a known garage — renders it at once, with no loading
  // beat and no setState-in-effect to get there.
  const current =
    userId && loaded?.userId === userId ? loaded.vehicles : (garageFor(userId)?.vehicles ?? null);
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
