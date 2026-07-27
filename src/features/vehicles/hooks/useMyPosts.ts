/**
 * WHAT:  useMyPosts — loads the caller's own posts (list_my_posts, one round
 *        trip) for the My Listings screen. Standard status/refresh shape, keyed
 *        by user, revalidating silently on screen refocus.
 * WHY:   Mirrors useWatchlist/useMyProfile: guests are instantly ready+empty
 *        (the screen invites, never errors, signed out); a user switch never
 *        flashes the previous account's list; refocus revalidates silently so a
 *        car posted or edited elsewhere appears on the next visit without a
 *        manual pull (My Cars is a pushed page — returning to it refocuses).
 * LINKS: src/features/vehicles/api/myPostsApi.ts;
 *        src/features/vehicles/screens/MyCarsScreen.tsx (consumer);
 *        src/features/watchlist/hooks/useWatchlist.ts (the pattern).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth';
import type { PostSummary } from '@/shared/types';

import { listMyPosts } from '../api/myPostsApi';

export type MyPostsStatus = 'loading' | 'ready' | 'error';

export interface UseMyPostsResult {
  status: MyPostsStatus;
  posts: PostSummary[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  retry: () => void;
}

export function useMyPosts(): UseMyPostsResult {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;

  // Loaded data is keyed by user — another user's (or a stale) result never
  // renders. State writes happen after the await (no sync setState in effects).
  const [loaded, setLoaded] = useState<{ userId: string; posts: PostSummary[] } | null>(null);
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
          return listMyPosts();
        })
        .then((posts) => {
          setLoaded({ userId: uid, posts });
          setErrorFor(null);
        })
        .catch(() => {
          // listMyPosts already logged the failure.
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

  // Refetch on screen refocus so a car posted or edited elsewhere appears when
  // the owner returns to the list. Silent (stale-while-revalidate). First focus
  // is the mount fetch above — skip the duplicate.
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
  const current = userId && loaded?.userId === userId ? loaded.posts : null;
  const status: MyPostsStatus =
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
    posts: current ?? [],
    refreshing,
    refresh,
    retry,
  };
}
