/**
 * WHAT:  MapListSheet — the persistent list-over-the-map: a NON-modal
 *        gorhom sheet riding at peek / half / full snap points, its handle
 *        reading "N cars in this area", its body the full VehicleCard list.
 * WHY:   The reference pattern: the list is not a separate screen, it's a
 *        layer of the map. The shared BottomSheet is deliberately NOT used
 *        — that primitive is a dismissable modal with a scrim; this sheet
 *        is permanent chrome (never dismissable, no scrim, map stays
 *        interactive behind it at peek). The body fills with the warm
 *        `background` token (not `surface`) on purpose — the borderless feed
 *        VehicleCards are designed to sit on it (feed-surface exception).
 * LINKS: src/shared/ui/BottomSheet.tsx (the modal sibling, and why not);
 *        docs/DESIGN_SYSTEM.md (feed-surface exception, radii, grabber).
 */

import BottomSheet, {
  BottomSheetFlatList,
  type BottomSheetFlatListMethods,
  useBottomSheetTimingConfigs,
} from '@gorhom/bottom-sheet';
import { memo, useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { WatchToggle } from '@/features/watchlist';
import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { EmptyState, ErrorState, SkeletonVehicleCard, VehicleCard } from '@/shared/ui';

import type { MapPost } from '../types';

/** Peek height as a fraction of the screen: the handle, the count, and the top
 *  band of the first card. The card edge is deliberate — the reference shows
 *  title only at its low snap, but our header chrome is ~64dp against its
 *  ~128dp, and 64dp of empty padding to hide a card is a worse trade than a
 *  sliver that says "there is a list here". Entry moves off peek anyway. */
/** Exported because the map insets its camera by the sheet's height — results
 *  framed under the sheet may as well not exist — and now ZOOMS with it, so
 *  the screen has to turn a snap index into a fraction of the screen. */
export const MAP_SHEET_SNAP_PERCENTS = [15, 48, 88] as const;
export const MAP_SHEET_PEEK_PERCENT = MAP_SHEET_SNAP_PERCENTS[0];

/**
 * How far the sheet has risen ABOVE peek, as a fraction of the screen — the
 * camera inset the sheet-driven ZOOM uses. Zero at peek.
 *
 * NOT the same number as how much the sheet OCCLUDES (that is the screen's
 * insetsForSheet, and it is 15% at peek): framing and zooming want different
 * insets. Framing must dodge the sheet or it centres results behind it. Zooming
 * measured off the reference does not: docs/design-refs/map/ holds the same map
 * at two snap positions, and the camera scale between them is 0.59 where exact
 * ground-preservation would give 0.50. Solving for what IS preserved puts the
 * bottom edge ~14.6% of the screen below the sheet's top — its peek height. So
 * the reference frames the whole map at peek and insets only by the excess.
 */
export function sheetZoomFraction(index: number): number {
  const percent = MAP_SHEET_SNAP_PERCENTS[index] ?? MAP_SHEET_PEEK_PERCENT;
  return Math.max(0, percent - MAP_SHEET_PEEK_PERCENT) / 100;
}
/** Peek shows the handle + label; half is browsing; full is list mode. */
const SNAP_POINTS = MAP_SHEET_SNAP_PERCENTS.map((percent) => `${percent}%`);
/** Skeleton rows shown while a search runs (no spinners on the list). */
const SKELETON_ROWS = [0, 1, 2];
/** The beat between the first results landing and the sheet rising to half.
 *  Long enough for the screen's fit-to-results framing to commit first, so the
 *  rise zooms out from the framed camera instead of racing it. */
const AUTO_EXPAND_DELAY_MS = motion.slow;

export interface MapListSheetProps {
  total: number;
  posts: MapPost[];
  status: 'loading' | 'ready' | 'error';
  /** An auto re-search is in flight while results stay on screen. THIS handle
   *  is the map's only "searching" indicator — it can be, because a search
   *  only runs when no card is selected and the sheet only hides when one is,
   *  so it is visible exactly whenever a search can be running. */
  searching?: boolean;
  /** Bumped once per landed search. A PRIMITIVE on purpose: the list resets
   *  its scroll on it, and keying that off the posts array would also fire
   *  whenever the sort anchor moved. */
  searchId?: number;
  /** True while a peek card is up: the sheet slides away so the card owns
   *  the bottom of the screen, and returns to peek when the card dismisses. */
  hidden?: boolean;
  /**
   * The first search has settled (either way) — rise from peek to the half
   * snap by itself, ONCE, a beat later.
   *
   * Gated on the search rather than on mount so the sheet opens onto cars
   * instead of onto skeletons, and the beat lets the screen's fit-to-results
   * framing commit first: the rise then zooms out FROM the framed camera
   * rather than racing it.
   */
  expandOnEntry?: boolean;
  /**
   * The snap index this sheet is heading FOR, reported as the move begins.
   *
   * onAnimate, not onChange: the map zooms to match, and onChange lands after
   * the sheet has already settled (~250ms), which would read as two separate
   * motions instead of one gesture.
   */
  onSnapChange?: (index: number) => void;
  onRetry: () => void;
  onPressPost: (post: MapPost) => void;
}

export const MapListSheet = memo(function MapListSheet({
  total,
  posts,
  status,
  searching = false,
  searchId = 0,
  hidden = false,
  expandOnEntry = false,
  onSnapChange,
  onRetry,
  onPressPost,
}: MapListSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const snapPoints = useMemo(() => SNAP_POINTS, []);
  const sheetRef = useRef<BottomSheet>(null);
  const reduceMotion = useReducedMotion();
  // Match the sheet's slide to the design clock (250ms ease-out) so it and
  // the peek card's spring read as one handoff, not two different curves.
  const animationConfigs = useBottomSheetTimingConfigs({
    duration: reduceMotion ? 0 : motion.standard,
    easing: easeOut,
  });

  // Hide/show imperatively via the ref (NOT the `index` prop). gorhom's
  // `index` IS reactive, but with enablePanDownToClose={false} toggling it
  // to -1 does not close a non-dismissable sheet — observed on-device, the
  // sheet stayed at peek. close() forces the off-screen state regardless;
  // snapToIndex(0) brings it home to peek when the card dismisses.
  useEffect(() => {
    if (hidden) {
      sheetRef.current?.close();
    } else {
      sheetRef.current?.snapToIndex(0);
    }
  }, [hidden]);

  // Rise to half on entry, once. Refs not state: this is a one-shot piece of
  // choreography and nothing renders differently for it.
  const autoExpandedRef = useRef(false);
  const userMovedRef = useRef(false);
  useEffect(() => {
    if (autoExpandedRef.current) {
      return;
    }
    if (hidden) {
      // A peek card is up, which means they tapped a pin — they have chosen
      // what to look at. Cancel for good rather than merely waiting: this
      // effect re-runs when the card dismisses, and rising to half at THAT
      // moment would be the app taking the wheel back long after entry.
      userMovedRef.current = true;
      return;
    }
    if (!expandOnEntry || userMovedRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      // Someone who has already dragged the sheet has said where they want it;
      // yanking it out from under them is worse than not opening at all.
      if (userMovedRef.current) {
        return;
      }
      // Set BEFORE the call so our own onAnimate isn't mistaken for a drag.
      autoExpandedRef.current = true;
      sheetRef.current?.snapToIndex(1);
    }, AUTO_EXPAND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [expandOnEntry, hidden]);

  // A landed search means a DIFFERENT set of cars. The list keeps its scroll
  // offset across a data swap, so without this the user is left looking at
  // row 12 of a list they have never seen.
  const listRef = useRef<BottomSheetFlatListMethods>(null);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [searchId]);

  const handleLabel =
    searching || status === 'loading'
      ? 'Searching this area…'
      : status === 'ready'
        ? `${total} ${total === 1 ? 'car' : 'cars'} in this area`
        : 'Cars in this area'; // neutral — the ErrorState below owns the message

  // Mirrored so the announcement below can read the CURRENT label without
  // depending on it — depending on the string would re-announce on every
  // status flicker rather than once per landed search. Declared first so it
  // has already run by the time that effect fires in the same commit.
  const handleLabelRef = useRef(handleLabel);
  useEffect(() => {
    handleLabelRef.current = handleLabel;
  }, [handleLabel]);

  // iOS gets NOTHING from accessibilityLiveRegion — it is an Android-only RN
  // prop. Without this, a VoiceOver user on iOS has a search land, the list
  // swap underneath them, and no announcement at all: the label below makes
  // the case for why that signal is the map's only one, then delivers it on
  // one platform only. `searchId` bumps once per LANDED search, so this is the
  // same cadence Android gets, not one announcement per render. Skipped at 0 —
  // that is the entry load, which the screen reader is already reading.
  useEffect(() => {
    if (Platform.OS !== 'ios' || searchId === 0) {
      return;
    }
    AccessibilityInfo.announceForAccessibility(handleLabelRef.current);
  }, [searchId]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      animationConfigs={animationConfigs}
      // Pan-down stays disabled for the USER — this is permanent chrome
      // that only the peek card may displace (see the effect above).
      enablePanDownToClose={false}
      // Reported as the move STARTS so the map's zoom rides the same curve.
      // toIndex is -1 when the sheet is being closed for a peek card — the
      // screen already knows about that and drives the camera from the card,
      // so don't report it as a snap.
      onAnimate={(_from, toIndex) => {
        if (toIndex < 0) {
          return;
        }
        // A move to a TALLER snap that we did not make is the user dragging —
        // it cancels the pending auto-expand. The mount's own animate-to-peek
        // reports index 0, which is why this is not just `!autoExpandedRef`.
        if (toIndex !== 0 && !autoExpandedRef.current) {
          userMovedRef.current = true;
        }
        onSnapChange?.(toIndex);
      }}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.grabber}
      accessibilityLabel="Cars in this area"
      // While hidden (a peek card is up) the sheet is off-screen but still
      // mounted; drop it from the a11y tree so screen-reader focus can't
      // land on the invisible list/header behind the card.
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <View style={styles.handleRow}>
        {/* LIVE: with the "Search this area" button gone, this label is the
            whole story of an auto-search — it changes to "Searching…" and back
            to a new count while the list silently swaps underneath. Without
            the live region a screen-reader user gets no signal at all that
            the results changed. */}
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={styles.handleLabel}
        >
          {handleLabel}
        </Text>
      </View>
      {status === 'error' ? (
        <ErrorState body="We couldn't search this area." onRetry={onRetry} />
      ) : status === 'loading' && posts.length === 0 ? (
        // Skeleton rows, never a spinner (DESIGN_SYSTEM loading states).
        <View style={styles.listContent}>
          {SKELETON_ROWS.map((row) => (
            <View key={row} style={styles.card}>
              <SkeletonVehicleCard />
            </View>
          ))}
        </View>
      ) : (
        <BottomSheetFlatList
          ref={listRef}
          data={posts}
          keyExtractor={(post: MapPost) => post.id}
          renderItem={({ item }: { item: MapPost }) => (
            <View style={styles.card}>
              <VehicleCard
                post={item}
                onPress={() => onPressPost(item)}
                topRightAction={<WatchToggle postId={item.id} source="map" />}
              />
            </View>
          )}
          ListEmptyComponent={
            status === 'ready' ? (
              <EmptyState
                title="No stolen cars in this area"
                body="That's a good thing. Pan the map, or check back later."
              />
            ) : null
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </BottomSheet>
  );
});

const makeStyles = (c: Palette) => StyleSheet.create({
  sheetBackground: {
    backgroundColor: c.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  grabber: {
    // borderStrong (not the shared sheet's `border`) for legibility over map
    // tiles; radii.sm rounds the ends to match the shared BottomSheet.
    backgroundColor: c.borderStrong,
    width: sizes.grabberWidth,
    height: sizes.grabberHeight,
    borderRadius: radii.sm,
  },
  handleRow: {
    alignItems: 'center',
    // Matches the list's own 16pt gutter. Without it, "Searching this area…"
    // at 18pt bold and 200% text scale wraps with its glyphs on both bezels.
    // Deliberately NOT numberOfLines={1}: truncating a live-region header is
    // worse than letting the peek grow.
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  // A TITLE, not a caption. At the peek snap this line is the entire sheet, and
  // the reference gives that slot a confident bold count ("Over 1,000 homes")
  // rather than the quiet grey label this used to be. It also carries the
  // searching and error states — the reference puts its loading state in the
  // same slot, so one style serves all three.
  handleLabel: {
    ...typography.heading,
    color: c.textPrimary,
  },
  card: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
});
