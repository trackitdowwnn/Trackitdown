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
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { createLogger } from '@/shared/lib/logger';
import { colors, motion, radii, shadows, sizes, spacing } from '@/shared/theme';
import type { GeoRegion } from '@/shared/types';
import { FullscreenLoader } from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';

import { MapCardPager } from '../components/MapCardPager';
import { MAP_SHEET_PEEK_PERCENT, MapListSheet } from '../components/MapListSheet';
import { MapPins } from '../components/MapPins';
import { SearchThisAreaButton } from '../components/SearchThisAreaButton';
import { useFeedLocation } from '../hooks/useFeedLocation';
import { useMapSelection } from '../hooks/useMapSelection';
import { useViewportPosts } from '../hooks/useViewportPosts';
import { FEED_RADIUS_DEFAULT_MILES } from '../lib/feedConfig';
import { buildClusterIndex, clusterMemberCoords, pinsForRegion } from '../lib/mapClustering';
import { frameCoords, regionAround } from '../lib/regionMath';
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
  const { area } = useLocalSearchParams<{ area?: string; query?: string }>();
  const insets = useSafeAreaInsets();
  const { location } = useFeedLocation();

  // Resolve the entry region ONCE: area geocode → feed location → UK.
  const [entryRegion, setEntryRegion] = useState<GeoRegion | null>(null);
  useEffect(() => {
    if (entryRegion || !location) {
      return; // resolved already, or the feed location is still resolving
    }
    let cancelled = false;
    (async () => {
      if (area) {
        const hits = await expoLocationServices.forwardGeocode(area);
        if (!cancelled && hits.length > 0) {
          setEntryRegion(regionAround(hits[0], AREA_ENTRY_RADIUS_MILES));
          return;
        }
      }
      if (!cancelled) {
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
  }, [area, location, entryRegion]);

  if (!entryRegion) {
    return (
      <View style={styles.resolving}>
        <FullscreenLoader visible message="Finding the area" />
      </View>
    );
  }
  return <MapSearchBody entryRegion={entryRegion} onBack={() => router.back()} inset={insets.top} />;
}

function MapSearchBody({
  entryRegion,
  onBack,
  inset,
}: {
  entryRegion: GeoRegion;
  onBack: () => void;
  inset: number;
}) {
  const { status, result, searching, showSearchArea, onRegionChange, searchThisArea, retry } =
    useViewportPosts(entryRegion);
  const { selected, selectedIndex, selectPost, selectByIndex, clear } = useMapSelection(
    result.posts,
  );

  // Camera: uncontrolled map + this prop drives programmatic fly-tos only.
  const [camera, setCamera] = useState<GeoRegion>(entryRegion);
  // The region the user last settled on (for cluster-zoom fallback framing).
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

  const handlePressPost = useCallback(
    (id: string) => {
      selectPost(id);
      log.info('map_pin_select', { postId: id });
    },
    [selectPost],
  );

  const handlePressCluster = useCallback(
    (clusterId: number) => {
      setCamera(frameCoords(clusterMemberCoords(clusterIndex, clusterId), settledRegion));
      log.info('map_cluster_zoom', { clusterId });
    },
    [clusterIndex, settledRegion],
  );

  const handlePagerSettle = useCallback(
    (index: number) => {
      selectByIndex(index);
      const post = result.posts[index];
      if (post) {
        // Follow the card: pan to the pin at the user's CURRENT zoom.
        // `camera.latitudeDelta` is stale (only cluster-zoom/entry write it);
        // the live span lives in settledRegion.
        setCamera({
          latitude: post.latitude,
          longitude: post.longitude,
          latitudeDelta: settledRegion.latitudeDelta,
          longitudeDelta: settledRegion.longitudeDelta,
        });
      }
    },
    [selectByIndex, result.posts, settledRegion],
  );

  const openPost = useCallback((post: MapPost) => {
    // TODO(vehicles feature): route to the post detail once it exists.
    log.debug('map_card_press', { postId: post.id });
  }, []);

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
        posts={result.posts}
        status={status}
        onRetry={retry}
        onPressPost={openPost}
      />

      {/* Floating card pager rides above the sheet's peek. */}
      <View style={styles.pager} pointerEvents="box-none">
        <MapCardPager
          posts={result.posts}
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
    // Sits just above the sheet's peek — derived from the same constant so
    // the two can never drift (+2% breathing room).
    bottom: `${MAP_SHEET_PEEK_PERCENT + 2}%`,
  },
});
