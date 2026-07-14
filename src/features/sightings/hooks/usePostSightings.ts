/**
 * WHAT:  usePostSightings — loads the owner's sighting list for a post plus
 *        short-lived signed URLs for the private evidence photos, with
 *        loading/error/retry state.
 * WHY:   Keeps PostSightingsScreen presentational; the two-step read (RPC →
 *        sign the returned paths) lives in one place so photo signing can
 *        never be forgotten by a future consumer.
 * LINKS: src/features/sightings/api/sightingApi.ts;
 *        src/features/sightings/screens/PostSightingsScreen.tsx.
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchPostSightings, signSightingPhotoUrls } from '../api/sightingApi';
import type { OwnerSighting } from '../types';

type Status = 'loading' | 'ready' | 'error';

export function usePostSightings(postId: string) {
  const [status, setStatus] = useState<Status>('loading');
  const [sightings, setSightings] = useState<OwnerSighting[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // All setState lives inside the async body so the effect never sets
    // state synchronously (react-compiler cascading-render rule).
    (async () => {
      try {
        setStatus('loading');
        const rows = await fetchPostSightings(postId);
        const urls = await signSightingPhotoUrls(
          rows.flatMap((row) => row.photos.map((photo) => photo.path)),
        );
        if (cancelled) return;
        setSightings(rows);
        setPhotoUrls(urls);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, sightings, photoUrls, retry };
}
