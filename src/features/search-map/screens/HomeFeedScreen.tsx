/**
 * WHAT:  HomeFeedScreen — the Explore tab. One vertical FlashList renders
 *        the whole sectioned feed (typed items: sectionHeader / heroCard /
 *        carouselRow), headed by the search pill; every section (near_you
 *        included) uses the standard FeedSectionHeader, near_you's chevron
 *        opening the area picker. Floating Map pill hides on scroll-down.
 *        States:
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
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewToken } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { createLogger } from '@/shared/lib/logger';
import { markStartup } from '@/shared/lib/startupTrace';
import { SaveYourCarCard, useGarageNudgeCard } from '@/features/garage';
import { useMyProfile } from '@/features/profile';
import { WatchToggle } from '@/features/watchlist';
import { radii, spacing, typography, usePalette } from '@/shared/theme';
import type { GeoRegion, PostSummary } from '@/shared/types';
import {
  EmptyState,
  ErrorState,
  LocationPickerModal,
  Screen,
  ThemedRefreshControl,
  UK_DEFAULT_REGION,
  VehicleCard,
} from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';

import { FeedCarouselRow } from '../components/FeedCarouselRow';
import { FeedSectionHeader } from '../components/FeedSectionHeader';
import { FeedSkeleton } from '../components/FeedSkeleton';
import { FeedTopBar } from '../components/FeedTopBar';
import { LocationPrimerCard } from '../components/LocationPrimerCard';
import { MapPillButton } from '../components/MapPillButton';
import { SearchSheet, type SourceRect } from '../components/SearchSheet';
import { useFeedLocation } from '../hooks/useFeedLocation';
import { useHomeFeed } from '../hooks/useHomeFeed';
import {
  FEED_RADIUS_DEFAULT_MILES,
  FEED_RADIUS_MAX_MILES,
  FEED_RADIUS_WIDEN_STEP_MILES,
} from '../lib/feedConfig';
import { regionAround } from '../lib/regionMath';
import { type SearchCriteria, emptyCriteria } from '../lib/searchCriteria';
import {
  NEAR_YOU_FALLBACK_TITLE,
  NEAR_YOU_SECTION_ID,
  asCarousels,
  feedDisplay,
  feedItemType,
  flattenSections,
  insertAfterFirstSection,
} from '../lib/feedSections';
import type { FeedItem, FeedNudgeItem } from '../types';

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
  const palette = usePalette();
  // No requestMyLocation here any more: the primer row opens the PICKER, whose
  // own current-location button owns the permission prompt (the feed must never
  // cold-fire it). The hook still exposes it for a future one-tap caller.
  const { location, showLocationPrimer, setArea } = useFeedLocation();
  const { status, sections, refresh, refreshing, loadMore, loadingMore, retry } =
    useHomeFeed(location);

  // The garage nudge. Account age is read here and INJECTED — the garage must
  // never import features/profile, since profile already imports the garage
  // (the My cars hint) and that would close a cycle. The hook keeps its own
  // fetch behind cheap checks, so a new or already-offered user costs nothing.
  //
  // ONE NUDGE AT A TIME. Both cards are setup offers, and stacked they are a
  // wall rather than a feed. The garage card is handed an `active` saying
  // whether the higher-priority offer already owns the slot, so its own
  // `visible` means "on screen" — which keeps the impression logs honest and
  // stops a suppressed card from fetching. Priority, most urgent first:
  //
  //   1. location primer — a feed pointed at the wrong area is wrong for
  //      everything else, including the offer below
  //   2. garage — pre-theft setup, worth little once something has happened
  //
  // The alert-area offer USED to be a third rung here. It now lives at the app
  // root as AlertNudgeSheet, earned by finishing three listings rather than
  // shown to everyone on arrival — so it no longer competes for this slot.
  const myProfile = useMyProfile();
  const garageNudge = useGarageNudgeCard({
    accountCreatedAt: myProfile.status === 'ready' ? myProfile.profile.createdAt : null,
    active: !showLocationPrimer,
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [mapPillVisible, setMapPillVisible] = useState(true);
  // The search surface opens RIGHT HERE on the feed (instant — no navigation
  // to the map first), morphing out of the pill's measured rect. Applying it
  // navigates to the map with the results.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSourceRect, setSearchSourceRect] = useState<SourceRect | null>(null);
  const lastOffsetY = useRef(0);

  const openSearch = useCallback((rect: SourceRect) => {
    setSearchSourceRect(rect);
    setSearchOpen(true);
  }, []);
  // Stable so SearchSheet's back-handler effect doesn't re-register each render.
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Hide the bottom tab bar while the full-screen search filter is open (the
  // standard tabBarStyle mechanism — AppTabBar animates it out/in).
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: { display: searchOpen ? 'none' : 'flex' } });
  }, [navigation, searchOpen]);
  // Section-impression dedup: one log per section per load (docs/LOGGING.md
  // — ids only). Reset when a load lands.
  const impressed = useRef(new Set<string>());

  const display = useMemo(
    () => feedDisplay(sections, location?.mode === 'national' ? 'national' : 'local'),
    [sections, location?.mode],
  );
  // Every section renders as a horizontal rail (reference feed layout).
  const sectionItems = useMemo(
    () =>
      flattenSections(
        asCarousels(display.kind === 'feed' ? display.sections : display.fallbackSections),
      ),
    [display],
  );

  // MOUNT — see the phase's note in startupTrace. Empty deps so it fires once,
  // as early in this component's life as an effect can.
  useEffect(() => {
    markStartup('feed_mounted');
  }, []);

  // FIRST PAINT — the moment there are actually cars on screen, which is what
  // the user was waiting for. Not `feed_loaded` (the RPC returning) and not
  // mount (the skeleton): both would flatter the number. markStartup is
  // idempotent, so a re-render or a pull-to-refresh cannot re-fire it.
  useEffect(() => {
    if (sectionItems.length > 0) {
      markStartup('feed_first_paint');
    }
  }, [sectionItems.length]);

  // The garage offer rides BETWEEN rails rather than above them, so the tab
  // opens on cars. Kept as a nullable item (rather than folded into the render)
  // because the empty-feed fallback below needs to know whether one exists.
  const feedNudge = useMemo<FeedNudgeItem | null>(
    () => (garageNudge.visible ? { type: 'nudgeRow', key: 'nudge_garage', nudge: 'garage' } : null),
    [garageNudge.visible],
  );

  const items = useMemo(
    () => (feedNudge ? insertAfterFirstSection(sectionItems, feedNudge) : sectionItems),
    [sectionItems, feedNudge],
  );

  // With no rails at all (good-news-empty / empty country) there is nothing for
  // the offer to sit after, so it falls back to the header — otherwise it would
  // vanish for exactly the people with the emptiest feed.
  const nudgeInHeader = feedNudge !== null && sectionItems.length === 0;

  // Navigate to the map WITHOUT a search — the Map pill (browse) and
  // "See all → <area>" links. A `region` frames the map on exactly what the
  // section covers; `area` lets the map resolve a named locality itself.
  const openMap = useCallback(
    (options?: { area?: string; region?: GeoRegion }) => {
      const params: Record<string, string> = {};
      if (options?.area) {
        params.area = options.area;
      }
      if (options?.region) {
        params.lat = String(options.region.latitude);
        params.lng = String(options.region.longitude);
        params.latDelta = String(options.region.latitudeDelta);
        params.lngDelta = String(options.region.longitudeDelta);
      }
      router.push({ pathname: '/search-map', params });
    },
    [router],
  );

  // The region the search surface frames + counts against: the feed's current
  // area (instantly known), or the national view when browsing nationally.
  const searchRegion: GeoRegion =
    location?.mode === 'local'
      ? regionAround(
          { latitude: location.latitude, longitude: location.longitude },
          location.radiusMiles || FEED_RADIUS_DEFAULT_MILES,
        )
      : UK_DEFAULT_REGION;

  // Apply the assembled search: remember it, then navigate to the map carrying
  // the criteria + the distance-framed region as params, so the map skips its
  // location-resolution loader and shows the filtered results immediately.
  const handleApplySearch = useCallback(
    (criteria: SearchCriteria, region: GeoRegion) => {
      setSearchOpen(false);
      router.push({
        pathname: '/search-map',
        params: {
          lat: String(region.latitude),
          lng: String(region.longitude),
          latDelta: String(region.latitudeDelta),
          lngDelta: String(region.longitudeDelta),
          criteria: JSON.stringify(criteria),
        },
      });
    },
    [router],
  );

  // (Android back is owned by SearchSheet while it's open — it plays the
  // reverse morph before unmounting.)

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
        // A nudge row belongs to no section — it has its own impression log in
        // its hook, and reading `.section` here would throw.
        if (item.type === 'nudgeRow') {
          continue;
        }
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

  // "Near <Area>" in the standard section-title style — the same pattern as
  // the area carousels ("Recently stolen in <Area>"), so the current area
  // stays visible without the old bespoke header sentence. Falls back to the
  // server's plain title when no area label resolved.
  const nearYouTitle =
    location?.mode === 'local' && location.addressLabel
      ? `Near ${location.addressLabel}`
      : NEAR_YOU_FALLBACK_TITLE;

  // One definition of the offer, rendered either between rails (the normal
  // case) or in the header when there are no rails at all.
  const renderNudge = useCallback(
    () => (
      <SaveYourCarCard
        onAdd={() => {
          garageNudge.accept();
          router.push('/add-vehicle');
        }}
        onDismiss={garageNudge.dismiss}
      />
    ),
    [garageNudge, router],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      switch (item.type) {
        case 'nudgeRow':
          return renderNudge();
        case 'sectionHeader':
          // EVERY section's chevron now means the same thing: "show me this
          // section on the map" (product call 2026-08-06 — it used to open the
          // area picker here, which made one chevron behave unlike every other
          // one). near_you has no named area, so it frames the map on the
          // region the feed is already searching. Changing area moved to the
          // search surface, where location belongs.
          if (item.section.id === NEAR_YOU_SECTION_ID) {
            return (
              <FeedSectionHeader
                title={nearYouTitle}
                onSeeAll={() => openMap({ region: searchRegion })}
              />
            );
          }
          return (
            <FeedSectionHeader
              title={item.section.title}
              onSeeAll={
                item.section.area ? () => openMap({ area: item.section.area }) : undefined
              }
            />
          );
        case 'heroCard':
          return (
            <View style={styles.heroCard}>
              <VehicleCard
                post={item.post}
                onPress={() => onPressPost(item.post)}
                topRightAction={<WatchToggle postId={item.post.id} source="feed" />}
              />
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
    [openMap, onPressPost, nearYouTitle, searchRegion, loadMore, loadingMore, renderNudge],
  );

  const areaLabel =
    location?.mode === 'local' ? (location.addressLabel || 'your area') : null;

  const listHeader = (
    <View>
      {/* The location primer STAYS pinned above the feed: it is a correction,
          not an offer — every car below it is from the wrong place until it is
          answered — so it must not sit under the content it invalidates. The
          garage and alert offers ride between rails instead (see `items`). */}
      {showLocationPrimer ? <LocationPrimerCard onSetArea={() => setPickerOpen(true)} /> : null}
      {/* Area insights — the shape of what the cards below show one at a time.
          Deliberately BELOW the location primer and above everything else: it
          is about the area, so it is meaningless until the area is right, and
          the primer is the correction that makes it so.

          Hidden entirely without a local area. The RPC needs a point, and an
          entry that leads to "we need an area first" is a promise the row
          should not have made. */}
      {!showLocationPrimer && location?.mode === 'local' ? (
        <Pressable
          onPress={() => router.push('/area-insights')}
          accessibilityRole="button"
          accessibilityLabel="Thefts near you"
          style={[styles.insightsRow, { backgroundColor: palette.surfaceSubtle }]}
          testID="feed-area-insights"
        >
          <Text style={[styles.insightsLead, { color: palette.textPrimary }]}>Thefts near you</Text>
          <Text style={[styles.insightsHint, { color: palette.textSecondary }]}>
            How many, which cars, and whether they come back
          </Text>
        </Pressable>
      ) : null}
      {/* …except when there are no rails to ride between. */}
      {nudgeInHeader ? renderNudge() : null}
      {display.kind === 'good-news-empty' && location?.mode === 'local' ? (
        <>
          {/* With no page title, a header must appear here too or the
              good-news state loses its change-area control. No server
              section in this state — the near_you title is restated. */}
          <FeedSectionHeader
            title={nearYouTitle}
            onSeeAll={() => setPickerOpen(true)}
            seeAllAccessibilityLabel="Change area"
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
      <View
        style={styles.flex}
        importantForAccessibility={searchOpen ? 'no-hide-descendants' : 'auto'}
      >
      {/* PINNED. Outside the list, above every state, so search never scrolls
          away and is reachable while the feed is still loading or has failed.
          A plain sibling rather than an absolute overlay: the list then simply
          takes the space that is left, with no listContent paddingTop to keep
          in sync with this bar's height. (Same shape as InboxScreen's filter
          chips above its FlashList.) */}
      <FeedTopBar onPressSearch={openSearch} />

      {!location || (status === 'loading' && !refreshing) ? (
        <FeedSkeleton />
      ) : status === 'error' ? (
        // The area control stays in the error state so "change area" is
        // reachable — the failure may be area-specific. (Search is reachable
        // by construction now: the pill is pinned above this branch.)
        <View>
          {location?.mode === 'local' ? (
            <FeedSectionHeader
              title={nearYouTitle}
              onSeeAll={() => setPickerOpen(true)}
              seeAllAccessibilityLabel="Change area"
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
          <MapPillButton visible={mapPillVisible} onPress={() => openMap()} />
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
      </View>

      {searchOpen ? (
        <SearchSheet
          initialCriteria={emptyCriteria()}
          region={searchRegion}
          sourceRect={searchSourceRect}
          onApply={handleApplySearch}
          onClose={closeSearch}
          // Location lives here now that every section chevron means "see this
          // on the map". Close first: the picker is a modal and the sheet is a
          // full-screen overlay, so leaving both up would stack two surfaces.
          areaLabel={areaLabel}
          onChangeArea={() => {
            closeSearch();
            setPickerOpen(true);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xxxl + spacing.xxl, // clear the floating Map pill
  },
  // A quiet row, not a card: it is a doorway to context, and dressing it up
  // would have it competing with the stolen cars underneath — which are the
  // reason anyone opened this tab.
  // Geometry only — this sheet is module-level and has no palette. The three
  // colours are applied inline at the call site from usePalette(), so the row
  // follows whichever theme is in effect rather than one baked at import.
  insightsRow: {
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  insightsLead: typography.cardTitle,
  insightsHint: typography.caption,
  heroCard: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
});
