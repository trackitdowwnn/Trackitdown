/**
 * WHAT:  useViewportPosts — the search map's data machine. One search on
 *        entry, then the map RE-SEARCHES ITSELF a beat after the user stops
 *        panning, plus explicit applySearch (criteria) and retry. Applied
 *        criteria are STICKY: an auto re-search keeps the active filter, so a
 *        pan never silently drops it.
 * WHY:   Results follow the map, which is what a map-shaped product is
 *        expected to do (product call 2026-08-06, replacing the earlier
 *        "Search this area" button — the button made the user do bookkeeping
 *        the app can do itself).
 *
 *        THREE THINGS KEEP IT FROM BEING JUMPY, and none is optional:
 *        1. `movedEnough` — a nudge or momentum drift never re-searches.
 *        2. AUTO_SEARCH_DEBOUNCE_MS — a sequence of hunting gestures collapses
 *           into ONE search at the final region.
 *        3. `paused` — while a card is open, nothing re-searches AND anything
 *           already in flight is disowned. Results changing under someone who
 *           is reading is the worst version of this feature; the postponed
 *           search runs when they close the card.
 *
 *        Ordering safety lives OUTSIDE this hook: searchedRegion moving is
 *        what reorders the list, so the screen freezes its sort anchor while a
 *        card is up (see useSortAnchor). This hook only promises not to change
 *        MEMBERSHIP while paused.
 *
 *        Races use the request-token pattern; busy flags clear unconditionally;
 *        the initial region + criteria are captured in refs and region
 *        comparisons live in refs — all lessons from useHomeFeed (see memory:
 *        identity-keyed effects loop silently).
 * LINKS: src/features/search-map/api/mapApi.ts (fetchSearchPosts);
 *        src/features/search-map/lib/searchCriteria.ts (SearchCriteria);
 *        src/features/search-map/lib/regionMath.ts (movedEnough);
 *        src/features/search-map/hooks/useHomeFeed.ts (patterns).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { motion } from '@/shared/theme';
import type { GeoRegion } from '@/shared/types';

import type { ViewportResult } from '../types';
import { fetchSearchPosts } from '../api/mapApi';
import { movedEnough, regionToBbox } from '../lib/regionMath';
import { type SearchCriteria, emptyCriteria } from '../lib/searchCriteria';

export type MapSearchStatus = 'loading' | 'ready' | 'error';

/**
 * How long after the map settles before it re-searches.
 *
 * This is NOT frame smoothing — AppMap only reports onRegionChangeComplete,
 * and only for real gestures, so every event here is already a settled
 * gesture. What this absorbs is a SEQUENCE of them: drag, drag again, pinch,
 * while the user is still hunting. Human pauses between hunting gestures run
 * ~300-500ms; a deliberate stop to look is comfortably longer. It also has to
 * outlast the Android momentum tail (a fling can emit two settles) and a
 * programmatic fly-to's own echo.
 *
 * DERIVED from motion.mapPan rather than hard-coded, so that dependency is
 * enforced instead of merely described: if the fly-to ever slows down, this
 * moves with it and cannot silently start firing mid-animation.
 */
const AUTO_SEARCH_DEBOUNCE_MS = motion.mapPan + 250;

export interface UseViewportPostsResult {
  status: MapSearchStatus;
  result: ViewportResult;
  /** The region the current results were searched in — updates only when
   *  a search SUCCEEDS. Drives the distance ordering, so the screen freezes
   *  its anchor off this while a card is open (useSortAnchor). */
  searchedRegion: GeoRegion;
  /** A re-search is in flight — results stay on screen. */
  searching: boolean;
  /** Bumped once per LANDED search. A primitive on purpose: consumers that
   *  must react to "these are different results" (the sheet resetting its
   *  scroll) key off this, never off the posts array identity, which also
   *  changes when the sort anchor moves. */
  searchId: number;
  /**
   * Bumped only when a search REPLACES the population wholesale — the entry
   * load, an applied search, an explicit retry. NOT the auto re-search that
   * follows a pan, which returns a largely overlapping set.
   *
   * Separate from `searchId` because the two answer different questions.
   * "Are these different results?" (the sheet's scroll reset) is true after
   * every pan. "Is this a different set of cars?" is not — and a consumer that
   * throws away mounted work on the answer, like the progressive marker
   * reveal, must key off THIS or it re-does that work on every pan and costs
   * more than it saves.
   */
  populationId: number;
  /** The last auto re-search failed. Results and pins are untouched; the
   *  screen surfaces this quietly rather than blanking the map. */
  searchFailed: boolean;
  /** Feed every map region change here (onRegionChangeComplete). */
  onRegionChange: (region: GeoRegion) => void;
  /**
   * Note where the camera is WITHOUT scheduling a search.
   *
   * For camera moves the user did not ask results for — today, the zoom that
   * tracks the bottom sheet. Dragging the sheet changes the zoom by far more
   * than movedEnough's 1.4x threshold, so routing it through onRegionChange
   * would fire a network search on every drag, in BOTH directions. Recording
   * (rather than ignoring) keeps the ref honest, so the user's next real pan is
   * still measured against the viewport actually on screen.
   */
  recordRegion: (region: GeoRegion) => void;
  /** Apply a new search: store the criteria and (re)search at `region` (the
   *  distance-chip-framed bbox). Later auto re-searches keep it. */
  applySearch: (next: { criteria: SearchCriteria; region: GeoRegion }) => Promise<void>;
  /** Full retry after an initial-load error (drops to loading). */
  retry: () => void;
}

export interface UseViewportPostsOptions {
  initialCriteria?: SearchCriteria;
  /** While true, panning is recorded but NEVER searched — the card is open
   *  and the user is reading. The deferred search runs on unpause. */
  paused?: boolean;
}

export function useViewportPosts(
  initialRegion: GeoRegion,
  options: UseViewportPostsOptions = {},
): UseViewportPostsResult {
  const { initialCriteria, paused = false } = options;
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
  // The pending auto-search. One timer, always replaced — never queued.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `paused` mirrored into a ref: onRegionChange must read the LATEST value
  // without being re-created, or every consumer re-registers on each toggle
  // (see memory: identity-keyed effects loop silently).
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  // Separate from pausedRef, which is a same-tick mirror: this one lags by one
  // effect run so the pause effect below can see the EDGE.
  const wasPaused = useRef(paused);

  const [status, setStatus] = useState<MapSearchStatus>('loading');
  const [result, setResult] = useState<ViewportResult>({ total: 0, posts: [] });
  // State mirror of searchedRegionRef: consumers re-render (and re-sort)
  // when a search lands; the ref stays for the region-compare callbacks.
  const [searchedRegion, setSearchedRegion] = useState<GeoRegion>(initialRegion);
  const [searching, setSearching] = useState(false);
  const [searchId, setSearchId] = useState(0);
  const [populationId, setPopulationId] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);

  // What is currently in flight. The pause path reads both: disowning an
  // 'initial' also throws away the user's EXPLICIT search, so its region is
  // stashed and re-run on unpause rather than lost.
  const inFlightKind = useRef<'initial' | 'research' | null>(null);
  const inFlightRegion = useRef<GeoRegion>(initialRegion);
  /** An explicit search a card interrupted. Re-run when the card closes. */
  const deferredInitial = useRef<GeoRegion | null>(null);

  const runSearch = useCallback(
    (region: GeoRegion, kind: 'initial' | 'research'): Promise<void> => {
      const token = ++requestToken.current;
      inFlightKind.current = kind;
      inFlightRegion.current = region;
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
        setSearchFailed(false);
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
          setSearchId((n) => n + 1);
          // 'initial' is the entry load, an applied search and an explicit
          // retry — the three that swap the population wholesale. A 'research'
          // is the auto re-search after a pan, which mostly returns the same
          // cars, so consumers that discard mounted work must not see it.
          if (kind === 'initial') {
            setPopulationId((n) => n + 1);
          }
          // Cleared HERE, not in .finally — see the note there.
          setSearching(false);
        })
        .catch(() => {
          if (token !== requestToken.current) {
            return;
          }
          // A failed RE-search keeps the previous results on screen; only a
          // failed initial load falls to the error state. searchedRegionRef is
          // left UNMOVED, so the next settled pan is still "moved enough" and
          // re-attempts by itself — which is what replaces the old button's
          // "this area is unsearched" affordance.
          if (kind === 'initial') {
            setStatus('error');
          } else {
            setSearchFailed(true);
          }
          setSearching(false);
        })
        .finally(() => {
          // `searching` is cleared in the .then/.catch bodies above, NOT here.
          // .finally is a LATER microtask, so React commits it separately — and
          // that split was observable: searchId bumped in commit 1 while
          // `searching` was still true, so MapListSheet's iOS announcement fired
          // on a label that still read "Searching this area…", and never
          // re-fired for the count. A VoiceOver user was told the search had
          // started at the moment it finished, every time. Both bodies already
          // carry the same token guard the old .finally had, so a superseded
          // request still cannot clear the flag out from under a newer one.
          if (token === requestToken.current) {
            inFlightKind.current = null;
          }
        });
    },
    [],
  );

  useEffect(() => {
    void runSearch(initialRef.current, 'initial');
  }, [runSearch]);

  /** Cancel any pending auto-search. Safe to call when nothing is pending. */
  const cancelPending = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  /** Schedule the debounced re-search, if the map has actually moved and
   *  nothing is holding it back. Replaces any pending one, so a burst of
   *  gestures collapses to a single search at the FINAL region. */
  const scheduleAutoSearch = useCallback(() => {
    cancelPending();
    if (pausedRef.current) {
      return;
    }
    if (!movedEnough(searchedRegionRef.current, currentRegionRef.current)) {
      return;
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void runSearch(currentRegionRef.current, 'research');
    }, AUTO_SEARCH_DEBOUNCE_MS);
  }, [cancelPending, runSearch]);

  const onRegionChange = useCallback(
    (region: GeoRegion) => {
      // Always RECORD, even while paused — the region is what the deferred
      // search will use the moment the card closes.
      currentRegionRef.current = region;
      scheduleAutoSearch();
    },
    [scheduleAutoSearch],
  );

  const recordRegion = useCallback((region: GeoRegion) => {
    currentRegionRef.current = region;
  }, []);

  // Unpausing runs the search the open card postponed. Depending on `paused`
  // (a boolean, not an object) is safe; the ref mirror above is for the
  // callbacks, this effect is for the edge.
  useEffect(() => {
    // The TRANSITION, not the state. Disowning on the state would kill the
    // entry load of a hook that mounts already paused: the initial-load effect
    // is declared above this one, so it has already taken a token by the time
    // this runs, and the screen would sit on the skeleton for ever.
    const justPaused = paused && !wasPaused.current;
    wasPaused.current = paused;
    if (paused) {
      cancelPending();
      // EVERY kind is disowned, including 'initial'. Exempting it (the first
      // attempt at this) bought a stranded-skeleton fix at the cost of the
      // hook's headline promise: an applied search or a toast retry left in
      // flight would land while a card was open and swap MEMBERSHIP underneath
      // it — the pager resolves its settle index against the new list, so a
      // swipe at that moment lands on a different car than the card shows.
      //
      // Instead the initial's region is STASHED and re-run on unpause. That
      // keeps all three properties at once: membership never moves while
      // paused, `status` never strands on the skeleton, and the user's explicit
      // search still happens — a beat later, which is what the pause promises
      // everywhere else. Stashing (rather than leaning on the unpause's
      // scheduleAutoSearch) is load-bearing: movedEnough is false if they never
      // panned, so the search would simply never run.
      if (justPaused) {
        if (inFlightKind.current === 'initial') {
          deferredInitial.current = inFlightRegion.current;
        }
        inFlightKind.current = null;
        // ...and DISOWN anything already in flight. Cancelling the timer only
        // stops searches that hadn't started; a request that left before the
        // card opened would still land and swap the results out from under
        // someone reading them — which is the exact promise this pause makes.
        // Bumping the token makes runSearch's own guard drop that response.
        //
        // It also stops useSortAnchor stranding: a search landing while frozen
        // advances `seen` without advancing the anchor, leaving the list
        // ordered by distance from an area the user has already left.
        requestToken.current += 1;
        // Disowning it means its own `finally` will no longer clear the flag,
        // so clear it here — in a microtask, matching runSearch above: a
        // synchronous setState in an effect body cascades renders, and the lint
        // rule for that is on. Without this the spinner would run until the
        // next search, which a paused map may never make.
        void Promise.resolve().then(() => setSearching(false));
      }
      return;
    }
    // Unpaused. An explicit search the card interrupted goes FIRST and alone —
    // it is what the user actually asked for, and scheduleAutoSearch would not
    // run it (movedEnough is false if they never panned).
    if (deferredInitial.current) {
      const region = deferredInitial.current;
      deferredInitial.current = null;
      void runSearch(region, 'initial');
      return;
    }
    scheduleAutoSearch();
  }, [paused, cancelPending, scheduleAutoSearch, runSearch]);

  // A pending search must never outlive the screen — the callback would set
  // state on an unmounted hook.
  useEffect(() => cancelPending, [cancelPending]);

  const applySearch = useCallback(
    (next: { criteria: SearchCriteria; region: GeoRegion }): Promise<void> => {
      // Store the criteria first so runSearch (and any later auto re-search)
      // picks it up, then search at the framed region as a fresh entry-style
      // load (loading skeleton, not the keep-results re-search).
      criteriaRef.current = next.criteria;
      currentRegionRef.current = next.region;
      // An explicit apply supersedes anything the map had queued.
      cancelPending();
      return runSearch(next.region, 'initial');
    },
    [cancelPending, runSearch],
  );

  const retry = useCallback(() => {
    cancelPending();
    void runSearch(currentRegionRef.current, 'initial');
  }, [cancelPending, runSearch]);

  return {
    status,
    result,
    searchedRegion,
    searching,
    searchId,
    populationId,
    searchFailed,
    onRegionChange,
    recordRegion,
    applySearch,
    retry,
  };
}
