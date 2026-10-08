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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useSession } from '@/features/auth';

import { loadGarage } from '../lib/loadGarage';
import { getSavedCarSnapshot, isGarageFresh, subscribeToSavedCarSignal } from '../lib/savedCarSignal';
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

  // ⚠️ THE SHARED GARAGE CACHE IS THE SOURCE OF TRUTH (2026-10-07), read
  // through the snapshot the store hands back — never by re-reading the
  // module in render, which the React Compiler would memoise (review of #141).
  // So a screen mounted after the garage is known renders it on its FIRST
  // frame, and every surface updates together when it changes.
  //
  // SAFETY: the snapshot is used only when it belongs to THIS user, so
  // another user's (or a signed-out user's) garage can never render.
  const snapshot = useSyncExternalStore(subscribeToSavedCarSignal, getSavedCarSnapshot);
  const cached = userId !== null && snapshot?.userId === userId ? snapshot : null;

  const [errorFor, setErrorFor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    // initial: failure errors the screen. refresh: pull spinner, failure keeps
    // the list. silent: refocus revalidation, no spinner, failure keeps the list.
    //
    // Through loadGarage, not listMyVehicles directly: one fetch shared with
    // the + button and the nudges, and never published for a user who signed
    // out while it was in flight (the cache holds plates).
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
          return loadGarage(uid);
        })
        .then((ok) => {
          if (ok) {
            setErrorFor(null);
          } else if (mode === 'initial') {
            // listMyVehicles already logged the failure.
            setErrorFor(uid);
          }
        })
        .finally(() => {
          setRefreshing(false);
        });
    },
    [userId],
  );

  const hasCached = cached !== null;
  useEffect(() => {
    if (session.status === 'loading' || !userId) {
      return;
    }
    if (hasCached) {
      // Already showing the cached garage: never an error screen over it.
      // Revalidate quietly unless it was loaded moments ago.
      if (!isGarageFresh(userId, FRESH_ENOUGH_MS)) {
        void load('silent');
      }
      return;
    }
    // No cached garage — first load, or the cache was just cleared after a
    // garage write (add / edit / delete), in which case this refetches.
    void load('initial');
  }, [session.status, userId, load, hasCached]);

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
  const current = cached?.vehicles ?? null;
  const status: MyVehiclesStatus =
    session.status === 'loading'
      ? 'loading'
      : !userId
        ? 'ready'
        : current
          ? 'ready'
          : errorFor === userId
            ? 'error'
            : 'loading';

  return {
    status,
    vehicles: current ?? [],
    refreshing,
    refresh,
    retry,
  };
}
