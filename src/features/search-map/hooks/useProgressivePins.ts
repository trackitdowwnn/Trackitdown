/**
 * WHAT:  useProgressivePins — mounts the map's markers in batches over a few
 *        frames instead of all in one commit, growing a budget of DEMOTED pins
 *        until every post in view is drawn.
 * WHY:   Clustering used to bound the marker population; it was removed
 *        2026-08-06 on the owner's call, so a dense area now mounts up to
 *        VIEWPORT_POST_LIMIT (100) custom markers at once — and each one holds
 *        tracksViewChanges open for 500ms while it rasterises. One commit of a
 *        hundred of those is the precise Android jank MapPins' header exists to
 *        prevent. Staggering the mount staggers the tracking windows with it.
 *
 *        The budget RESETS only when the POPULATION turns over — the entry load,
 *        an applied search, an explicit retry. NOT on a pan, and NOT on the
 *        auto re-search that follows one: both return largely the same posts,
 *        whose markers are already mounted (the React key is the post id), so
 *        resetting there would unmount markers the user is looking at and fade
 *        them back in, re-arming 500ms of tracking on each. That costs more
 *        than not batching at all. Hence `populationId`, not `searchId` —
 *        searchId bumps on EVERY landed search, including every pan's.
 * LINKS: src/features/search-map/lib/mapPins.ts (revealPins — the pure slice);
 *        src/features/search-map/components/MapPins.tsx (tracksViewChanges).
 */

import { useEffect, useMemo, useState } from 'react';

import { revealPins } from '../lib/mapPins';
import type { MapPinItem } from '../types';

/** Demoted pins drawn in the first commit — enough to read as a populated map
 *  immediately, few enough to paint in one frame. */
const FIRST_BATCH = 20;
/** Added per tick thereafter: 100 markers arrive in ~4 steps. */
const BATCH = 20;
/** Roughly two frames at 60Hz — long enough to yield to the paint, short
 *  enough that the fill-in is over before a settling map is touched again. */
const BATCH_INTERVAL_MS = 32;

/**
 * The subset of `pins` to draw right now, growing to all of them over a few
 * ticks.
 *
 * @param pins           every marker for the current view (culled + ranked)
 * @param resetKey       bump to restart the reveal — pass `populationId`, NOT
 *                       `searchId` (which bumps on every pan's re-search) and
 *                       NOT the pins array, whose identity changes per settle
 * @param selectedPostId never withheld, whatever its emphasis — the card must
 *                       never describe a car with no marker under it
 */
export function useProgressivePins(
  pins: MapPinItem[],
  resetKey: number,
  selectedPostId: string | null = null,
): MapPinItem[] {
  const [budget, setBudget] = useState(FIRST_BATCH);

  // Reset DURING RENDER, not in an effect: setting state in an effect body
  // cascades renders (and the lint rule forbids it). Same adjust-state-on-prop-
  // change pattern as TrackedMarker and useSortAnchor.
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setBudget(FIRST_BATCH);
  }

  // Grow until everything is out. The setState is inside the timeout, which is
  // the sanctioned async shape; deps are primitives so a new pins array cannot
  // restart the clock on its own (this repo's identity-keyed-effect hazard).
  useEffect(() => {
    if (budget >= pins.length) {
      return;
    }
    const timer = setTimeout(() => setBudget((current) => current + BATCH), BATCH_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [budget, pins.length]);

  return useMemo(
    () => revealPins(pins, budget, selectedPostId),
    [pins, budget, selectedPostId],
  );
}
