/**
 * WHAT:  useViewportPosts — the search map's calm data machine: one search
 *        on entry, then results change ONLY when the user explicitly taps
 *        "Search this area" (or retries after an error). Panning just
 *        tracks whether the viewport has moved enough to OFFER the button.
 * WHY:   Auto-refreshing on every pan makes a map feel jumpy and floods
 *        the RPC; the explicit-search model (the reference behaviour)
 *        keeps it calm. Races use the request-token pattern; busy flags
 *        clear unconditionally; the initial region is captured once and
 *        region comparisons live in refs — all lessons from useHomeFeed
 *        (see memory: identity-keyed effects loop silently).
 * LINKS: src/features/search-map/api/mapApi.ts;
 *        src/features/search-map/lib/regionMath.ts (movedEnough);
 *        src/features/search-map/hooks/useHomeFeed.ts (patterns).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GeoRegion } from '@/shared/types';

import type { ViewportResult } from '../types';
import { fetchViewportPosts } from '../api/mapApi';
import { movedEnough, regionToBbox } from '../lib/regionMath';

export type MapSearchStatus = 'loading' | 'ready' | 'error';

export interface UseViewportPostsResult {
  status: MapSearchStatus;
  result: ViewportResult;
  /** A re-search (the button) is in flight — results stay on screen. */
  searching: boolean;
  /** The viewport moved enough that "Search this area" should show. */
  showSearchArea: boolean;
  /** Feed every map region change here (onRegionChangeComplete). */
  onRegionChange: (region: GeoRegion) => void;
  /** The button's action: search the CURRENT viewport. */
  searchThisArea: () => Promise<void>;
  /** Full retry after an initial-load error (drops to loading). */
  retry: () => void;
}

export function useViewportPosts(initialRegion: GeoRegion): UseViewportPostsResult {
  // Captured once — a parent passing a fresh-but-equal region per render
  // must never re-trigger the entry search.
  const initialRef = useRef(initialRegion);
  // Regions live in refs: onRegionChange fires on every map idle and must
  // compare against the LATEST searched region without re-creating itself.
  const searchedRegionRef = useRef(initialRegion);
  const currentRegionRef = useRef(initialRegion);
  const requestToken = useRef(0);

  const [status, setStatus] = useState<MapSearchStatus>('loading');
  const [result, setResult] = useState<ViewportResult>({ total: 0, posts: [] });
  const [searching, setSearching] = useState(false);
  const [showSearchArea, setShowSearchArea] = useState(false);

  const runSearch = useCallback(
    (region: GeoRegion, kind: 'initial' | 'research'): Promise<void> => {
      const token = ++requestToken.current;
      // Promise-chained, not async/await: every setState lives in a
      // callback so effect callers never set state synchronously.
      const request = fetchViewportPosts(regionToBbox(region));
      void Promise.resolve().then(() => {
        if (token !== requestToken.current) {
          return;
        }
        if (kind === 'initial') {
          setStatus('loading');
        } else {
          setSearching(true);
        }
      });
      return request
        .then((fresh) => {
          if (token !== requestToken.current) {
            return; // superseded — drop, never render stale
          }
          searchedRegionRef.current = region;
          setResult(fresh);
          setStatus('ready');
          setShowSearchArea(false);
        })
        .catch(() => {
          if (token !== requestToken.current) {
            return;
          }
          // A failed RE-search keeps the previous results on screen and
          // leaves the button up (the region is still unsearched); only a
          // failed initial load falls to the error state.
          if (kind === 'initial') {
            setStatus('error');
          }
        })
        .finally(() => {
          // Token-guarded: runSearch BUMPS the token per call (unlike
          // useHomeFeed.loadMore which reuses it), so a superseded request's
          // finally must NOT clear the flag while the newer one is in flight.
          if (token === requestToken.current) {
            setSearching(false);
          }
        });
    },
    [],
  );

  useEffect(() => {
    void runSearch(initialRef.current, 'initial');
  }, [runSearch]);

  const onRegionChange = useCallback((region: GeoRegion) => {
    currentRegionRef.current = region;
    setShowSearchArea(movedEnough(searchedRegionRef.current, region));
  }, []);

  const searchThisArea = useCallback(
    () => runSearch(currentRegionRef.current, 'research'),
    [runSearch],
  );

  const retry = useCallback(() => {
    void runSearch(currentRegionRef.current, 'initial');
  }, [runSearch]);

  return { status, result, searching, showSearchArea, onRegionChange, searchThisArea, retry };
}
