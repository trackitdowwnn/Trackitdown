/**
 * WHAT:  useHomeFeed — loads the composed feed for a resolved location,
 *        exposes pull-to-refresh, and paginates the near_you hero section
 *        (offset = posts already loaded, page size 10, capped concurrency).
 * WHY:   One hook owns the feed's async state machine (loading → ready |
 *        error) so the screen only renders. Pagination merges through
 *        appendHeroPage (dedup by id — offset pages can drift when posts
 *        change underneath). Reloads whenever the resolved location changes;
 *        a stale response from a superseded location is dropped via a
 *        request token, never rendered.
 * LINKS: src/features/search-map/api/feedApi.ts;
 *        src/features/search-map/lib/feedSections.ts;
 *        docs/TESTING.md (Tier 2 — hook logic with mocked API).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FeedLocation, FeedSection } from '../types';
import { fetchHomeFeed, fetchNearbyPosts } from '../api/feedApi';
import { FEED_PAGE_SIZE } from '../lib/feedConfig';
import { appendHeroPage, heroPostCount } from '../lib/feedSections';

export type HomeFeedStatus = 'loading' | 'ready' | 'error';

export interface UseHomeFeedResult {
  status: HomeFeedStatus;
  sections: FeedSection[];
  /** Pull-to-refresh: reloads in place without dropping to the skeleton. */
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** Load the next hero page (no-op while busy or exhausted). */
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  /** Full reload after an error (drops to the skeleton). */
  retry: () => void;
}

export function useHomeFeed(location: FeedLocation | null): UseHomeFeedResult {
  const [status, setStatus] = useState<HomeFeedStatus>('loading');
  const [sections, setSections] = useState<FeedSection[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped on every (re)load; responses carrying an old token are stale.
  const requestToken = useRef(0);
  const heroExhausted = useRef(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const feedParams = useCallback((loc: FeedLocation) => {
    return loc.mode === 'local'
      ? { latitude: loc.latitude, longitude: loc.longitude, radiusMiles: loc.radiusMiles }
      : { latitude: null, longitude: null, radiusMiles: 0 };
  }, []);

  const load = useCallback(
    (loc: FeedLocation, kind: 'initial' | 'refresh'): Promise<void> => {
      const token = ++requestToken.current;
      // Deliberately promise-CHAINED, not async/await: every setState lives
      // in a .then/.catch callback, so the reload effect that calls load()
      // never sets state synchronously in its body
      // (react-hooks/set-state-in-effect). The request starts first; the
      // loading/refreshing flip follows one microtask later.
      const request = fetchHomeFeed(feedParams(loc));
      void Promise.resolve().then(() => {
        if (token !== requestToken.current) {
          return;
        }
        if (kind === 'initial') {
          setStatus('loading');
          setSections([]);
          // A location change can supersede an in-flight refresh; that
          // refresh's finally will skip (stale token), so clear here or the
          // spinner sticks and suppresses the skeleton.
          setRefreshing(false);
        } else {
          setRefreshing(true);
        }
      });
      return request
        .then((fresh) => {
          if (token !== requestToken.current) {
            return; // superseded by a newer load — drop, never render stale
          }
          heroExhausted.current = heroPostCount(fresh) < FEED_PAGE_SIZE;
          setSections(fresh);
          setStatus('ready');
        })
        .catch(() => {
          if (token !== requestToken.current) {
            return;
          }
          // Refresh failures keep the stale-but-real feed on screen; only an
          // initial load falls to the ErrorState.
          if (kind === 'initial') {
            setStatus('error');
          }
        })
        .finally(() => {
          if (token === requestToken.current && kind === 'refresh') {
            setRefreshing(false);
          }
        });
    },
    [feedParams],
  );

  // (Re)load whenever the resolved location MEANINGFULLY changes or retry()
  // bumps the nonce. Keyed by the location's VALUES, not object identity — a
  // parent passing a fresh-but-equal location object per render must not
  // refetch (worst case it loops: fetch → setState → render → new object →
  // fetch …). Only the fields the query uses are deps; addressLabel changes
  // never refetch.
  const mode = location?.mode ?? null;
  const lat = location?.mode === 'local' ? location.latitude : null;
  const lng = location?.mode === 'local' ? location.longitude : null;
  const radius = location?.mode === 'local' ? location.radiusMiles : null;

  useEffect(() => {
    if (!mode) {
      return;
    }
    const loc: FeedLocation =
      mode === 'local' && lat !== null && lng !== null && radius !== null
        ? {
            mode: 'local',
            latitude: lat,
            longitude: lng,
            radiusMiles: radius,
            addressLabel: '', // load() only reads coordinates + radius
            fromPreference: false,
          }
        : { mode: 'national' };
    void load(loc, 'initial');
  }, [mode, lat, lng, radius, reloadNonce, load]);

  const refresh = useCallback(async () => {
    if (location) {
      await load(location, 'refresh');
    }
  }, [location, load]);

  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);

  const loadMore = useCallback(async () => {
    if (
      !location ||
      location.mode !== 'local' ||
      status !== 'ready' ||
      loadingMore ||
      heroExhausted.current
    ) {
      return;
    }
    const offset = heroPostCount(sections);
    if (offset === 0) {
      return; // no hero section (good-news empty / national) — nothing to page
    }
    setLoadingMore(true);
    const token = requestToken.current;
    try {
      const page = await fetchNearbyPosts({
        latitude: location.latitude,
        longitude: location.longitude,
        radiusMiles: location.radiusMiles,
        offset,
        limit: FEED_PAGE_SIZE,
      });
      if (token !== requestToken.current) {
        return;
      }
      if (page.length < FEED_PAGE_SIZE) {
        heroExhausted.current = true;
      }
      if (page.length > 0) {
        setSections((current) => appendHeroPage(current, page));
      }
    } catch {
      // Silent: the user just stops getting new pages; the next scroll retries.
    } finally {
      // Unconditional: the token guard is right for APPLYING the page but
      // wrong here — nothing else ever clears this flag, so a superseded
      // page request must still release it or pagination wedges forever.
      setLoadingMore(false);
    }
  }, [location, status, loadingMore, sections]);

  return { status, sections, refresh, refreshing, loadMore, loadingMore, retry };
}
