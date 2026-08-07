/**
 * WHAT:  useSortAnchor — the region the map's "nearest first" ordering is
 *        measured from. Follows the latest searched region, EXCEPT while
 *        frozen, when it holds the last value it saw.
 * WHY:   The map orders one list by distance and hands it to three consumers
 *        at once: the card pager, the sheet list, and the selection model's
 *        index derivation. Auto-search moves the searched region on every
 *        settled pan, so without this the order changes underneath a user who
 *        is reading a card — and because selection is derived from the INDEX,
 *        a reorder silently changes which car the pager is pointing at. Swipe
 *        left and you land on a different car than the one beside you.
 *
 *        Freezing while a card is up is the whole fix. It is not the same as
 *        anchoring forever to the first search: pan from St Albans to Watford
 *        and every result is a Watford car, so ordering them by distance from
 *        St Albans degenerates into "sorted by direction back home". The
 *        anchor must follow the user — it must just never move mid-read.
 *
 *        Adjust-state-during-render, not an effect: an effect would render the
 *        stale order once and correct it on the next frame, which is the
 *        visible flicker this exists to prevent.
 * LINKS: src/features/search-map/screens/MapSearchScreen.tsx (sortedPosts);
 *        src/features/search-map/hooks/useViewportPosts.ts (searchedRegion).
 */

import { useState } from 'react';

import type { GeoRegion } from '@/shared/types';

/**
 * `next` is compared by IDENTITY, which is safe and cheap here because
 * useViewportPosts only ever hands over a new region object when a search
 * actually lands — never once per render.
 */
export function useSortAnchor(next: GeoRegion, frozen: boolean): GeoRegion {
  const [anchor, setAnchor] = useState(next);
  const [seen, setSeen] = useState(next);

  if (next !== seen) {
    setSeen(next);
    // Skipped values are deliberately dropped rather than queued: on unfreeze
    // the user should get the CURRENT area, not a replay of everywhere the map
    // passed over while they were reading.
    if (!frozen) {
      setAnchor(next);
    }
  }

  return anchor;
}
