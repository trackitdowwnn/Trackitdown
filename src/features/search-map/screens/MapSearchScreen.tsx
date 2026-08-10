/**
 * WHAT:  MapSearchScreen — the app's centrepiece: a full-bleed map of
 *        ACTIVE stolen-car posts — one marker each, the top bounties as £
 *        pills and the rest as price-less lozenges — the list riding over it
 *        as a persistent peek/half/full sheet whose POSITION DRIVES THE ZOOM,
 *        which opens itself to half on entry; a floating card
 *        pager synced with pin selection, and results that FOLLOW THE MAP:
 *        re-searched a beat after each settled pan, paused while a card is open.
 * WHY:   Replaces the v1 stub. Entry region: an `area` route param
 *        forward-geocodes to that town; otherwise the feed's resolved
 *        location at its radius. The map mounts only after the entry
 *        region resolves so useViewportPosts' capture-once contract holds.
 * LINKS: src/features/search-map/README.md (map-search spec);
 *        hooks/useViewportPosts.ts, hooks/useMapSelection.ts,
 *        lib/{regionMath,mapPins}.ts, components/Map*.tsx;
 *        docs/SECURITY_AND_TRUST.md (active locations are public).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRequireAuth } from '@/features/auth';
import { useDevicePermission } from '@/features/permissions';
import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { createLogger } from '@/shared/lib/logger';
import { motion, sizes, spacing, useThemedStyles, type Palette } from '@/shared/theme';
import type { GeoCoord, GeoRegion } from '@/shared/types';
import { FullscreenLoader, useToast } from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';

import { MapCardPager } from '../components/MapCardPager';
import {
  MAP_SHEET_PEEK_PERCENT,
  MAP_SHEET_SNAP_PERCENTS,
  MapListSheet,
  sheetZoomFraction,
} from '../components/MapListSheet';
import { MapCircleButton } from '../components/MapCircleButton';
import { MapPins } from '../components/MapPins';
import { MapRecentreButton } from '../components/MapRecentreButton';
import { MapSearchPill } from '../components/MapSearchPill';
import { SearchSheet, type SourceRect } from '../components/SearchSheet';
import { useFeedLocation } from '../hooks/useFeedLocation';
import { useMapSelection, useMapSelectionState } from '../hooks/useMapSelection';
import { useProgressivePins } from '../hooks/useProgressivePins';
import { useSortAnchor } from '../hooks/useSortAnchor';
import { useViewportPosts } from '../hooks/useViewportPosts';
import { FEED_RADIUS_DEFAULT_MILES } from '../lib/feedConfig';
import {
  type SearchCriteria,
  emptyCriteria,
  isEmptyCriteria,
  parseCriteria,
  summarise,
  toRpcCriteria,
} from '../lib/searchCriteria';
import { keepMarkersOnScreen, pinsForRegion } from '../lib/mapPins';
import {
  type MapInsets,
  cameraForVisible,
  distanceMeters,
  entryFrame,
  isComfortablyVisible,
  metersToMiles,
  regionAround,
  visibleCentre,
  visibleRegion,
} from '../lib/regionMath';
import type { MapPost } from '../types';

const log = createLogger('search-map');

/** UK-wide fallback when nothing else resolves a starting point. */
const UK_REGION: GeoRegion = {
  latitude: 54.5,
  longitude: -2.5,
  latitudeDelta: 9,
  longitudeDelta: 9,
};

/** Framing for an area entry ("See all → St Albans"). */
const AREA_ENTRY_RADIUS_MILES = 5;

export function MapSearchScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { area, lat, lng, latDelta, lngDelta, criteria } = useLocalSearchParams<{
    area?: string;
    lat?: string;
    lng?: string;
    latDelta?: string;
    lngDelta?: string;
    /** JSON SearchCriteria from the feed's search surface — when present the
     *  map searches with this filter immediately (no location resolution). */
    criteria?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { location } = useFeedLocation();

  // The applied search carried from the feed (or empty for a plain browse).
  const initialCriteria = useMemo(() => parseCriteria(criteria) ?? emptyCriteria(), [criteria]);

  // Resolve the entry region ONCE: a fully-framed region from params (the feed
  // search, or a precise point) → area geocode → feed → UK.
  const [entryRegion, setEntryRegion] = useState<GeoRegion | null>(null);
  useEffect(() => {
    if (entryRegion) {
      return; // resolved already
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const hasCoords = Boolean(lat && lng && Number.isFinite(latNum) && Number.isFinite(lngNum));
    // A full span (latDelta/lngDelta) means the caller already framed the
    // region (the feed's search apply) — use it verbatim, no resolution.
    const latD = Number(latDelta);
    const lngD = Number(lngDelta);
    const hasSpan =
      Boolean(latDelta && lngDelta) && Number.isFinite(latD) && Number.isFinite(lngD);
    if (!hasCoords && !location) {
      return; // the feed location is still resolving
    }
    let cancelled = false;
    // All setState lives inside the async body so the effect never sets state
    // synchronously (which would risk cascading renders).
    (async () => {
      if (hasCoords) {
        if (!cancelled) {
          setEntryRegion(
            hasSpan
              ? { latitude: latNum, longitude: lngNum, latitudeDelta: latD, longitudeDelta: lngD }
              : regionAround({ latitude: latNum, longitude: lngNum }, AREA_ENTRY_RADIUS_MILES),
          );
        }
        return;
      }
      if (area) {
        const hits = await expoLocationServices.forwardGeocode(area);
        if (!cancelled && hits.length > 0) {
          setEntryRegion(regionAround(hits[0], AREA_ENTRY_RADIUS_MILES));
          return;
        }
      }
      if (!cancelled && location) {
        setEntryRegion(
          location.mode === 'local'
            ? regionAround(location, location.radiusMiles || FEED_RADIUS_DEFAULT_MILES)
            : UK_REGION,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [area, lat, lng, latDelta, lngDelta, location, entryRegion]);

  if (!entryRegion) {
    return (
      <View style={styles.resolving}>
        <FullscreenLoader visible message="Finding the area" />
      </View>
    );
  }
  return (
    <MapSearchBody
      entryRegion={entryRegion}
      initialCriteria={initialCriteria}
      onBack={() => router.back()}
      inset={insets.top}
      insetBottom={insets.bottom}
    />
  );
}

function MapSearchBody({
  entryRegion,
  initialCriteria,
  onBack,
  inset,
  insetBottom,
}: {
  entryRegion: GeoRegion;
  initialCriteria: SearchCriteria;
  onBack: () => void;
  inset: number;
  insetBottom: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const toast = useToast();
  // Read SILENTLY (useDevicePermission never prompts on mount) — this only
  // decides whether the blue dot is safe to draw. The recentre button owns
  // any asking.
  const locationPermission = useDevicePermission('location');
  const reduceMotion = useReducedMotion();
  // Selection state is owned HERE, above the data hook, because the map
  // pauses auto-search while a card is open and the hook needs to know that
  // before the post list (which is sorted from its own output) exists.
  const [selectedId, setSelectedId] = useMapSelectionState();
  const cardOpen = selectedId !== null;

  // How much of the map is covered by floating chrome, as fractions of its
  // height. Everything that FRAMES something (fly-tos, the "is this pin
  // comfortably visible" test, the sort anchor) goes through these, or it
  // frames into the band behind the sheet.
  //
  // These now TRACK THE SHEET (product call 2026-08-06). They were pinned to
  // the resting peek, on the reasoning that a camera chasing the sheet would
  // be motion nobody asked for — it is now asked for: the map zooms out as the
  // sheet rises so the same ground stays visible in the smaller strip.
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [pagerHeight, setPagerHeight] = useState(0);
  // ⚠️ INVARIANT: `handleSheetSnap` is the ONLY writer of this. It carries the
  // camera's return leg, so a second call site would let the index change
  // without the camera following — which is exactly the bug that shipped here:
  // a bare setSheetIndex(0) on pin-press meant a drag's zoom-out was never
  // undone, and the core loop (drag up, tap a car, close, drag up) ratcheted
  // the map out 1.59x per cycle until it showed the whole country. Keeping one
  // writer makes that unexpressible, which is a stronger guard than a test:
  // the bug was "nobody called the return leg", and no unit test can catch
  // an absent call.
  const [sheetIndex, setSheetIndex] = useState(0);
  const insetsForSheet = useCallback(
    (index: number): MapInsets => ({
      // sizes.control, NOT touchTarget: the row's tallest child is the search
      // pill (52), so measuring the 44 back button would frame 8pt too high
      // and let a pin sit behind the pill.
      top: (inset + spacing.md + sizes.control + spacing.sm) / windowHeight,
      bottom: cardOpen
        ? (pagerHeight + insetBottom + spacing.lg) / windowHeight
        : (MAP_SHEET_SNAP_PERCENTS[index] ?? MAP_SHEET_PEEK_PERCENT) / 100,
    }),
    [inset, insetBottom, windowHeight, cardOpen, pagerHeight],
  );
  const mapInsets = useMemo(
    () => insetsForSheet(sheetIndex),
    [insetsForSheet, sheetIndex],
  );

  /**
   * The insets the sheet-driven ZOOM uses — deliberately not insetsForSheet.
   *
   * Two differences, both wanted. The bottom is how far the sheet has risen
   * ABOVE peek (see sheetZoomFraction), so peek frames the whole map and the
   * zoom is gentler at every snap — that is what the reference measures. And
   * there is no cardOpen branch, so a re-measured pager height can never leak
   * into the camera scale.
   *
   * Safe to differ from insetsForSheet because handleSheetSnap applies this on
   * BOTH sides of the move: only the ratio between two snaps survives, so the
   * two functions never have to agree on an absolute, and a round trip returns
   * to the exact camera it started from.
   */
  const zoomInsetsForSheet = useCallback(
    (index: number): MapInsets => ({
      top: (inset + spacing.md + sizes.control + spacing.sm) / windowHeight,
      bottom: sheetZoomFraction(index),
    }),
    [inset, windowHeight],
  );

  const {
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
  } = useViewportPosts(entryRegion, { initialCriteria, paused: cardOpen });

  // The screen owns the APPLIED criteria (for the pill summary); the SearchSheet
  // owns the draft while it's open. Seeded from the search carried in from the
  // feed; the map pill re-opens the surface to refine.
  const [appliedCriteria, setAppliedCriteria] = useState<SearchCriteria>(initialCriteria);
  const [searchOpen, setSearchOpen] = useState(false);
  // The pill's measured rect, so the surface morphs out of it and back into it
  // (matching the feed). Held rather than recomputed on close: the pill is
  // unmounted-behind/covered while the surface is open, so it cannot be
  // re-measured at dismiss time — the rect captured on open IS the exit target.
  const [searchSourceRect, setSearchSourceRect] = useState<SourceRect | null>(null);
  // Stable so SearchSheet's back-handler effect doesn't re-register each render.
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // ONE distance-ordered list feeds the pager, the sheet, and selection-
  // index derivation, so "index" means the same thing everywhere.
  //
  // Measured from the anchor, NOT the live searched region: auto-search moves
  // that on every settled pan, and because selection is derived from the
  // INDEX, a reorder mid-read would point the pager at a different car than
  // the one on screen. useSortAnchor holds it still while a card is open.
  // The VISIBLE centre, not the rect centre — "nearest" must mean nearest to
  // what the user can actually see past the sheet.
  //
  // The insets used here are FROZEN at the resting peek, never `mapInsets`.
  // mapInsets tracks the sheet now, and the visible centre moves several miles
  // between snaps — so sorting off it would reorder the list under the very
  // finger dragging the sheet, and reorder the pager as the card's height is
  // re-measured. That is exactly the reorder useSortAnchor exists to stop; it
  // freezes the REGION, so the insets are the other way the bug gets in.
  const anchorRegion = useSortAnchor(searchedRegion, cardOpen);
  // Deliberately NOT insetsForSheet(0) — that still carries the card branch,
  // so a re-measured pager height would leak the reorder back in. This is the
  // resting geometry and nothing else: constant for the life of the screen.
  // Captured ONCE, not memoised: `windowHeight` and `inset` change on rotation
  // and on an Android keyboard show, which would move the sort centre and
  // reorder the list — including under an open card. A few percent of stale
  // top-inset shifts the centre imperceptibly; a reorder mid-read points the
  // pager at the wrong car.
  // Lazy initial state, not a ref: this is READ during render, and it must be
  // computed once rather than on every one.
  const [sortInsets] = useState<MapInsets>(() => ({
    top: (inset + spacing.md + sizes.control + spacing.sm) / windowHeight,
    bottom: MAP_SHEET_PEEK_PERCENT / 100,
  }));
  const sortedPosts = useMemo(() => {
    const centre = visibleCentre(anchorRegion, sortInsets);
    return result.posts
      .map((post) => ({ ...post, distanceMiles: metersToMiles(distanceMeters(centre, post)) }))
      // Id tie-break: server order varies between searches, and equal-
      // distance cards must not swap places under the user on a re-search.
      .sort((a, b) => a.distanceMiles - b.distanceMiles || a.id.localeCompare(b.id));
  }, [result.posts, anchorRegion, sortInsets]);

  const { selected, selectedIndex, selectPost, selectByIndex, clear } = useMapSelection(
    sortedPosts,
    selectedId,
    setSelectedId,
  );

  // Camera: uncontrolled map + this prop drives programmatic fly-tos only.
  const [camera, setCamera] = useState<GeoRegion>(entryRegion);
  // The current VIEW — the last user settle or programmatic fly-to target.
  // Drives pin slicing (which posts are culled into view) and the fallback
  // framing when there are no results to frame around.
  const [settledRegion, setSettledRegion] = useState<GeoRegion>(entryRegion);

  // Culled to the current view and ranked pill-vs-mini. `settledRegion` is the
  // dep that matters: `result.posts` only refreshes when a search LANDS, so
  // without re-culling on every settle a pan would keep drawing markers the
  // user has already moved away from.
  // Ranked, then nudged off the viewport edge. Markers that would OVERLAP are
  // left to overlap: every one is drawn on its own car, at every zoom.
  // Spreading them apart was tried and reverted the same day (2026-08-07) —
  // holding a constant on-screen gap needs a ground offset proportional to the
  // zoom span, so fanned markers slid across the map on every camera settle and
  // drifted further the more you zoomed out. keepMarkersOnScreen is not the
  // same trade: it moves the marker's BOX, never its coordinate.
  const allPins = useMemo(
    () =>
      keepMarkersOnScreen(pinsForRegion(result.posts, settledRegion), settledRegion, windowWidth),
    [result.posts, settledRegion, windowWidth],
  );
  // Mounted in batches rather than all at once — nothing thins the population
  // any more, so a dense area is up to VIEWPORT_POST_LIMIT custom markers in
  // one commit, each holding tracksViewChanges open for 500ms.
  //
  // populationId, NOT searchId: searchId bumps on every landed search
  // INCLUDING the auto re-search after each pan, which returns a largely
  // overlapping set. Resetting there would unmount ~68 already-drawn markers
  // per pan and re-arm 500ms of tracking on each as they came back — more jank
  // than not batching at all, and the exact failure this hook exists to stop.
  //
  // The selected id goes in so the reveal can never withhold the pin the card
  // is describing — the pager selects across ALL result posts, not just the
  // drawn ones.
  const pins = useProgressivePins(allPins, populationId, selected?.id ?? null);

  const handleRegionChange = useCallback(
    (region: GeoRegion) => {
      setSettledRegion(region);
      onRegionChange(region);
    },
    [onRegionChange],
  );

  // Programmatic fly-tos: AppMap deliberately does NOT report its own
  // animations as settles (isGesture filter), so treat the TARGET as the
  // settled view — pins re-slice for the new region and useViewportPosts'
  // current-region ref stays honest (the auto re-search would otherwise
  // compare against a pre-fly-to viewport). A later user gesture corrects
  // any aspect-fit drift between target and actual.
  // Which clock the next camera move runs on. Set alongside the camera itself
  // so a sheet drag and its zoom share one duration.
  const [cameraDurationMs, setCameraDurationMs] = useState<number>(motion.mapPan);

  const flyTo = useCallback(
    (region: GeoRegion) => {
      setCameraDurationMs(motion.mapPan);
      setCamera(region);
      setSettledRegion(region);
      onRegionChange(region);
    },
    [onRegionChange],
  );

  /**
   * Move the camera WITHOUT asking for results — for moves the user did not
   * request data for: the zoom that tracks the sheet, and the initial framing
   * around results we already hold.
   *
   * The only difference from flyTo is recordRegion instead of onRegionChange.
   * That matters a lot: a sheet drag changes the zoom by far more than
   * movedEnough's 1.4x threshold, so going through flyTo would fire a network
   * search on every drag, in both directions.
   */
  const frameCamera = useCallback(
    (region: GeoRegion) => {
      // The UI clock: frameCamera only ever serves the sheet drag and the
      // one-time result framing, and the sheet runs on motion.standard.
      setCameraDurationMs(motion.standard);
      setCamera(region);
      setSettledRegion(region);
      recordRegion(region);
    },
    [recordRegion],
  );

  // The sheet moved: hold the VISIBLE ground still and re-derive the camera for
  // the new chrome. Zooming out as the sheet rises is the whole point — the
  // same cars stay on screen in the strip that's left.
  const handleSheetSnap = useCallback(
    (index: number) => {
      if (index === sheetIndex) {
        return;
      }
      // Side effects belong in the HANDLER, never inside a setState updater:
      // updaters must be pure and React invokes them twice under StrictMode,
      // which would fire the camera move twice per drag.
      const stillVisible = visibleRegion(settledRegion, zoomInsetsForSheet(sheetIndex));
      frameCamera(cameraForVisible(stillVisible, zoomInsetsForSheet(index)));
      setSheetIndex(index);
      // Logged so a sheet move is DISTINGUISHABLE from a map gesture. Both
      // move the camera and only one may search, and without this the two are
      // indistinguishable after the fact — a drag that started searching would
      // look exactly like the user pinching.
      //
      // NOT a drag count: this also fires for the moves the app makes itself —
      // the entry auto-expand, and the return to peek on a pin press. The event
      // means "the sheet moved", which is what the camera cares about.
      log.info('map_sheet_snap', { from: sheetIndex, to: index });
    },
    [sheetIndex, settledRegion, zoomInsetsForSheet, frameCamera],
  );

  const handlePressPost = useCallback(
    (id: string) => {
      selectPost(id);
      // The sheet is CLOSED (not snapped) while a card is up and returns to
      // PEEK when the card dismisses, so our index must follow it back to 0.
      //
      // handleSheetSnap(0), NOT a bare setSheetIndex(0) — this is the ZOOM's
      // return leg and it has to run somewhere. The dismissal path cannot do
      // it: the sheet's snapToIndex(0) reports index 0, which handleSheetSnap
      // early-returns on because our index already says 0. So a bare setState
      // left the map permanently at the drag's zoom-out, and the screen's core
      // loop — drag the list up, tap a car, close it, drag up again — RATCHETED
      // it: 1.59x, 2.5x, 4.0x, 6.3x, out to nothing over a session.
      //
      // Done here rather than in an effect on `cardOpen`: a pin tap is the only
      // way a card opens, and setState in an effect body cascades renders.
      handleSheetSnap(0);
      log.info('map_pin_select', { postId: id });
    },
    [selectPost, handleSheetSnap],
  );

  // Recentring is a PAN, not a zoom jump — it keeps the span the user chose.
  // The fly-to feeds onRegionChange like any other move, so the normal
  // debounced search follows: you asked to go there, you want results there.
  const handleRecentre = useCallback(
    (coord: GeoCoord) => {
      flyTo(
        cameraForVisible(
          {
            ...coord,
            // visibleRegion, NOT an inline (1 - top - bottom): visibleFractionOf
            // FLOORS the fraction at 0.2, so the two only agree while the sheet
            // is low. At the full snap bottom is 0.88 and the inline gives
            // 0.012 — cameraForVisible then divides by the floored 0.2 and
            // recentring becomes a ~16x zoom IN. On a tall-inset, short-window
            // device the inline goes NEGATIVE and hands the map a negative
            // latitudeDelta. This is the floored value by construction, so the
            // round trip is exact at every snap.
            latitudeDelta: visibleRegion(settledRegion, mapInsets).latitudeDelta,
            longitudeDelta: settledRegion.longitudeDelta,
          },
          mapInsets,
        ),
      );
      log.info('map_recentre');
    },
    [flyTo, settledRegion, mapInsets],
  );


  const handlePagerSettle = useCallback(
    (index: number) => {
      selectByIndex(index);
      const post = sortedPosts[index];
      // Follow the card ONLY when needed: a pin already comfortably on
      // screen gets no camera move (never a jarring recentre); an edge or
      // off-screen pin gets a gentle pan at the user's CURRENT zoom
      // (settledRegion holds the live span).
      // "Comfortably visible" is judged against what the user can SEE — a pin
      // sitting behind the card pager is not visible, however central it is.
      if (post && !isComfortablyVisible(post, visibleRegion(settledRegion, mapInsets))) {
        flyTo(
          cameraForVisible(
            {
              latitude: post.latitude,
              longitude: post.longitude,
              // Floored — see handleRecentre above for what the inline
              // (1 - top - bottom) does at the taller snaps.
              latitudeDelta: visibleRegion(settledRegion, mapInsets).latitudeDelta,
              longitudeDelta: settledRegion.longitudeDelta,
            },
            mapInsets,
          ),
        );
      }
    },
    [selectByIndex, sortedPosts, settledRegion, flyTo, mapInsets],
  );

  // OPEN FRAMED ON THE NEARBY RESULTS, once. The entry region is a fixed radius
  // (the feed's 20 miles, or 5 from a "See all → area" link, or the whole UK in
  // national mode), which opens nearly empty in one place and crowded in
  // another; framing what actually came back is honest in both.
  //
  // entryFrame, NOT frameCoords: fitting EVERY result is honest and unusable.
  // Posts scattered nationwide forced a ~64km view at ~100 m/pt, where cars
  // 800m apart drew 8pt apart under an 18pt marker — they overlapped into
  // blobs that had to be zoomed into, which is exactly the problem clustering
  // used to solve and we no longer have. entryFrame caps the opening span.
  // Via frameCamera — these are results we already hold, so framing them must
  // not trigger another search.
  //
  // A ref, not state: this must happen once per screen and must NOT re-fire
  // when auto-search lands new results under the user mid-browse.
  const framedOnResults = useRef(false);
  useEffect(() => {
    if (framedOnResults.current || status !== 'ready' || result.posts.length === 0) {
      return;
    }
    framedOnResults.current = true;
    frameCamera(cameraForVisible(entryFrame(result.posts, entryRegion), mapInsets));
  }, [status, result.posts, entryRegion, mapInsets, frameCamera]);

  // A failed auto re-search is quiet by design: results and pins stay put and
  // the map keeps working. Fired on the EDGE (a boolean dep), so a re-render
  // never re-announces. The next settled pan re-attempts by itself, because a
  // failure leaves the searched region unmoved.
  // The toast CARRIES THE RETRY. Deleting "Search this area" also deleted the
  // manual re-search, so without an action here the only way back is to pan
  // 30% of the viewport again — a big gesture, and nothing tells the user
  // that is what's required.
  //
  // Drops the SELECTION first, for the same reason handleClearSearch does:
  // retry() runs immediately and does NOT consult the hook's `paused` (only
  // the debounced auto-search does), and the toast stays on screen while a
  // card is up — only the list sheet hides. Swapping the result set under an
  // open card leaves the index-derived pager pointing at a different vehicle
  // than the card shows, and that card files sightings by post.id.
  const handleRetry = useCallback(() => {
    clear();
    retry();
  }, [clear, retry]);

  useEffect(() => {
    if (searchFailed) {
      toast.show("Couldn't refresh this area.", 'error', {
        label: 'Try again',
        onPress: handleRetry,
      });
    }
  }, [searchFailed, toast, handleRetry]);

  // Android back with a card up dismisses the card, not the screen.
  // Keyed on a boolean, not the `selected` object — its identity changes
  // per sortedPosts rebuild (this repo's identity-keyed-effect hazard).
  const hasSelection = selectedIndex >= 0;
  useEffect(() => {
    // While the search surface is open, ITS back handler owns the gesture
    // (closes the sheet); don't also register the card-clear one.
    if (!hasSelection || searchOpen) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clear();
      return true; // consumed — the screen stays
    });
    return () => subscription.remove();
  }, [hasSelection, searchOpen, clear]);

  const openPost = useCallback(
    (post: MapPost) => {
      log.debug('map_card_press', { postId: post.id });
      router.push(`/post/${post.id}`);
    },
    [router],
  );

  // The peek card's direct entry into report-sighting: gated (guests sign in
  // via the sheet; the continuation lands them in the wizard, source=map).
  const requireAuth = useRequireAuth();
  const onSeenPost = useCallback(
    (post: MapPost) => {
      requireAuth({
        context: 'report_sighting',
        run: () => {
          router.push({
            pathname: '/report-sighting',
            params: { postId: post.id, source: 'map', bounty: String(post.bountyPence) },
          });
        },
      });
    },
    [requireAuth, router],
  );

  // Apply a search assembled in the surface: close the surface, fly the camera
  // to the distance-framed region, and re-query.
  const handleApplySearch = useCallback(
    (criteria: SearchCriteria, region: GeoRegion) => {
      setAppliedCriteria(criteria);
      setSearchOpen(false);
      flyTo(region);
      void applySearch({ criteria, region });
      // Which criteria the user searched by (KEY presence only) + the coarse
      // distance band — no coordinates, no plate (there is no plate criterion).
      log.info('search_apply', {
        criteriaKeys: Object.keys(toRpcCriteria(criteria)),
        distanceMiles: criteria.distanceMiles,
      });
    },
    [flyTo, applySearch],
  );

  // The pill's × — drop the filter and re-query the current region unfiltered.
  //
  // Drops the SELECTION first, and that is not tidiness. applySearch runs
  // immediately and does NOT consult the hook's `paused` (only the debounced
  // auto-search does), so it replaces the result set whether or not a card is
  // open — and the × is its own nested Pressable inside the pill, still live
  // while a card is up. Selection is derived from the sort INDEX, so a swapped
  // result set leaves the pager pointing at a DIFFERENT car while showing the
  // same card, and that card's "I've seen this car" carries post.id straight
  // into the sighting wizard. A sighting filed against the wrong vehicle.
  // Unlike the pill BODY (which returns and asks for a second tap), clearing a
  // filter should still happen on one tap — so clear and continue.
  const handleClearSearch = useCallback(() => {
    clear();
    const empty = emptyCriteria();
    setAppliedCriteria(empty);
    void applySearch({ criteria: empty, region: searchedRegion });
  }, [clear, applySearch, searchedRegion]);

  // (Android back while the search surface is open is owned by SearchSheet.)

  return (
    <View style={styles.container}>
      {/* The map + its controls. Hidden from assistive tech while the search
          surface is open so AT focus can't reach pins/pill behind it. */}
      <View
        style={styles.container}
        importantForAccessibility={searchOpen ? 'no-hide-descendants' : 'auto'}
      >
        <AppMap
          region={camera}
          // Sheet-driven moves take the UI clock (standard, matching the
          // sheet's own timing) so the two read as ONE gesture; geographic
          // moves — a card follow, a recentre — keep the slower map clock.
          // Reduced motion cuts both to instant, or the sheet would snap while
          // the map kept flying, which is the opposite of one gesture.
          animateDurationMs={reduceMotion ? motion.instant : cameraDurationMs}
        onRegionChangeStart={() => {}}
        onRegionChangeComplete={handleRegionChange}
        onPress={clear}
        // ONLY when already granted — on Android this flips
        // setMyLocationEnabled, which can raise the OS dialog, and a map that
        // merely opened must never ask for anything.
        showsUserLocation={locationPermission.status?.state === 'granted'}
      >
        <MapPins
          pins={pins}
          selectedPostId={selected?.id ?? null}
          onPressPost={handlePressPost}
        />
      </AppMap>

      <View style={[styles.topBar, { top: inset + spacing.md }]} pointerEvents="box-none">
        <MapCircleButton icon="chevron-left" accessibilityLabel="Back" onPress={onBack} />
        {/* Opening a search while a card is up would replace the results the
            card belongs to — applySearch runs directly and does not consult
            the hook's `paused`. Dismiss the card first; the pill is one tap
            away again immediately. */}
        <MapSearchPill
          summary={isEmptyCriteria(appliedCriteria) ? null : summarise(appliedCriteria)}
          onPress={(rect) => {
            if (hasSelection) {
              clear();
              return;
            }
            setSearchSourceRect(rect);
            setSearchOpen(true);
          }}
          onClear={handleClearSearch}
        />
        {/* INLINE with the back button and the pill (2026-08-10, owner's call).
            It used to sit on its own layer below the row, for two reasons that
            still apply and are handled rather than ignored:

            1. Three controls on one line leave the pill ~224dp on a 360dp
               screen, so a long summary truncates. The pill takes the slack
               (flex) and already clips to one line, and the owner chose a
               narrower pill over a second row.
            2. This button renders NOTHING until the silent permission check
               lands, so appearing late would resize the pill under the user's
               finger. The fixed-size SLOT below reserves its space either way,
               which is what makes the inline position safe — do not drop the
               wrapper and render the button directly. */}
        <View style={styles.recentreSlot} pointerEvents="box-none">
          <MapRecentreButton onLocate={handleRecentre} />
        </View>
      </View>

      <MapListSheet
        total={result.total}
        posts={sortedPosts}
        status={status}
        searching={searching}
        searchId={searchId}
        hidden={hasSelection}
        // Either outcome opens it — an error or an empty area is still
        // something to read, and leaving it at peek would hide the message.
        expandOnEntry={status !== 'loading'}
        onSnapChange={handleSheetSnap}
        onRetry={handleRetry}
        onPressPost={openPost}
      />

      {/* Floating card pager anchors to the bottom safe area — the list
          sheet hides while a card is up, so the card owns that space. */}
      <View
        style={[styles.pager, { bottom: insetBottom + spacing.lg }]}
        pointerEvents="box-none"
        // Measured so the camera can inset by the card's REAL height rather
        // than a guess — the card's height varies with its content.
        onLayout={(event) => setPagerHeight(event.nativeEvent.layout.height)}
      >
        <MapCardPager
          posts={sortedPosts}
          selectedIndex={selectedIndex}
          onIndexSettled={handlePagerSettle}
          onPressPost={openPost}
          onSeenPost={onSeenPost}
        />
      </View>
      </View>

      {searchOpen ? (
        <SearchSheet
          initialCriteria={appliedCriteria}
          region={searchedRegion}
          sourceRect={searchSourceRect}
          onApply={handleApplySearch}
          onClose={closeSearch}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  resolving: {
    flex: 1,
    backgroundColor: c.background,
  },
  // Top row: back button + the search pill sharing the top inset. The 16pt
  // gutter (not the usual 24) is the map's own exception — full-bleed map
  // chrome hugs the edges so the tiles stay the content (DESIGN_SYSTEM).
  topBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // Holds the recentre button's place in the top-bar row whether or not it has
  // rendered yet. Without this the pill would grow to fill the gap and then
  // shrink a beat later, when the silent permission check lands.
  // sizes.touchTarget, NOT sizes.control: this must be the SAME box
  // MapCircleButton draws (44), or the button sits in the corner of an
  // oversized slot and reads as misaligned with the back button opposite it —
  // which is exactly what a 52 here did (4px high, and shy of the right edge).
  // The centring is belt-and-braces should the button's own size ever change.
  recentreSlot: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pager: {
    position: 'absolute',
    left: 0,
    right: 0,
    // `bottom` set inline: bottom safe-area inset + spacing.lg.
  },
});
