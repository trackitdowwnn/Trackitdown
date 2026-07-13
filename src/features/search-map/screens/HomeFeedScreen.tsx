/**
 * WHAT:  HomeFeedScreen — the Explore tab. One vertical FlashList renders
 *        the whole sectioned feed (typed items: sectionHeader / heroCard /
 *        carouselRow), headed by the "Cars near <Area>" bar + search pill,
 *        with the floating Map pill that hides on scroll-down. States:
 *        skeleton (first load), pull-to-refresh, good-news empty (+ national
 *        fallback section), error with retry.
 * WHY:   One FlashList with getItemType recycling is the non-negotiable
 *        performance architecture (research: nested vertical lists and
 *        per-section FlatLists judder on mid-range Android). Every recycled
 *        row derives all state from its item. Sections arrive composed from
 *        get_home_feed; this screen only lays them out.
 * LINKS: src/features/search-map/README.md (the spec);
 *        src/features/search-map/lib/feedSections.ts (flattening rules);
 *        docs/DESIGN_SYSTEM.md (states, motion, tone).
 */

import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewToken } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { createLogger } from '@/shared/lib/logger';
import { spacing } from '@/shared/theme';
import type { PostSummary } from '@/shared/types';
import {
  EmptyState,
  ErrorState,
  LocationPickerModal,
  Screen,
  ThemedRefreshControl,
  VehicleCard,
} from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';

import { FeedAreaHeader } from '../components/FeedAreaHeader';
import { FeedCarouselRow } from '../components/FeedCarouselRow';
import { FeedSectionHeader } from '../components/FeedSectionHeader';
import { FeedSkeleton } from '../components/FeedSkeleton';
import { FeedTopBar } from '../components/FeedTopBar';
import { LocationPrimerCard } from '../components/LocationPrimerCard';
import { MapPillButton } from '../components/MapPillButton';
import { useFeedLocation } from '../hooks/useFeedLocation';
import { useHomeFeed } from '../hooks/useHomeFeed';
import {
  FEED_RADIUS_DEFAULT_MILES,
  FEED_RADIUS_MAX_MILES,
  FEED_RADIUS_WIDEN_STEP_MILES,
} from '../lib/feedConfig';
import {
  NEAR_YOU_SECTION_ID,
  asCarousels,
  feedDisplay,
  feedItemType,
  flattenSections,
} from '../lib/feedSections';
import type { FeedItem } from '../types';

const log = createLogger('search-map');

/** "Widen the area" steps: current default → wider → the allowed max. */
const WIDEN_STEPS = [
  FEED_RADIUS_DEFAULT_MILES,
  FEED_RADIUS_WIDEN_STEP_MILES,
  FEED_RADIUS_MAX_MILES,
];

/** Scroll must travel this far (px) before the Map pill toggles — avoids
 *  flicker from sub-pixel scroll jitter. */
const SCROLL_DIRECTION_THRESHOLD = 12;

/** Hoisted — the FlatList family rejects a viewabilityConfig that changes
 *  identity between renders. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50 };

export function HomeFeedScreen() {
  const router = useRouter();
  const { location, showLocationPrimer, setArea, requestMyLocation } = useFeedLocation();
  const { status, sections, refresh, refreshing, loadMore, loadingMore, retry } =
    useHomeFeed(location);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [mapPillVisible, setMapPillVisible] = useState(true);
  const lastOffsetY = useRef(0);
  // Section-impression dedup: one log per section per load (docs/LOGGING.md
  // — ids only). Reset when a load lands.
  const impressed = useRef(new Set<string>());

  const display = useMemo(
    () => feedDisplay(sections, location?.mode === 'national' ? 'national' : 'local'),
    [sections, location?.mode],
  );
  // Every section renders as a horizontal rail (reference feed layout).
  const items = useMemo(
    () =>
      flattenSections(
        asCarousels(display.kind === 'feed' ? display.sections : display.fallbackSections),
      ),
    [display],
  );

  const openSearchMap = useCallback(
    (params?: { area?: string }) => {
      router.push({ pathname: '/search-map', params });
    },
    [router],
  );

  const onPressPost = useCallback(
    (post: PostSummary) => {
      log.debug('feed_post_press', { postId: post.id });
      router.push(`/post/${post.id}`);
    },
    [router],
  );

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const delta = y - lastOffsetY.current;
    if (Math.abs(delta) < SCROLL_DIRECTION_THRESHOLD) {
      return;
    }
    lastOffsetY.current = y;
    // Down hides, up shows; near the top it is always shown.
    setMapPillVisible(delta < 0 || y <= 0);
  }, []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
      for (const token of viewableItems) {
        const item = token.item;
        const sectionId =
          item.type === 'heroCard' ? item.sectionId : item.section.id;
        if (!impressed.current.has(sectionId)) {
          impressed.current.add(sectionId);
          log.info('feed_section_impression', { sectionId });
        }
      }
    },
    [],
  );

  const onRefresh = useCallback(() => {
    impressed.current.clear();
    void refresh();
  }, [refresh]);

  const widenArea = useCallback(() => {
    if (!location || location.mode !== 'local') {
      return;
    }
    const next = WIDEN_STEPS.find((step) => step > location.radiusMiles);
    if (next) {
      void setArea({
        latitude: location.latitude,
        longitude: location.longitude,
        addressLabel: location.addressLabel,
        radiusMiles: next,
      });
    }
  }, [location, setArea]);

  const localAreaLabel = location?.mode === 'local' ? location.addressLabel : '';

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      switch (item.type) {
        case 'sectionHeader':
          // near_you's header carries the location context and the
          // area-change control (the reference layout has no page title).
          if (item.section.id === NEAR_YOU_SECTION_ID) {
            return (
              <FeedAreaHeader
                areaLabel={localAreaLabel}
                onPressArea={() => setPickerOpen(true)}
              />
            );
          }
          return (
            <FeedSectionHeader
              title={item.section.title}
              onSeeAll={
                item.section.area
                  ? () => openSearchMap({ area: item.section.area })
                  : undefined
              }
            />
          );
        case 'heroCard':
          return (
            <View style={styles.heroCard}>
              <VehicleCard post={item.post} onPress={() => onPressPost(item.post)} />
            </View>
          );
        case 'carouselRow':
          return (
            <FeedCarouselRow
              section={item.section}
              onPressPost={onPressPost}
              // The near_you rail pages horizontally as it nears its end,
              // showing a trailing skeleton card while the page loads.
              onEndReached={
                item.section.id === NEAR_YOU_SECTION_ID ? () => void loadMore() : undefined
              }
              loadingMore={item.section.id === NEAR_YOU_SECTION_ID && loadingMore}
            />
          );
      }
    },
    [openSearchMap, onPressPost, localAreaLabel, loadMore, loadingMore],
  );

  const areaLabel =
    location?.mode === 'local' ? (location.addressLabel || 'your area') : null;

  const listHeader = (
    <View>
      <FeedTopBar onPressSearch={() => openSearchMap()} />
      {showLocationPrimer ? (
        <LocationPrimerCard
          onUseMyLocation={() => void requestMyLocation()}
          onSetArea={() => setPickerOpen(true)}
        />
      ) : null}
      {display.kind === 'good-news-empty' && location?.mode === 'local' ? (
        <>
          {/* With no page title, the area header must appear here too or
              the good-news state loses its change-area control. */}
          <FeedAreaHeader
            areaLabel={localAreaLabel}
            onPressArea={() => setPickerOpen(true)}
          />
          <EmptyState
            title={`No stolen cars reported near ${areaLabel} right now`}
            body="That's a good thing. Widen the area, or check back later."
            actionLabel={location.radiusMiles < FEED_RADIUS_MAX_MILES ? 'Widen the area' : undefined}
            onAction={location.radiusMiles < FEED_RADIUS_MAX_MILES ? widenArea : undefined}
          />
        </>
      ) : null}
      {location?.mode === 'national' && items.length === 0 ? (
        // National mode with a genuinely empty country — same good-news tone.
        <EmptyState
          title="No stolen cars reported right now"
          body="That's a good thing. Check back later."
        />
      ) : null}
    </View>
  );

  return (
    <Screen>
      {!location || (status === 'loading' && !refreshing) ? (
        <FeedSkeleton />
      ) : status === 'error' ? (
        // Keep the pill and area control in the error state so search and
        // "change area" stay reachable — the failure may be area-specific.
        <View>
          <FeedTopBar onPressSearch={() => openSearchMap()} />
          {location?.mode === 'local' ? (
            <FeedAreaHeader
              areaLabel={localAreaLabel}
              onPressArea={() => setPickerOpen(true)}
            />
          ) : null}
          <ErrorState body="We couldn't load the feed." onRetry={retry} />
        </View>
      ) : (
        <>
          <FlashList
            data={items}
            renderItem={renderItem}
            keyExtractor={(item) => item.key}
            getItemType={feedItemType}
            ListHeaderComponent={listHeader}
            refreshControl={
              <ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            // Vertical end-reached is NOT pagination — the near_you rail
            // pages itself horizontally via its own onEndReached.
            onScroll={onScroll}
            scrollEventThrottle={16}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={VIEWABILITY_CONFIG}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
          <MapPillButton visible={mapPillVisible} onPress={() => openSearchMap()} />
        </>
      )}

      <LocationPickerModal
        visible={pickerOpen}
        title="Set my area"
        confirmLabel="Set area"
        MapComponent={AppMap}
        locationServices={expoLocationServices}
        initialLocation={
          location?.mode === 'local'
            ? { latitude: location.latitude, longitude: location.longitude }
            : undefined
        }
        onConfirm={(value) => {
          setPickerOpen(false);
          void setArea({
            latitude: value.latitude,
            longitude: value.longitude,
            addressLabel: value.addressLabel,
            radiusMiles:
              location?.mode === 'local' ? location.radiusMiles : FEED_RADIUS_DEFAULT_MILES,
          });
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: spacing.xxxl + spacing.xxl, // clear the floating Map pill
  },
  heroCard: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
});
