/**
 * WHAT:  useSearchCount — the live "Show N cars" count for the search surface:
 *        a debounced, race-guarded count of the posts the current criteria
 *        would match in the framed area, announced to screen readers as it
 *        settles.
 * WHY:   Airbnb's pattern — show the result count on the apply button so the
 *        user knows before committing. The count fires on every criteria change,
 *        so it debounces (~200ms) and uses the request-token guard from
 *        useViewportPosts so a slow early count can't overwrite a newer one. It
 *        keys off SERIALISED criteria + bbox (objects change identity each
 *        render) so it re-counts on real changes only.
 * LINKS: src/features/search-map/api/mapApi.ts (fetchSearchCount);
 *        src/features/search-map/lib/searchCriteria.ts (toRpcCriteria);
 *        src/features/search-map/lib/regionMath.ts (regionToBbox).
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { GeoRegion } from '@/shared/types';

import { fetchSearchCount } from '../api/mapApi';
import { regionToBbox } from '../lib/regionMath';
import { type SearchCriteria, toRpcCriteria } from '../lib/searchCriteria';

/** Debounce so the count doesn't fire on every keystroke. */
const COUNT_DEBOUNCE_MS = 200;

export interface UseSearchCountResult {
  /** The settled count, or null before the first result / after an error. */
  count: number | null;
  /** A count is in flight (debounce elapsed, request not yet back). */
  counting: boolean;
}

/**
 * Count the posts matching `criteria` within `region`'s bbox, debounced and
 * race-guarded. `region` is the distance-chip-framed area (the same bbox the
 * apply will search), so the count matches what the user will see.
 */
export function useSearchCount(region: GeoRegion, criteria: SearchCriteria): UseSearchCountResult {
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const tokenRef = useRef(0);

  // Latest inputs live in refs so the count effect can read them while
  // depending only on the SERIALISED keys (the objects change identity every
  // render). Refs are written in an effect, never during render.
  const regionRef = useRef(region);
  const criteriaRef = useRef(criteria);
  useEffect(() => {
    regionRef.current = region;
    criteriaRef.current = criteria;
  });

  const bbox = regionToBbox(region);
  const bboxKey = `${bbox.minLat.toFixed(4)},${bbox.minLng.toFixed(4)},${bbox.maxLat.toFixed(4)},${bbox.maxLng.toFixed(4)}`;
  const criteriaKey = JSON.stringify(toRpcCriteria(criteria));

  useEffect(() => {
    const token = ++tokenRef.current;
    // setState lives inside the debounce callback (never synchronously in the
    // effect body) so it doesn't cascade renders — matching useViewportPosts.
    const handle = setTimeout(() => {
      setCounting(true);
      fetchSearchCount(regionToBbox(regionRef.current), criteriaRef.current)
        .then((next) => {
          if (token !== tokenRef.current) {
            return; // superseded
          }
          setCount(next);
          AccessibilityInfo.announceForAccessibility(
            `${next} ${next === 1 ? 'car' : 'cars'} match`,
          );
        })
        .catch(() => {
          if (token === tokenRef.current) {
            setCount(null);
          }
        })
        .finally(() => {
          if (token === tokenRef.current) {
            setCounting(false);
          }
        });
    }, COUNT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // Keys, not the objects: re-count only on a real change.
  }, [bboxKey, criteriaKey]);

  return { count, counting };
}
