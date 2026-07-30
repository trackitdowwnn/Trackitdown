/**
 * WHAT:  usePublicSightingEntries — loads the restrained public timeline
 *        entries ({time, locality, snapped point} only, capped + "N earlier")
 *        for a post, and keeps them LIVE: a silent refetch on screen focus
 *        plus a 30s poll while the screen stays visible.
 * WHY:   The PUBLIC face's only data source (ADR-0008/0009). Polling, not
 *        Realtime, on purpose: the sightings table's RLS deliberately blocks
 *        every direct read (the RPC is the only door), so a postgres_changes
 *        subscription would deliver nothing — and loosening RLS for realtime
 *        would breach the fence. The api function is fail-soft (errors → the
 *        empty shape), so this hook has no error state, and background
 *        refreshes only touch state when the payload actually changed (a new
 *        sighting then animates into the timeline via its layout transition).
 *        // SAFETY: nothing here may ever be widened to carry ids, raw
 *        coordinates, photos, or spotter fields; PublicSightingEntries'
 *        strict schema is the fence.
 * LINKS: src/features/sightings/api/sightingApi.ts (fetchPublicSightingEntries);
 *        src/features/sightings/components/PostSightingsSection.tsx;
 *        src/features/sightings/hooks/usePostSightings.ts (same live pattern).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LIVE_REFRESH_MS } from '@/shared/hooks';

import { fetchPublicSightingEntries } from '../api/sightingApi';
import type { PublicSightingEntries } from '../types';

export function usePublicSightingEntries(postId: string, enabled = true) {
  // null = not yet landed; the section renders nothing meanwhile (the public
  // face has no skeleton — absence is its loading state AND its empty state).
  const [data, setData] = useState<PublicSightingEntries | null>(null);
  const lastJson = useRef<string | null>(null);

  const load = useCallback(async () => {
    const entries = await fetchPublicSightingEntries(postId);
    const json = JSON.stringify(entries);
    if (json === lastJson.current) return; // unchanged — no re-render
    lastJson.current = json;
    setData(entries);
  }, [postId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  // LIVE: silent refetch whenever the screen regains focus (back-navigation,
  // app foreground) + a poll while it stays focused — the owner shouldn't
  // have to leave and re-enter to see a new sighting land.
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      void load();
      const timer = setInterval(() => {
        void load();
      }, LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [enabled, load]),
  );

  return data;
}
