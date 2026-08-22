/**
 * WHAT:  usePostDetail — loads one post's detail, re-fetching when the post id
 *        or the signed-in viewer changes, and exposing loading / ready / error
 *        plus the visible|hidden|notFound result and a retry — kept LIVE by a
 *        silent refetch on screen focus plus a 30s poll while visible (the
 *        sighting count in the stats row must move when a report lands,
 *        without the viewer leaving and re-entering) — plus a PULL that a
 *        person drives themselves.
 * WHY:   Owner-vs-spotter mode is computed server-side (is_owner) from the
 *        caller's JWT, so the fetch must wait until auth has RESOLVED — firing
 *        while the session is still loading would render an owner the spotter
 *        view for a frame. Keyed on the viewer id so sign-in/out re-resolves.
 *        Background refreshes never flip status (no skeleton flash) and only
 *        touch state when the payload actually changed — the same live
 *        pattern (and shared interval) as the sighting hooks. `refresh` is the
 *        pull and is the ONE refresh that shows a spinner and always lands on
 *        `ready` — the poll is silent precisely so it never blinks at someone
 *        mid-read, but that silence means a person watching a stale count has
 *        no way to ask; the pull is that way.
 * LINKS: src/features/vehicles/api/vehicleApi.ts;
 *        src/features/auth (useSession); src/features/vehicles/screens;
 *        src/shared/hooks/liveRefresh.ts (LIVE_REFRESH_MS).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth';
import { LIVE_REFRESH_MS } from '@/shared/hooks';

import { fetchPostDetail } from '../api/vehicleApi';
import type { PostDetailResult } from '../types';

export type PostDetailStatus = 'loading' | 'ready' | 'error';

export interface UsePostDetailResult {
  status: PostDetailStatus;
  result: PostDetailResult | null;
  retry: () => void;
  /** True only for a PULL. The focus poll stays silent by design. */
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function usePostDetail(postId: string): UsePostDetailResult {
  const session = useSession();
  // 'anon' vs the user id — a boolean-ish key so the effect re-runs on
  // sign-in/out (which flips is_owner) but not on unrelated session churn.
  const viewerKey = session.status === 'signedIn' ? session.userId : 'anon';

  const [status, setStatus] = useState<PostDetailStatus>('loading');
  const [result, setResult] = useState<PostDetailResult | null>(null);
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const lastJson = useRef<string | null>(null);

  useEffect(() => {
    if (session.status === 'loading') {
      return; // wait for auth to resolve so is_owner is correct on first paint
    }
    let cancelled = false;
    const request = fetchPostDetail(postId);
    // Deferred so the effect never sets state synchronously (cascading-render
    // guard) — mirrors useViewportPosts.
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setStatus('loading');
      }
    });
    request
      .then((fresh) => {
        if (!cancelled) {
          lastJson.current = JSON.stringify(fresh);
          setResult(fresh);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [postId, session.status, viewerKey, generation]);

  // LIVE: silent refetch on focus + a poll while focused, so server-moved
  // facts (the sighting count above all) correct themselves in place. A
  // failed background refresh keeps the good data on screen; unchanged
  // payloads never touch state.
  const silentRefresh = useCallback(async () => {
    try {
      const fresh = await fetchPostDetail(postId);
      const json = JSON.stringify(fresh);
      if (json === lastJson.current) return;
      lastJson.current = json;
      setResult(fresh);
      setStatus('ready');
    } catch {
      // background only — never disturb what's showing
    }
  }, [postId]);

  useFocusEffect(
    useCallback(() => {
      if (session.status === 'loading') return undefined;
      void silentRefresh();
      const timer = setInterval(() => {
        void silentRefresh();
      }, LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [session.status, silentRefresh]),
  );

  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  // The PULL. Same fetch as the background refresh, three differences: it
  // drives a visible spinner, it always lands on `ready` (so a pull is how you
  // recover from the error state without re-entering the screen), and it is the
  // only refresh a person asked for.
  //
  // ⚠️ A failed pull KEEPS whatever is on screen — someone in a car park with
  // one bar should not lose the listing they are reading because they tugged
  // it. `lastJson` is null only when nothing has ever loaded, which is the one
  // case where there is nothing to protect and the error is the truth.
  const refresh = useCallback(async () => {
    // ⚠️ The SAME wait the load effect makes, for the same reason: is_owner is
    // computed server-side from the caller’s JWT, so a fetch fired while the
    // session is still restoring comes back anonymous. The pull is reachable
    // during that window — the RefreshControl sits on the ScrollView that
    // renders the skeleton — so a cold-start deep link into a listing could be
    // tugged and hand the OWNER the spotter view. Worse, it would be written to
    // `lastJson`, so the silent refresh would see no change and leave it there.
    if (session.status === 'loading') {
      return;
    }
    setRefreshing(true);
    try {
      const fresh = await fetchPostDetail(postId);
      const json = JSON.stringify(fresh);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setResult(fresh);
      }
      setStatus('ready');
    } catch {
      if (lastJson.current === null) {
        setStatus('error');
      }
    } finally {
      setRefreshing(false);
    }
  }, [postId, session.status]);

  return { status, result, retry, refreshing, refresh };
}
