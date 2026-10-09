/**
 * WHAT:  useMyReportPhotos — the photo each of the spotter's own reports
 *        leads with on "My sightings": sighting id → a signed URL, and which
 *        reports have been looked up.
 * WHY:   Redesigned 2026-10-09: the spotter's own photo now leads each card
 *        (the colour tile was the only picture). Loaded beside the record,
 *        never in front of it: the list renders at once — each card with an
 *        empty frame until ITS report has been looked up, then its photo or
 *        its tile. Per report, so a new report arriving doesn't flip every
 *        other card back to an empty frame. A failure costs the photos, never
 *        the page: it is logged and the cards keep their tiles. A request
 *        that stalls (no network) leaves the frames empty until it settles —
 *        the record itself is unaffected.
 *
 *        Keyed by the SET of ids, so a refocus revalidation that returns the
 *        same reports re-signs nothing; only a new report changes the set (a
 *        withdrawn one stays in the list, under "Taken back"). Earlier URLs
 *        are kept meanwhile — by sighting id, so a stale entry is simply
 *        never looked up. A link that has lapsed (an hour) fails to load, and
 *        the card falls back to its tile (ReportCard).
 * LINKS: src/features/sightings/api/sightingApi.ts (fetchMyReportPhotos —
 *          the RLS that makes this the spotter's own rows only;
 *          signSightingPhotoUrls);
 *        src/features/sightings/components/ReportCard.tsx (the frame/tile);
 *        src/features/sightings/screens/MySightingsScreen.tsx (consumer).
 */

import { useEffect, useMemo, useState } from 'react';

import { createLogger } from '@/shared/lib/logger';

import { fetchMyReportPhotos, signSightingPhotoUrls } from '../api/sightingApi';

const log = createLogger('sightings');

export interface MyReportPhotos {
  /** Sighting id → signed URL of its lead photo. */
  urls: Record<string, string>;
  /** Sighting id → true once that report has been looked up (or failed). */
  lookedUp: Record<string, true>;
}

/** The spotter's own lead photos for these reports — see the header. */
export function useMyReportPhotos(sightingIds: string[]): MyReportPhotos {
  const key = [...sightingIds].sort().join(',');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [lookedUp, setLookedUp] = useState<Record<string, true>>({});

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const ids = key.split(',');
    void (async () => {
      try {
        const paths = await fetchMyReportPhotos(ids);
        // Gone (or the set changed) — don't sign links nobody will show.
        if (cancelled) return;
        const signed = await signSightingPhotoUrls(Object.values(paths));
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const [id, path] of Object.entries(paths)) {
          if (signed[path]) next[id] = signed[path];
        }
        // Nothing new → the same object, so the list doesn't re-render.
        if (Object.keys(next).length > 0) setUrls((previous) => ({ ...previous, ...next }));
      } catch {
        // The cards keep their tiles; nothing about the photos is logged.
        if (!cancelled) log.warn('my_report_photos_failed');
      } finally {
        if (!cancelled) {
          setLookedUp((previous) => {
            const merged: Record<string, true> = { ...previous };
            for (const id of ids) merged[id] = true;
            return merged;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  // One object per change, not per render — the list's renderRow depends on it.
  return useMemo(() => ({ urls, lookedUp }), [urls, lookedUp]);
}
