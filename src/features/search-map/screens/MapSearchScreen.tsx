/**
 * WHAT:  MapSearchScreen — the app's centrepiece: a full-bleed map of
 *        ACTIVE stolen-car posts as bounty-pill pins with clustering, the
 *        list riding over it as a persistent peek/half/full sheet, a
 *        floating card pager synced with pin selection, and the calm
 *        "Search this area" model (results change only on explicit search).
 * WHY:   Replaces the v1 stub. Entry region: an `area` route param
 *        forward-geocodes to that town; otherwise the feed's resolved
 *        location at its radius. The map mounts only after the entry
 *        region resolves so useViewportPosts' capture-once contract holds.
 * LINKS: src/features/search-map/README.md (map-search spec);
 *        hooks/useViewportPosts.ts, hooks/useMapSelection.ts,
 *        lib/{regionMath,mapClustering}.ts, components/Map*.tsx;
 *        docs/SECURITY_AND_TRUST.md (active locations are public).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { createLogger } from '@/shared/lib/logger';
import { colors, motion, radii, shadows, sizes, spacing } from '@/shared/theme';
import type { GeoRegion } from '@/shared/types';
import { FullscreenLoader } from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';

import { MapCardPager } from '../components/MapCardPager';
import { MapListSheet } from '../components/MapListSheet';
import { MapPins } from '../components/MapPins';
import { SearchThisAreaButton } from '../components/SearchThisAreaButton';
import { useFeedLocation } from '../hooks/useFeedLocation';
import { useMapSelection } from '../hooks/useMapSelection';
import { useViewportPosts } from '../hooks/useViewportPosts';
import { FEED_RADIUS_DEFAULT_MILES } from '../lib/feedConfig';
import { buildClusterIndex, clusterMemberCoords, pinsForRegion } from '../lib/mapClustering';
import {
  distanceMeters,
  frameCoords,
  isComfortablyVisible,
  metersToMiles,
  regionAround,
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
  const router = useRouter();
  const { area, lat, lng } = useLocalSearchParams<{
    area?: string;
    query?: string;
    lat?: string;
    lng?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { location } = useFeedLocation();

  // Resolve the entry region ONCE: exact lat/lng → area geocode → feed → UK.
  const [entryRegion, setEntryRegion] = useState<GeoRegion | null>(null);
  useEffect(() => {
    if (entryRegion) {
      return; // resolved already
    }
    // Precise-point entry ("Last seen here" on a post) resolves without the
    // feed location; everything else waits for it.
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const hasCoords = Boolean(lat && lng && Number.isFinite(latNum) && Number.isFinite(lngNum));
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
            regionAround({ latitude: latNum, longitude: lngNum }, AREA_ENTRY_RADIUS_MILES),
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
  }, [area, lat, lng, location, entryRegion]);

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
      onBack={() => router.back()}
      inset={insets.top}
      insetBottom={insets.bottom}
    />
  );
}

function MapSearchBody({
  entryRegion,
  onBack,
  inset,
  insetBottom,
}: {
  entryRegion: GeoRegion;
  onBack: () => void;
  inset: number;
  insetBottom: number;
}) {
  const router = useRouter();
  const {
    status,
    result,
    searchedRegion,
    searching,
    showSearchArea,
    onRegionChange,
    searchThisArea,
    retry,
  } = useViewportPosts(entryRegion);

  // ONE distance-ordered list feeds the pager, the sheet, and selection-
  // index derivation, so "index" means the same thing everywhere. Distance
  // is from the SEARCHED region's centre (stable while browsing — a pan
  // without a re-search never reshuffles the cards under the user).
  const sortedPosts = useMemo(() => {
    const centre = { latitude: searchedRegion.latitude, longitude: searchedRegion.longitude };
    return result.posts
      .map((post) => ({ ...post, distanceMiles: metersToMiles(distanceMeters(centre, post)) }))
      // Id tie-break: server order varies between searches, and equal-
      // distance cards must not swap places under the user on a re-search.
      .sort((a, b) => a.distanceMiles - b.distanceMiles || a.id.localeCompare(b.id));
  }, [result.posts, searchedRegion]);

  const { selected, selectedIndex, selectPost, selectByIndex, clear } =
    useMapSelection(sortedPosts);

  // Camera: uncontrolled map + this prop drives programmatic fly-tos only.
  const [camera, setCamera] = useState<GeoRegion>(entryRegion);
  // The current VIEW — the last user settle or programmatic fly-to target.
  // Drives pin slicing and cluster-zoom fallback framing.
  const [settledRegion, setSettledRegion] = useState<GeoRegion>(entryRegion);

  const clusterIndex = useMemo(() => buildClusterIndex(result.posts), [result.posts]);
  const pins = useMemo(
    () => pinsForRegion(clusterIndex, settledRegion),
    [clusterIndex, settledRegion],
  );

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
  // current-region ref stays honest ("Search this area" would otherwise
  // compare against a pre-fly-to viewport). A later user gesture corrects
  // any aspect-fit drift between target and actual.
  const flyTo = useCallback(
    (region: GeoRegion) => {
      setCamera(region);
      setSettledRegion(region);
      onRegionChange(region);
    },
    [onRegionChange],
  );

  const handlePressPost = useCallback(
    (id: string) => {
      selectPost(id);
      log.info('map_pin_select', { postId: id });
    },
    [selectPost],
  );

  const handlePressCluster = useCallback(
    (clusterId: number) => {
      flyTo(frameCoords(clusterMemberCoords(clusterIndex, clusterId), settledRegion));
      log.info('map_cluster_zoom', { clusterId });
    },
    [clusterIndex, settledRegion, flyTo],
  );

  const handlePagerSettle = useCallback(
    (index: number) => {
      selectByIndex(index);
      const post = sortedPosts[index];
      // Follow the card ONLY when needed: a pin already comfortably on
      // screen gets no camera move (never a jarring recentre); an edge or
      // off-screen pin gets a gentle pan at the user's CURRENT zoom
      // (settledRegion holds the live span).
      if (post && !isComfortablyVisible(post, settledRegion)) {
        flyTo({
          latitude: post.latitude,
          longitude: post.longitude,
          latitudeDelta: settledRegion.latitudeDelta,
          longitudeDelta: settledRegion.longitudeDelta,
        });
      }
    },
    [selectByIndex, sortedPosts, settledRegion, flyTo],
  );

  // Android back with a card up dismisses the card, not the screen.
  // Keyed on a boolean, not the `selected` object — its identity changes
  // per sortedPosts rebuild (this repo's identity-keyed-effect hazard).
  const hasSelection = selectedIndex >= 0;
  useEffect(() => {
    if (!hasSelection) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clear();
      return true; // consumed — the screen stays
    });
    return () => subscription.remove();
  }, [hasSelection, clear]);

  const openPost = useCallback(
    (post: MapPost) => {
      log.debug('map_card_press', { postId: post.id });
      router.push(`/post/${post.id}`);
    },
    [router],
  );

  return (
    <View style={styles.container}>
      <AppMap
        region={camera}
        animateDurationMs={motion.mapPan}
        onRegionChangeStart={() => {}}
        onRegionChangeComplete={handleRegionChange}
        onPress={clear}
      >
        <MapPins
          pins={pins}
          selectedPostId={selected?.id ?? null}
          onPressPost={handlePressPost}
          onPressCluster={handlePressCluster}
        />
      </AppMap>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={[styles.backButton, { top: inset + spacing.md }]}
      >
        <Feather name="chevron-left" size={sizes.icon} color={colors.textPrimary} />
      </Pressable>

      <View style={[styles.searchArea, { top: inset + spacing.md }]} pointerEvents="box-none">
        <SearchThisAreaButton
          visible={showSearchArea}
          searching={searching}
          onPress={() => void searchThisArea()}
        />
      </View>

      <MapListSheet
        total={result.total}
        posts={sortedPosts}
        status={status}
        hidden={hasSelection}
        onRetry={retry}
        onPressPost={openPost}
      />

      {/* Floating card pager anchors to the bottom safe area — the list
          sheet hides while a card is up, so the card owns that space. */}
      <View
        style={[styles.pager, { bottom: insetBottom + spacing.lg }]}
        pointerEvents="box-none"
      >
        <MapCardPager
          posts={sortedPosts}
          selectedIndex={selectedIndex}
          onIndexSettled={handlePagerSettle}
          onPressPost={openPost}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  resolving: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    // lifted (not soft) to stay legible over busy map tiles, matching the
    // search-this-area pill's elevation.
    ...shadows.lifted,
  },
  searchArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pager: {
    position: 'absolute',
    left: 0,
    right: 0,
    // `bottom` set inline: bottom safe-area inset + spacing.lg.
  },
});
