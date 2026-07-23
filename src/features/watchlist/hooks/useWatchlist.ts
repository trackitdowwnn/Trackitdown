/**
 * WHAT:  useWatchlist — loads the caller's watchlist (RPC, one round trip)
 *        and splits it for the screen: active watches first, resolved ones
 *        (recovered cards + tombstones, still inside their 30-day window)
 *        under "No longer active". Standard status/refresh shape.
 * WHY:   The 30-day retention and tombstone rules are SERVER-side (the RPC)
 *        — this hook only groups. Loaded data is keyed by USER so a user
 *        switch never flashes the previous account's entries, and guests
 *        get an instant empty result (the screen invites, never errors,
 *        signed out). Also hydrates the shared watched-ids store, so the
 *        toggles work even when no card was mounted before this screen.
 * LINKS: src/features/watchlist/api/watchlistApi.ts;
 *        src/features/watchlist/lib/watchedStore.ts;
 *        src/features/watchlist/screens/WatchlistScreen.tsx.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth';

import { fetchWatchedPostIds, fetchWatchlist } from '../api/watchlistApi';
import { ensureWatchedHydrated } from '../lib/watchedStore';
import type { WatchlistEntry } from '../types';

export type WatchlistStatus = 'loading' | 'ready' | 'error';

export interface UseWatchlistResult {
  status: WatchlistStatus;
  /** Watches on still-active posts, newest watch first. */
  active: WatchlistEntry[];
  /** Resolved within their 30-day window — the "No longer active" section. */
  resolved: WatchlistEntry[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  retry: () => void;
}

function isResolved(entry: WatchlistEntry): boolean {
  return entry.kind === 'tombstone' || entry.post.status !== 'active';
}

export function useWatchlist(): UseWatchlistResult {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;

  // Loaded data is keyed by user — another user's (or a stale) result never
  // renders. All state writes happen after an await (lint: no sync setState
  // inside effects).
  const [loaded, setLoaded] = useState<{ userId: string; entries: WatchlistEntry[] } | null>(null);
  const [errorFor, setErrorFor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Promise chains, not async/await: load is invoked synchronously from an
  // effect and every setState must live in a .then callback (the same idiom
  // useHomeFeed uses to satisfy the set-state-in-effect rule).
  const load = useCallback(
    // initial: failure errors the screen. refresh: pull-to-refresh spinner,
    // failure keeps the entries. silent: refocus revalidation — no spinner,
    // failure keeps the entries (stale beats an error flash mid-session).
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
          return fetchWatchlist();
        })
        .then((entries) => {
          setLoaded({ userId: uid, entries });
          setErrorFor(null);
        })
        .catch(() => {
          // fetchWatchlist already logged the failure.
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
    // Landing on the watchlist also hydrates the shared toggle store — the
    // toggles must know membership even if no card mounted before this.
    void ensureWatchedHydrated(userId, fetchWatchedPostIds);
  }, [session.status, userId, load]);

  // Refetch on tab refocus: a watch added from the feed/map/detail while
  // this tab stayed mounted must appear without pull-to-refresh (removals
  // are already live via the shared store; ADDS need the full payload).
  // Silent (not asRefresh: no spinner) — stale entries stay on screen until
  // the fresh list lands, same stale-while-revalidate feel as useMyProfile.
  // First focus is the mount fetch above; skip the duplicate.
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
  const current = userId && loaded?.userId === userId ? loaded.entries : null;
  const status: WatchlistStatus =
    session.status === 'loading'
      ? 'loading'
      : !userId
        ? 'ready'
        : errorFor === userId
          ? 'error'
          : current
            ? 'ready'
            : 'loading';
  const entries = current ?? [];

  return {
    status,
    active: entries.filter((entry) => !isResolved(entry)),
    resolved: entries.filter(isResolved),
    refreshing,
    refresh,
    retry,
  };
}
