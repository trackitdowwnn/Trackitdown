/**
 * WHAT:  usePostDetail — loads one post's detail, re-fetching when the post id
 *        or the signed-in viewer changes, and exposing loading / ready / error
 *        plus the visible|hidden|notFound result and a retry.
 * WHY:   Owner-vs-spotter mode is computed server-side (is_owner) from the
 *        caller's JWT, so the fetch must wait until auth has RESOLVED — firing
 *        while the session is still loading would render an owner the spotter
 *        view for a frame. Keyed on the viewer id so sign-in/out re-resolves.
 * LINKS: src/features/vehicles/api/vehicleApi.ts;
 *        src/features/auth (useSession); src/features/vehicles/screens.
 */

import { useCallback, useEffect, useState } from 'react';

import { useSession } from '@/features/auth';

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

  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  return { status, result, retry };
}
