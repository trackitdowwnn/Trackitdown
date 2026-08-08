/**
 * WHAT:  usePostStats — loads one listing's stats with loading/error/retry,
 *        and refreshes silently whenever the screen regains focus.
 * WHY:   Mirrors usePostSightings deliberately: same status union, same retry
 *        counter, same focus refresh, same rule that every setState lives
 *        inside the async body (the repo's cascading-render lint). Two screens
 *        that load one owner-face RPC should not have two shapes.
 *
 *        `notFound` is its OWN state, not an error. The RPC returns null for a
 *        post the caller does not own AND for one that does not exist — on
 *        purpose, so neither can be probed — and an owner who has just deleted
 *        a listing should see "not found", not "something went wrong".
 *
 *        No poll. Sightings poll because a report can land while the owner
 *        watches; these are counts on a secondary screen, and refetching on
 *        focus is enough without a timer running behind a page nobody is
 *        reading.
 * LINKS: src/features/vehicles/api/postStatsApi.ts;
 *        src/features/sightings/hooks/usePostSightings.ts (the pattern);
 *        src/features/vehicles/screens/PostStatsScreen.tsx.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { fetchPostStats, type PostStats } from '../api/postStatsApi';

type Status = 'loading' | 'ready' | 'notFound' | 'error';

export function usePostStats(postId: string) {
  const [status, setStatus] = useState<Status>('loading');
  const [stats, setStats] = useState<PostStats | null>(null);
  const [attempt, setAttempt] = useState(0);

  /** background=true refreshes without flipping to the skeleton, so a focus
   *  refresh never blanks numbers the owner is already reading. */
  const load = useCallback(
    async (background: boolean) => {
      try {
        if (!background) {
          setStatus('loading');
        }
        const result = await fetchPostStats(postId);
        setStats(result);
        setStatus(result === null ? 'notFound' : 'ready');
      } catch {
        // A failed BACKGROUND refresh keeps the good numbers on screen.
        if (!background) {
          setStatus('error');
        }
      }
    },
    [postId],
  );

  useEffect(() => {
    let cancelled = false;
    // All setState inside the async body — never synchronously in the effect.
    (async () => {
      if (!cancelled) {
        await load(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, load]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, stats, retry };
}
