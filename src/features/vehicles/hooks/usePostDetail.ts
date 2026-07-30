/**
 * WHAT:  usePostDetail — loads one post's detail, re-fetching when the post id
 *        or the signed-in viewer changes, and exposing loading / ready / error
 *        plus the visible|hidden|notFound result and a retry — kept LIVE by a
 *        silent refetch on screen focus plus a 30s poll while visible (the
 *        sighting count in the stats row must move when a report lands,
 *        without the viewer leaving and re-entering).
 * WHY:   Owner-vs-spotter mode is computed server-side (is_owner) from the
 *        caller's JWT, so the fetch must wait until auth has RESOLVED — firing
 *        while the session is still loading would render an owner the spotter
 *        view for a frame. Keyed on the viewer id so sign-in/out re-resolves.
 *        Background refreshes never flip status (no skeleton flash) and only
 *        touch state when the payload actually changed — the same live
 *        pattern (and shared interval) as the sighting hooks.
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
}

export function usePostDetail(postId: string): UsePostDetailResult {
  const session = useSession();
  // 'anon' vs the user id — a boolean-ish key so the effect re-runs on
  // sign-in/out (which flips is_owner) but not on unrelated session churn.
  const viewerKey = session.status === 'signedIn' ? session.userId : 'anon';

  const [status, setStatus] = useState<PostDetailStatus>('loading');
  const [result, setResult] = useState<PostDetailResult | null>(null);
  const [generation, setGeneration] = useState(0);
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
  const refresh = useCallback(async () => {
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
      void refresh();
      const timer = setInterval(() => {
        void refresh();
      }, LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [session.status, refresh]),
  );

  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  return { status, result, retry };
}
