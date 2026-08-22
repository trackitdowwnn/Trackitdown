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
 *        the map until "Show N cars". `distanceMiles` both frames the bbox AND
 *        travels to the server as a radius around the map centre (changed
 *        2026-08-10 — it used to only frame the camera and filter nothing).
 *        The accordion uses Reanimated LinearTransition so cards reflow
 *        smoothly; reduced-motion snaps. Every chip row scrolls horizontally
 *        rather than wrapping, so a section is always one chip tall and the
 *        sheet's height stops jumping as filters are chosen; the rows pass
 *        `bleed` so they reach the card's edge instead of stacking its padding
 *        on top of the scroller's own gutter.
 * MOTION: when opened with a `sourceRect` (the search pill's measured window
 *        rect), the surface MORPHS from that rect out to full-screen — a
 *        measure-and-grow overlay (Reanimated 4; sharedTransitionTag is
 *        experimental/navigation-coupled and unfit here). One `progress` shared
 *        value drives the box (left/top/width/height/radius), an opaque scrim
 *        (the `overlay` token — also dodges the Android transparent-Modal flicker),
 *        a ghost pill label that fades early, and the content that fades in as
 *        the box nears full size; dismiss reverses it. BOTH call sites pass a
 *        rect, so both animate — the map pill used to omit it and therefore
 *        closed with no animation whatever (2026-08-10). Driven by easeOut at
 *        motion.standard, the same curve as BottomSheet/MapListSheet: the
 *        earlier springStandard was underdamped and overshot, which the box's
 *        then-unclamped interpolations turned into visible wobble. Reduced
 *        motion keeps this path and collapses the duration to zero.
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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BODY_TYPE_OPTIONS,
  BODY_TYPE_UNKNOWN,
  CAR_COLOURS,
  MakeField,
  ModelField,
} from '@/features/vehicles';
import { formatPounds } from '@/shared/lib/money';
import { easeOut } from '@/shared/theme/motionEasing';
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
import {
  Button,
  ChoiceChips,
  ChoiceChipsMulti,
  MoneyRangeSlider,
  RadiusSlider,
} from '@/shared/ui';

import { useSearchCount } from '../hooks/useSearchCount';
import { useSearchCriteria } from '../hooks/useSearchCriteria';
import { regionAround } from '../lib/regionMath';
import {
  SEARCH_BOUNTY_MAX_PENCE,
  SEARCH_BOUNTY_MIN_PENCE,
  distanceLabel,
  seenRangeSummary,
  type SearchCriteria,
} from '../lib/searchCriteria';
import { SeenRangeFields } from './SeenRangeFields';
import { YearRangeFields } from './YearRangeFields';
// Shared with the posting slider, so the amounts a searcher can ask for are
// exactly the amounts an owner can offer. A local copy drifted the moment the
// floor moved: this listed £25 steps from £50, leaving the whole £10–£49 band
// unreachable on a filter whose lowest stop is supposed to mean "any".
import { BOUNTY_SNAP_STEPS } from '@/features/vehicles/post/lib/bountyBounds';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The Distance section's one-tap "clear the radius" row. A slider has no null,
 *  so "Any" needs its own control — ChoiceChips' own docstring sanctions
 *  role='button' chips as one-tap actions, and this mirrors the Bounty section,
 *  which already pairs a slider with a quick-chip row. */
const DISTANCE_ANY_OPTION = [{ value: 'any', label: 'Any distance' }];

/** Where the slider sits when the user opens Distance with no radius set. Not
 *  applied until they touch it — `distanceMiles` stays null (= no filter) until
 *  then, so merely expanding the section never narrows the results. */
const RADIUS_DEFAULT_MILES = 10;

// Money through the shared formatter — never a hard-coded '£' string.
const BOUNTY_QUICK_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: '500', label: `${formatPounds(50000)}+` },
  { value: '1000', label: `${formatPounds(100000)}+` },
];

// The FULL colour vocabulary, from the same source the posting wizard writes
// and the alert wizard filters on — previously this was a hand-picked six,
// so a search could not reach a Green, Gold or Bronze car at all.
//
// The two escape values (Multicolour/wrapped, Other) are INCLUDED, which is the
// opposite call to body type below: a post whose colour is "Other" is otherwise
// unreachable, and filtering on it finds cars whose colour is genuinely
// unusual. Filtering on a body type of "Not sure" would only find owners who
// shrugged, which is not a body type. alertSteps.tsx already encodes that same
// asymmetry.
//
// No "Any" chip: in a multi-select, "any" IS the empty selection, and an "Any"
// entry inside a checkbox group is a role mismatch. The collapsed section
// summary says "Any" instead.
// ⚠️ FUNCTIONS, NOT MODULE-SCOPE CONSTANTS — and they must stay that way.
//
// There is an import CYCLE through these barrels:
//   @/features/vehicles → hooks/useSimilarPosts (imports fetchHomeFeed)
//   → @/features/search-map → SearchSheet → @/features/vehicles
// so when this module's body runs, the vehicles barrel is still initialising
// and CAR_COLOURS / BODY_TYPE_OPTIONS are `undefined`. Evaluating them up here
// crashes the WHOLE APP at startup with "Cannot read property 'CAR_COLOURS' of
// undefined" — every route fails to export, not just this screen.
//
// Called from render instead, by which point the cycle has resolved. That is
// also why the pre-existing MakeField/ModelField imports were always safe:
// they're only touched inside the component.
//
// Jest cannot catch a regression here — SearchSheet.test.tsx mocks
// '@/features/vehicles', which breaks the cycle and makes the module-scope
// version pass. Only a real bundle shows it.
const colourOptions = () =>
  CAR_COLOURS.map((colour) => ({
    value: colour.name,
    label: colour.name,
    // The real hex, so the picker SHOWS the colour rather than only naming it —
    // matching ColourField in the posting flow. The name stays regardless:
    // colour is never the sole signal.
    swatch: colour.hex,
  }));

const bodyTypeOptions = () =>
  BODY_TYPE_OPTIONS.filter((option) => option.value !== BODY_TYPE_UNKNOWN).map((option) => ({
    value: option.value,
    label: option.label,
  }));

// 3 days added to match the alert wizard's finer grid — "this week" is a
// coarse answer when a car was taken last night.
const RECENCY_OPTIONS = [
  { value: 'any', label: 'Any time' },
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

type SectionKey = 'vehicle' | 'bounty' | 'distance' | 'when';

/** Per-section collapsed summaries (right-hand value on a collapsed card). */
/** 1–2 values verbatim, 3+ collapsed — a collapsed card shows ONE line. */
function facetSummary(values: string[], noun: string): string | null {
  if (values.length === 0) return null;
  if (values.length <= 2) return values.join(', ');
  return `${values.length} ${noun}`;
}
function vehicleSummary(c: SearchCriteria): string {
  // Free text lives in the header — this summarises the facets only.
  const years =
    c.yearFrom !== null && c.yearTo !== null
      ? c.yearFrom === c.yearTo
        ? `${c.yearFrom}`
        : `${c.yearFrom}–${c.yearTo}`
      : c.yearFrom !== null
        ? `${c.yearFrom}+`
        : c.yearTo !== null
          ? `up to ${c.yearTo}`
          : null;
  const parts = [
    facetSummary(c.colours, 'colours'),
    c.make,
    c.model,
    facetSummary(c.bodyTypes, 'body types'),
    years,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Any';
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
  // The range wins when set — setWhen guarantees the two are never both set,
  // so this ordering is a readability choice, not a tie-break.
  const range = seenRangeSummary(c);
  if (range) {
    return range;
  }
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
  const { criteria, patch, setMake, setWhen, reset } = useSearchCriteria(initialCriteria);
  const reduceMotion = useReducedMotion();
  const { width: screenW, height: screenH } = useWindowDimensions();
  // FULL-SCREEN filter page (Airbnb's mobile search is edge-to-edge, full
  // height). The bar still MORPHS out of the pill rect into this — it just
  // grows all the way to fill the screen.
  const card = { x: 0, y: 0, width: screenW, height: screenH };
  // Morph whenever we have a pill rect to morph FROM. Reduced motion collapses
  // the DURATION to zero rather than taking a different branch — the old
  // `&& !reduceMotion` sent those users down the no-morph path, which is the
  // one that closes with no animation at all (see requestClose). Same code
  // path, same guarantees, just instant (matches Toast.tsx / AppTabBar.tsx).
  const morph = sourceRect != null;
  const progress = useSharedValue(morph ? 0 : 1);
  const closingRef = useRef(false);

  // TIMING, not spring. springStandard is dampingRatio 0.85 — underdamped, so
  // it overshoots, and boxStyle's geometry then interpolates PAST the pill rect
  // (that was the "clunky" wobble). Every other sheet in the app — BottomSheet,
  // MapListSheet — runs easeOut at motion.standard, and MapListSheet matches
  // curves deliberately so surfaces "read as one handoff". This puts the one
  // bespoke sheet back on that vocabulary and removes overshoot as a class.
  // A NUMBER, not a config object: requestClose depends on it, and a fresh
  // object literal each render would re-subscribe the BackHandler every render.
  const morphDuration = reduceMotion ? motion.instant : motion.standard;

  // Open: grow the morph from the pill rect out to full-screen.
  useEffect(() => {
    if (morph) {
      progress.value = withTiming(1, { duration: morphDuration, easing: easeOut });
    }
    // Run once on mount — the source rect / motion decision is fixed per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount when the reverse morph settles — INCLUDING when it was interrupted.
  // `finished` is false if another animation took the value over mid-flight;
  // treating that as "stay open" left the surface wedged at partial progress,
  // dismissable only by asking again. The user asked to close; a half-open
  // sheet is never the right answer, so close either way.
  const finishClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Dismiss: reverse the morph, then unmount (onClose) on settle. Without a
  // source rect there is nothing to morph back into, so close immediately.
  const requestClose = useCallback(() => {
    if (!morph) {
      onClose();
      return;
    }
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    progress.value = withTiming(0, { duration: morphDuration, easing: easeOut }, () => {
      runOnJS(finishClose)();
    });
  }, [morph, onClose, progress, finishClose, morphDuration]);

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
    // CLAMP on every one, like the three styles below. Without it the geometry
    // extrapolates linearly outside [0,1] — a box narrower than the pill and
    // positioned off its rect — which is exactly what an overshooting driver
    // feeds it. The timing curve above no longer overshoots, but geometry that
    // only stays sane while its driver behaves is a trap for the next edit.
    return {
      left: interpolate(p, [0, 1], [rect.x, card.x], Extrapolation.CLAMP),
      top: interpolate(p, [0, 1], [rect.y, card.y], Extrapolation.CLAMP),
      width: interpolate(p, [0, 1], [rect.width, card.width], Extrapolation.CLAMP),
      height: interpolate(p, [0, 1], [rect.height, card.height], Extrapolation.CLAMP),
      // Pill-round → square as it fills the screen edge-to-edge.
      borderRadius: interpolate(p, [0, 1], [rect.height / 2, 0], Extrapolation.CLAMP),
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

  // Stable for the same reason as handleBountyChange — RadiusSlider
  // re-registers its drag gesture if this identity changes mid-drag.
  const handleDistanceChange = useCallback(
    (miles: number) => patch({ distanceMiles: miles }),
    [patch],
  );

  // Built at RENDER, never at module scope — see the note on these functions.
  const colours = useMemo(() => colourOptions(), []);
  const bodyTypes = useMemo(() => bodyTypeOptions(), []);

  // NO preset is active while a date range is set — they are alternatives, and
  // setWhen guarantees only one is ever populated, so this cannot lie. null is
  // ChoiceChips' "nothing selected".
  const whenChip =
    criteria.seenFrom !== null || criteria.seenTo !== null
      ? null
      : criteria.recencyDays == null
        ? 'any'
        : String(criteria.recencyDays);

  const handleWhenChip = useCallback(
    (value: string) => {
      // "Any time" is also the only way OUT of a date range: DateTimeField's
      // onChange is non-nullable and has no clear affordance, so this chip is
      // the escape hatch. setWhen clears both dates on the way through.
      setWhen({ recencyDays: value === 'any' ? null : Number(value) });
    },
    [setWhen],
  );

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
          {/* No free-text field here (removed 2026-08-10, owner's call). The
              make/model PICKERS in the Vehicle card are the precise way to ask
              the same question, so a text box beside them was a second, fuzzier
              route to the same answer. `criteria.text` stays in the model and
              the RPC still supports it — nothing on this surface writes it. */}

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
            <ChoiceChipsMulti
              options={colours}
              value={criteria.colours}
              onChange={(next) => patch({ colours: next })}
              scrollable
              bleed={spacing.lg}
              testID="search-colours"
            />

            <Text style={styles.fieldLabel}>Body type</Text>
            <ChoiceChipsMulti
              options={bodyTypes}
              value={criteria.bodyTypes}
              onChange={(next) => patch({ bodyTypes: next })}
              scrollable
              bleed={spacing.lg}
              testID="search-body-types"
            />

            <Text style={styles.fieldLabel}>Year</Text>
            <YearRangeFields
              from={criteria.yearFrom}
              to={criteria.yearTo}
              onChange={(years) => patch(years)}
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
              scrollable
              bleed={spacing.lg}
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
            <RadiusSlider
              label="Distance"
              valueMiles={criteria.distanceMiles ?? RADIUS_DEFAULT_MILES}
              onChangeMiles={handleDistanceChange}
              testID="search-distance"
            />
            {/* Honest about what the radius is measured FROM: with no device
                fix the origin is the map centre, and the copy must not claim a
                proximity to the user the app cannot know. */}
            <Text style={styles.fieldHint}>
              {criteria.distanceMiles == null
                ? 'Showing cars anywhere in view.'
                : `Only cars ${distanceLabel(criteria.distanceMiles)}.`}
            </Text>
            <ChoiceChips
              options={DISTANCE_ANY_OPTION}
              value={criteria.distanceMiles == null ? 'any' : null}
              role="button"
              onSelect={() => patch({ distanceMiles: null })}
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
              scrollable
              bleed={spacing.lg}
              value={whenChip}
              onSelect={handleWhenChip}
            />
            {/* ALWAYS visible (2026-08-10, owner's call) — no "Custom range"
                chip to discover first. Picking a date clears the preset above;
                "Any time" clears the dates. Both directions run through
                setWhen, which is what stops the two ever being set at once. */}
            <Text style={styles.fieldLabel}>Or pick exact dates</Text>
            <SeenRangeFields
              from={criteria.seenFrom}
              to={criteria.seenTo}
              onChange={setWhen}
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
  // Says what the radius is measured FROM — quieter than a field label, since
  // it explains the control above rather than naming the next one.
  fieldHint: {
    ...typography.caption,
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
