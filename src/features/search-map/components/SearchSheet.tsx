/**
 * WHAT:  SearchSheet — the full-screen search surface that sits over the map.
 *        Airbnb's mobile-search pattern: a stack of collapsible SECTION CARDS
 *        (Vehicle / Bounty / Distance / When) where exactly one is expanded and
 *        the rest collapse to a title + current-value summary row. One place to
 *        assemble a whole query, with a live "Show N cars" footer that applies
 *        it all at once.
 * WHY:   Rendered as an absolute overlay (NOT an RN Modal — a transparent Modal
 *        flickers and can't host gorhom sheets on Android; see memory), so it
 *        composes cleanly above the map/feed in the same screen. It edits a DRAFT
 *        (useSearchCriteria) seeded from the applied criteria; nothing touches
 *        the map until "Show N cars". `distanceMiles` only frames the bbox the
 *        count/apply use — the geo filter is always the bbox (searchCriteria
 *        never sends distance to the server). The accordion uses Reanimated
 *        LinearTransition so cards reflow smoothly; reduced-motion snaps.
 * MOTION: when opened with a `sourceRect` (the search pill's measured window
 *        rect), the surface MORPHS from that rect out to full-screen — a
 *        measure-and-grow overlay (Reanimated 4; sharedTransitionTag is
 *        experimental/navigation-coupled and unfit here). One `progress` shared
 *        value drives the box (left/top/width/height/radius), an opaque scrim
 *        (the `overlay` token — also dodges the Android transparent-Modal flicker),
 *        a ghost pill label that fades early, and the content that fades in as
 *        the box nears full size; dismiss reverses it. No sourceRect (the map
 *        pill re-search) or reduced-motion → a plain cross-fade.
 * LINKS: src/features/search-map/hooks/useSearchCriteria.ts,
 *        src/features/search-map/hooks/useSearchCount.ts;
 *        src/shared/ui (Button, ChoiceChips, MoneyRangeSlider);
 *        src/features/vehicles (MakeField, ModelField — via the feature index).
 */

/* eslint-disable react-hooks/immutability -- the `progress` Reanimated
   SharedValue is a mutable-by-design box written from open/close handlers; the
   compiler's immutability model doesn't apply to it. The component also opts
   out of the React Compiler ('use no memo' below) for the same reason. */

import { Feather } from '@expo/vector-icons';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  LinearTransition,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MakeField, ModelField } from '@/features/vehicles';
import { formatPounds } from '@/shared/lib/money';
import {
  motion,
  opacity,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import type { GeoRegion } from '@/shared/types';
import { Button, ChoiceChips, MoneyRangeSlider } from '@/shared/ui';

import { useSearchCount } from '../hooks/useSearchCount';
import { useSearchCriteria } from '../hooks/useSearchCriteria';
import { regionAround } from '../lib/regionMath';
import {
  SEARCH_BOUNTY_MAX_PENCE,
  SEARCH_BOUNTY_MIN_PENCE,
  type SearchCriteria,
} from '../lib/searchCriteria';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Bounty grid: £25 steps to £500, then £50 — mirrors the posting bounty step. */
const BOUNTY_SNAP_STEPS = [{ upToPence: 50000, stepPence: 2500 }, { stepPence: 5000 }];

const DISTANCE_OPTIONS = [
  { value: '5', label: '5 mi' },
  { value: '10', label: '10 mi' },
  { value: '25', label: '25 mi' },
  { value: '50', label: '50 mi' },
  { value: 'any', label: 'Any' },
];

// Money through the shared formatter — never a hard-coded '£' string.
const BOUNTY_QUICK_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: '500', label: `${formatPounds(50000)}+` },
  { value: '1000', label: `${formatPounds(100000)}+` },
];

// Thin popular-colour row (Airbnb promotes a few facets to visible chips). The
// values are the canonical swatch names stored in posts.colour.
const COLOUR_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'Black', label: 'Black' },
  { value: 'Grey', label: 'Grey' },
  { value: 'White', label: 'White' },
  { value: 'Silver', label: 'Silver' },
  { value: 'Blue', label: 'Blue' },
  { value: 'Red', label: 'Red' },
];

const RECENCY_OPTIONS = [
  { value: 'any', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

type SectionKey = 'vehicle' | 'bounty' | 'distance' | 'when';

/** Per-section collapsed summaries (right-hand value on a collapsed card). */
function vehicleSummary(c: SearchCriteria): string {
  // Free text lives in the header now — this summarises the make/model/colour
  // facets only.
  const parts = [c.colour, c.make, c.model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Any';
}
function bountySummaryLabel(c: SearchCriteria): string {
  const min = c.bountyMinPence > SEARCH_BOUNTY_MIN_PENCE ? c.bountyMinPence : null;
  const max = c.bountyMaxPence < SEARCH_BOUNTY_MAX_PENCE ? c.bountyMaxPence : null;
  if (min != null && max != null) return `${formatPounds(min)}–${formatPounds(max)}`;
  if (min != null) return `${formatPounds(min)}+`;
  if (max != null) return `Up to ${formatPounds(max)}`;
  return 'Any';
}
function distanceSummaryLabel(c: SearchCriteria): string {
  return c.distanceMiles == null ? 'Any' : `${c.distanceMiles} mi`;
}
function whenSummaryLabel(c: SearchCriteria): string {
  return c.recencyDays == null ? 'Any time' : `Last ${c.recencyDays} days`;
}

/** One collapsible accordion card. Collapsed → a title + summary row; expanded
 *  → an elevated card showing its controls. Reflow animates via the parent
 *  cards' LinearTransition; the body fades in. */
function SearchSection({
  title,
  summary,
  expanded,
  onToggle,
  reduceMotion,
  testID,
  children,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  reduceMotion: boolean;
  testID?: string;
  children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <Animated.View
      style={[styles.card, expanded && styles.cardExpanded]}
      layout={reduceMotion ? undefined : LinearTransition.duration(motion.standard)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? title : `${title}: ${summary}`}
        onPress={onToggle}
        style={styles.cardHeader}
        testID={testID}
      >
        <Text style={[styles.cardTitle, expanded && styles.cardTitleExpanded]}>{title}</Text>
        {expanded ? (
          <View style={styles.headerSpacer} />
        ) : (
          <Text numberOfLines={1} style={styles.cardSummary}>
            {summary}
          </Text>
        )}
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={sizes.iconSm}
          color={palette.textSecondary}
        />
      </Pressable>
      {expanded ? (
        <Animated.View
          style={styles.cardBody}
          entering={reduceMotion ? undefined : FadeIn.duration(motion.fast)}
        >
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** The search pill's on-screen (window) rect, for the expand-from-pill morph. */
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchSheetProps {
  /** Seed the draft from the currently-applied search. */
  initialCriteria: SearchCriteria;
  /** The current searched region — counts + apply frame around it; a chosen
   *  distance reframes around its centre, "Any" keeps this current view. */
  region: GeoRegion;
  /** The pill's measured window rect — when set (and motion is on) the surface
   *  MORPHS out of it; absent → a plain cross-fade. */
  sourceRect?: SourceRect | null;
  /** Apply the assembled search: criteria + the distance-framed region. */
  onApply: (criteria: SearchCriteria, region: GeoRegion) => void;
  /** Dismiss without applying (prior results stay). */
  onClose: () => void;
  /** The feed's current area name, shown on the change-area row. Omit the row
   *  entirely (with onChangeArea) when browsing nationally. */
  areaLabel?: string | null;
  /** Open the area picker. Location lives HERE rather than on a feed section
   *  header, so every section chevron can mean "see this on the map"
   *  (2026-08-06). Presence of this AND areaLabel renders the row. */
  onChangeArea?: () => void;
}

export function SearchSheet({
  initialCriteria,
  region,
  sourceRect,
  onApply,
  onClose,
  areaLabel,
  onChangeArea,
}: SearchSheetProps) {
  // Opt out of the React Compiler: the `progress` shared value is mutated from
  // handlers/effects, which the compiler's immutability model forbids.
  'use no memo';
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const { criteria, patch, setMake, reset } = useSearchCriteria(initialCriteria);
  const reduceMotion = useReducedMotion();
  const { width: screenW, height: screenH } = useWindowDimensions();
  // FULL-SCREEN filter page (Airbnb's mobile search is edge-to-edge, full
  // height). The bar still MORPHS out of the pill rect into this — it just
  // grows all the way to fill the screen.
  const card = { x: 0, y: 0, width: screenW, height: screenH };
  // Morph only when we have a pill rect AND motion is allowed.
  const morph = sourceRect != null && !reduceMotion;
  const progress = useSharedValue(morph ? 0 : 1);
  const closingRef = useRef(false);

  // Open: spring the morph from the pill rect out to full-screen.
  useEffect(() => {
    if (morph) {
      progress.value = withSpring(1, motion.springStandard);
    }
    // Run once on mount — the source rect / motion decision is fixed per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the close latch if a reverse spring is interrupted (so the surface
  // never becomes undismissable); unmount via onClose when it settles cleanly.
  const finishClose = useCallback(
    (finished: boolean) => {
      if (finished) {
        onClose();
      } else {
        closingRef.current = false;
      }
    },
    [onClose],
  );

  // Dismiss: reverse the morph, then unmount (onClose) on settle. Without a
  // morph, close immediately.
  const requestClose = useCallback(() => {
    if (!morph) {
      onClose();
      return;
    }
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    progress.value = withSpring(0, motion.springStandard, (finished) => {
      runOnJS(finishClose)(finished ?? false);
    });
  }, [morph, onClose, progress, finishClose]);

  // Android back dismisses the surface (with the reverse morph).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [requestClose]);

  const boxStyle = useAnimatedStyle(() => {
    const rect = sourceRect ?? card;
    const p = progress.value;
    return {
      left: interpolate(p, [0, 1], [rect.x, card.x]),
      top: interpolate(p, [0, 1], [rect.y, card.y]),
      width: interpolate(p, [0, 1], [rect.width, card.width]),
      height: interpolate(p, [0, 1], [rect.height, card.height]),
      // Pill-round → square as it fills the screen edge-to-edge.
      borderRadius: interpolate(p, [0, 1], [rect.height / 2, 0]),
    };
  });
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6], [0, 1], Extrapolation.CLAMP),
  }));
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.25], [1, 0], Extrapolation.CLAMP),
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.55, 1], [0, 1], Extrapolation.CLAMP),
  }));
  // Accordion: Vehicle (make/model/colour) leads; tapping a card collapses it.
  const [expanded, setExpanded] = useState<SectionKey | null>('vehicle');
  const toggle = useCallback(
    (key: SectionKey) => setExpanded((current) => (current === key ? null : key)),
    [],
  );

  // Distance reframes the bbox the count + apply use, around the current
  // region's centre. "Any" (no distance) keeps the current view — never a
  // surprise teleport to a national frame.
  const framedRegion: GeoRegion =
    criteria.distanceMiles != null ? regionAround(region, criteria.distanceMiles) : region;
  const { count, counting } = useSearchCount(framedRegion, criteria);

  // Stable handler — MoneyRangeSlider re-registers its drag gestures if
  // onChange's identity changes mid-drag (patch is already stable).
  const handleBountyChange = useCallback(
    (range: { minPence: number; maxPence: number }) =>
      patch({ bountyMinPence: range.minPence, bountyMaxPence: range.maxPence }),
    [patch],
  );

  // Map the current bounty range onto a quick-chip value (null = a custom range
  // set on the slider, so no chip is highlighted).
  const bountyChip =
    criteria.bountyMaxPence >= SEARCH_BOUNTY_MAX_PENCE
      ? criteria.bountyMinPence <= SEARCH_BOUNTY_MIN_PENCE
        ? 'any'
        : criteria.bountyMinPence === 50000
          ? '500'
          : criteria.bountyMinPence === 100000
            ? '1000'
            : null
      : null;

  const distanceChip = criteria.distanceMiles == null ? 'any' : String(criteria.distanceMiles);

  const noResults = !counting && count === 0;
  const applyLabel =
    count != null
      ? count === 0
        ? 'No cars match'
        : `Show ${count} ${count === 1 ? 'car' : 'cars'}`
      : counting
        ? 'Searching…'
        : 'Show cars';

  const panel = (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Search
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={spacing.sm}
            onPress={requestClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            testID="search-close"
          >
            <Feather name="x" size={sizes.icon} color={palette.textPrimary} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* WHERE, first and always visible — not an accordion section: it
              navigates away to the picker rather than editing the draft, so
              collapsing it beside the filter cards would misrepresent it. */}
          {areaLabel && onChangeArea ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Change area. Currently ${areaLabel}`}
              onPress={onChangeArea}
              style={({ pressed }) => [styles.areaRow, pressed && styles.areaRowPressed]}
              testID="search-change-area"
            >
              <View style={styles.areaText}>
                <Text style={styles.areaLabel}>Area</Text>
                <Text style={styles.areaValue} numberOfLines={1}>
                  {areaLabel}
                </Text>
              </View>
              <Feather name="chevron-right" size={sizes.iconSm} color={palette.textSecondary} />
            </Pressable>
          ) : null}

          <SearchSection
            title="Vehicle"
            summary={vehicleSummary(criteria)}
            expanded={expanded === 'vehicle'}
            onToggle={() => toggle('vehicle')}
            reduceMotion={reduceMotion}
            testID="section-vehicle"
          >
            <MakeField value={criteria.make} onChange={setMake} />
            {criteria.make ? (
              <ModelField
                make={criteria.make}
                value={criteria.model}
                onChange={(model) => patch({ model })}
              />
            ) : null}

            <Text style={styles.fieldLabel}>Colour</Text>
            <ChoiceChips
              options={COLOUR_OPTIONS}
              value={criteria.colour ?? 'any'}
              onSelect={(value) => patch({ colour: value === 'any' ? null : value })}
            />
          </SearchSection>

          <SearchSection
            title="Bounty"
            summary={bountySummaryLabel(criteria)}
            expanded={expanded === 'bounty'}
            onToggle={() => toggle('bounty')}
            reduceMotion={reduceMotion}
            testID="section-bounty"
          >
            <MoneyRangeSlider
              label="Bounty"
              valuePence={{ minPence: criteria.bountyMinPence, maxPence: criteria.bountyMaxPence }}
              onChange={handleBountyChange}
              minPence={SEARCH_BOUNTY_MIN_PENCE}
              maxPence={SEARCH_BOUNTY_MAX_PENCE}
              snapSteps={BOUNTY_SNAP_STEPS}
              testID="search-bounty"
            />
            <ChoiceChips
              options={BOUNTY_QUICK_OPTIONS}
              value={bountyChip}
              onSelect={(value) =>
                patch({
                  bountyMinPence:
                    value === '500' ? 50000 : value === '1000' ? 100000 : SEARCH_BOUNTY_MIN_PENCE,
                  bountyMaxPence: SEARCH_BOUNTY_MAX_PENCE,
                })
              }
            />
          </SearchSection>

          <SearchSection
            title="Distance"
            summary={distanceSummaryLabel(criteria)}
            expanded={expanded === 'distance'}
            onToggle={() => toggle('distance')}
            reduceMotion={reduceMotion}
            testID="section-distance"
          >
            <ChoiceChips
              options={DISTANCE_OPTIONS}
              value={distanceChip}
              onSelect={(value) => patch({ distanceMiles: value === 'any' ? null : Number(value) })}
            />
          </SearchSection>

          <SearchSection
            title="When"
            summary={whenSummaryLabel(criteria)}
            expanded={expanded === 'when'}
            onToggle={() => toggle('when')}
            reduceMotion={reduceMotion}
            testID="section-when"
          >
            <Text style={styles.fieldLabel}>Last seen</Text>
            <ChoiceChips
              options={RECENCY_OPTIONS}
              value={criteria.recencyDays == null ? 'any' : String(criteria.recencyDays)}
              onSelect={(value) => patch({ recencyDays: value === 'any' ? null : Number(value) })}
            />
          </SearchSection>

          {/* The actions sit right below the last filter (scroll with content),
              not pinned to the bottom. */}
          <View style={styles.footer}>
            {noResults ? (
              <Text style={styles.noResults} accessibilityLiveRegion="polite">
                No cars match — try widening the bounty or distance.
              </Text>
            ) : null}
            <View style={styles.footerRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear all"
                onPress={reset}
                style={({ pressed }) => [styles.clearAll, pressed && styles.pressed]}
                testID="search-clear-all"
              >
                <Text style={styles.clearAllText}>Clear all</Text>
              </Pressable>
              <Button
                label={applyLabel}
                variant="primary"
                fullWidth={false}
                // Spinner whenever a live count is in flight (initial + recount).
                loading={counting}
                disabled={count === 0}
                onPress={() => onApply(criteria, framedRegion)}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
  );

  // No morph (the map pill re-search, or reduced motion): the full-screen page
  // just cross-fades in (it covers the whole screen, so no scrim is needed).
  if (!morph) {
    return (
      <Animated.View
        style={styles.overlay}
        entering={FadeIn.duration(motion.standard).reduceMotion(ReduceMotion.System)}
        accessibilityViewIsModal
      >
        <View
          style={[
            styles.sheetCard,
            { left: card.x, top: card.y, width: card.width, height: card.height },
          ]}
        >
          {panel}
        </View>
      </Animated.View>
    );
  }

  // Morph: a dim scrim (tap to close), a card that grows from the pill rect
  // (with a ghost pill label that fades early) into the contained card, and the
  // content that fades in as it fills.
  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <AnimatedPressable
        style={[styles.scrim, scrimStyle]}
        accessibilityRole="button"
        accessibilityLabel="Close search"
        onPress={requestClose}
      />
      <Animated.View style={[styles.sheetCard, boxStyle]}>
        <Animated.View
          style={[styles.ghost, { height: sourceRect?.height ?? 0 }, ghostStyle]}
          pointerEvents="none"
        >
          <Feather name="search" size={sizes.iconSm} color={palette.textSecondary} />
          <Text style={styles.ghostText}>Search make or model</Text>
        </Animated.View>
        <Animated.View
          style={[styles.contentLayer, { width: card.width, height: card.height }, contentStyle]}
        >
          {panel}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // Transparent overlay — the scrim provides the dim, the card the surface.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Above the map/feed + their floating controls.
    zIndex: 20,
  },
  // The panel interior — background so the inner surface accordion cards pop.
  safe: {
    flex: 1,
    backgroundColor: c.background,
  },
  // Full-screen dim behind the card; tapping it closes the surface. `overlay`,
  // not `mediaScrim`: what it dims is the PAGE (map or feed), so it deepens on
  // dark — a 0.45 black over an already-dark map separates nothing.
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.overlay,
  },
  // The sheet: starts as the pill (surface), morphs to the full screen.
  // Position + size + radius come from boxStyle (morph) or inline (fade).
  sheetCard: {
    position: 'absolute',
    backgroundColor: c.surface,
    overflow: 'hidden',
  },
  // The pill's icon+label, shown at rest and faded out as the card grows.
  ghost: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ghostText: {
    ...typography.label,
    color: c.textSecondary,
  },
  // The real panel, laid out at the card's fixed size (so it never reflows as
  // the card resizes) and faded in as the card nears full size.
  contentLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.xl,
    paddingRight: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
  },
  close: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  // --- Where (navigates out; deliberately NOT an accordion card) ---
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  areaRowPressed: {
    backgroundColor: c.surfaceSubtle,
  },
  areaText: {
    flex: 1,
  },
  areaLabel: {
    ...typography.label,
    color: c.textSecondary,
  },
  areaValue: {
    ...typography.body,
    color: c.textPrimary,
  },
  // --- Accordion cards ---
  card: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    overflow: 'hidden',
  },
  cardExpanded: {
    borderColor: 'transparent',
    ...shadows.soft,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  cardTitle: {
    ...typography.label,
    color: c.textSecondary,
  },
  cardTitleExpanded: {
    ...typography.cardTitle,
    color: c.textPrimary,
    flex: 1,
  },
  headerSpacer: {
    flex: 1,
  },
  cardSummary: {
    ...typography.body,
    color: c.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  cardBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  fieldLabel: {
    ...typography.label,
    color: c.textSecondary,
  },
  // --- Footer (inline, below the last filter card) ---
  footer: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noResults: {
    ...typography.caption,
    color: c.textSecondary,
  },
  clearAll: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  clearAllText: {
    ...typography.label,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
