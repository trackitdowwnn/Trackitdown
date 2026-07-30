/**
 * WHAT:  usePostSightings — loads the owner's sighting list for a post plus
 *        short-lived signed URLs for the private evidence photos, with
 *        loading/error/retry state — and keeps the list LIVE: a silent
 *        refetch on screen focus plus a 30s poll while the screen stays
 *        visible.
 * WHY:   Keeps PostSightingsScreen presentational; the two-step read (RPC →
 *        sign the returned paths) lives in one place so photo signing can
 *        never be forgotten by a future consumer. Polling, not Realtime, on
 *        purpose: the sightings table's RLS deliberately blocks the owner's
 *        direct reads (get_post_sightings is the only door), so a
 *        postgres_changes subscription would deliver nothing — and loosening
 *        RLS for realtime would breach the fence. Background refreshes never
 *        flip status (no skeleton flash) and only touch state when the
 *        payload actually changed — which also skips pointless URL
 *        re-signing.
 * LINKS: src/features/sightings/api/sightingApi.ts;
 *        src/features/sightings/screens/PostSightingsScreen.tsx;
 *        src/features/sightings/hooks/usePublicSightingEntries.ts (same
 *        live pattern + the shared poll interval).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LIVE_REFRESH_MS } from '@/shared/hooks';

import { fetchPostSightings, signSightingPhotoUrls } from '../api/sightingApi';
import type { OwnerSighting } from '../types';

type Status = 'loading' | 'ready' | 'error';

export function usePostSightings(postId: string, enabled = true) {
  const [status, setStatus] = useState<Status>('loading');
  const [sightings, setSightings] = useState<OwnerSighting[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const lastJson = useRef<string | null>(null);

  /** background=true refreshes silently: no status flip, no state churn (and
   *  no URL re-signing) unless the rows actually changed. */
  const load = useCallback(
    async (background: boolean) => {
      try {
        if (!background) setStatus('loading');
        const rows = await fetchPostSightings(postId);
        const json = JSON.stringify(rows);
        if (background && json === lastJson.current) return false;
        const urls = await signSightingPhotoUrls(
          rows.flatMap((row) => row.photos.map((photo) => photo.path)),
        );
        lastJson.current = json;
        setSightings(rows);
        setPhotoUrls(urls);
        setStatus('ready');
        return true;
      } catch {
        // A failed BACKGROUND refresh keeps the good data on screen.
        if (!background) setStatus('error');
        return false;
      }
    },
    [postId],
  );

  useEffect(() => {
    // `enabled` lets a shared caller (PostSightingsSection serves both faces,
    // hooks must be unconditional) skip the OWNER RPC entirely for non-owners
    // — the request would only bounce off the server gate, but not making it
    // is cheaper and quieter.
    if (!enabled) return;
    let cancelled = false;
    // All setState lives inside the async body so the effect never sets
    // state synchronously (react-compiler cascading-render rule).
    (async () => {
      if (!cancelled) await load(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt, load]);

  // LIVE: silent refetch whenever the screen regains focus + a poll while it
  // stays focused — a new sighting lands without leaving and re-entering.
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      void load(true);
      const timer = setInterval(() => {
        void load(true);
      }, LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [enabled, load]),
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, sightings, photoUrls, retry };
}
