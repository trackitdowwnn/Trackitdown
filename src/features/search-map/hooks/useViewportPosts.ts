/**
 * WHAT:  useViewportPosts — the search map's calm data machine: one search
 *        on entry, then results change ONLY when the user explicitly applies a
 *        search, taps "Search this area", or retries after an error. Panning
 *        just tracks whether the viewport has moved enough to OFFER the button.
 *        Applied criteria are STICKY: a "Search this area" re-search keeps the
 *        active filter, so a pan never silently drops it.
 * WHY:   Auto-refreshing on every pan makes a map feel jumpy and floods
 *        the RPC; the explicit-search model (the reference behaviour)
 *        keeps it calm. Races use the request-token pattern; busy flags
 *        clear unconditionally; the initial region + criteria are captured in
 *        refs and region comparisons live in refs — all lessons from useHomeFeed
 *        (see memory: identity-keyed effects loop silently).
 * LINKS: src/features/search-map/api/mapApi.ts (fetchSearchPosts);
 *        src/features/search-map/lib/searchCriteria.ts (SearchCriteria);
 *        src/features/search-map/lib/regionMath.ts (movedEnough);
 *        src/features/search-map/hooks/useHomeFeed.ts (patterns).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GeoRegion } from '@/shared/types';

import type { ViewportResult } from '../types';
import { fetchSearchPosts } from '../api/mapApi';
import { movedEnough, regionToBbox } from '../lib/regionMath';
import { type SearchCriteria, emptyCriteria } from '../lib/searchCriteria';

export type MapSearchStatus = 'loading' | 'ready' | 'error';

export interface UseViewportPostsResult {
  status: MapSearchStatus;
  result: ViewportResult;
  /** The region the current results were searched in — updates only when
   *  a search SUCCEEDS (drives peek-card distance ordering, so the order
   *  must never shift under the user mid-browse from a mere pan). */
  searchedRegion: GeoRegion;
  /** A re-search (the button) is in flight — results stay on screen. */
  searching: boolean;
  /** The viewport moved enough that "Search this area" should show. */
  showSearchArea: boolean;
  /** Feed every map region change here (onRegionChangeComplete). */
  onRegionChange: (region: GeoRegion) => void;
  /** Apply a new search: store the criteria and (re)search at `region` (the
   *  distance-chip-framed bbox). Subsequent "Search this area" keeps it. */
  applySearch: (next: { criteria: SearchCriteria; region: GeoRegion }) => Promise<void>;
  /** The button's action: search the CURRENT viewport with the active criteria. */
  searchThisArea: () => Promise<void>;
  /** Full retry after an initial-load error (drops to loading). */
  retry: () => void;
}

export function useViewportPosts(
  initialRegion: GeoRegion,
  initialCriteria?: SearchCriteria,
): UseViewportPostsResult {
  // Captured once — a parent passing a fresh-but-equal region per render
  // must never re-trigger the entry search.
  const initialRef = useRef(initialRegion);
  // Regions live in refs: onRegionChange fires on every map idle and must
  // compare against the LATEST searched region without re-creating itself.
  const searchedRegionRef = useRef(initialRegion);
  const currentRegionRef = useRef(initialRegion);
  // The active criteria — every search (entry, apply, re-search, retry) reads
  // this, so a filter stays sticky across pans until applySearch replaces it.
  const criteriaRef = useRef<SearchCriteria>(initialCriteria ?? emptyCriteria());
  const requestToken = useRef(0);

  const [status, setStatus] = useState<MapSearchStatus>('loading');
  const [result, setResult] = useState<ViewportResult>({ total: 0, posts: [] });
  // State mirror of searchedRegionRef: consumers re-render (and re-sort)
  // when a search lands; the ref stays for the region-compare callbacks.
  const [searchedRegion, setSearchedRegion] = useState<GeoRegion>(initialRegion);
  const [searching, setSearching] = useState(false);
  const [showSearchArea, setShowSearchArea] = useState(false);

  const runSearch = useCallback(
    (region: GeoRegion, kind: 'initial' | 'research'): Promise<void> => {
      const token = ++requestToken.current;
      // Promise-chained, not async/await: every setState lives in a
      // callback so effect callers never set state synchronously.
      const request = fetchSearchPosts(regionToBbox(region), criteriaRef.current);
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
          setSearchedRegion(region);
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

  const applySearch = useCallback(
    (next: { criteria: SearchCriteria; region: GeoRegion }): Promise<void> => {
      // Store the criteria first so runSearch (and any later "Search this area")
      // picks it up, then search at the framed region as a fresh entry-style
      // load (loading skeleton, not the keep-results re-search).
      criteriaRef.current = next.criteria;
      currentRegionRef.current = next.region;
      return runSearch(next.region, 'initial');
    },
    [runSearch],
  );

  const searchThisArea = useCallback(
    () => runSearch(currentRegionRef.current, 'research'),
    [runSearch],
  );

  const retry = useCallback(() => {
    void runSearch(currentRegionRef.current, 'initial');
  }, [runSearch]);

  return {
    status,
    result,
    searchedRegion,
    searching,
    showSearchArea,
    onRegionChange,
    applySearch,
    searchThisArea,
    retry,
  };
}
