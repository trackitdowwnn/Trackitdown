/**
 * WHAT:  useMyReportPhotos — the photo each of the spotter's own reports
 *        leads with on "My sightings": sighting id → a signed URL.
 * WHY:   Redesigned 2026-10-09: the spotter's own photo now leads each card
 *        (the colour tile was the only picture). Loaded beside the record,
 *        never in front of it: the list renders at once with tiles, and the
 *        photos fill in. A failure costs the photos, never the page — it is
 *        logged and the cards keep their tiles.
 *
 *        Keyed by the SET of ids, so a refocus revalidation that returns the
 *        same reports doesn't re-sign anything, and a withdrawal or a new
 *        report does. Earlier URLs are kept meanwhile: they are by sighting
 *        id, so a stale entry is simply never looked up. Signed URLs last an
 *        hour; the image cache holds what was shown beyond that.
 * LINKS: src/features/sightings/api/sightingApi.ts (fetchMyReportPhotos —
 *          the RLS that makes this the spotter's own rows only;
 *          signSightingPhotoUrls);
 *        src/features/sightings/screens/MySightingsScreen.tsx (consumer).
 */

import { useEffect, useState } from 'react';

import { createLogger } from '@/shared/lib/logger';

import { fetchMyReportPhotos, signSightingPhotoUrls } from '../api/sightingApi';

const log = createLogger('sightings');

export function useMyReportPhotos(sightingIds: string[]): Record<string, string> {
  const key = [...sightingIds].sort().join(',');
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void (async () => {
      try {
        const paths = await fetchMyReportPhotos(key.split(','));
        const signed = await signSightingPhotoUrls(Object.values(paths));
        const next: Record<string, string> = {};
        for (const [id, path] of Object.entries(paths)) {
          if (signed[path]) next[id] = signed[path];
        }
        if (!cancelled) setUrls((previous) => ({ ...previous, ...next }));
      } catch {
        // The cards keep their tiles; nothing about the photos is logged.
        log.warn('my_report_photos_failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return urls;
}
