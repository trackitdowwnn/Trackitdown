/**
 * WHAT:  The onboarding hero — a small piece of the app's own map, with bounty
 *        pins and a sighting trail, changing state as the slides step: cars
 *        scattered nearby, one posted, the alert reaching the others and the
 *        reports coming back, that one home again. Built from components and
 *        tokens; no image assets.
 * WHY:   Onboarding's job is to say what this app IS, and the answer is a map
 *        of stolen cars near you. Two earlier heroes were removed for being
 *        decoration beside the words — a placeholder emoji per slide, then a
 *        registration plate that "did not earn the room" (features/auth/
 *        README.md). This one is the SUBJECT of the product, and it explains
 *        without a sentence.
 *
 *        ⚠️ IT IS OUR MAP, NOT A PICTURE OF ONE, and the first draft got that
 *        wrong. It drew the field as rounded grey rectangles and the cars as
 *        plain dots. Rounded grey blocks at the top of a screen are this app's
 *        LOADING SKELETON (DESIGN_SYSTEM: "skeleton placeholders in
 *        surfaceSubtle"), so the hero read as a screen that had not finished
 *        loading — the same "unfinished" charge that killed the emoji. And a
 *        price-less marker is the one thing the real map refuses to ship
 *        ("never ship a price-less map marker… it reads as a GROUP", learned
 *        four separate times). So the pins here are the real bounty pill —
 *        MapPins' anatomy and tokens, one size down — which also quietly
 *        teaches the bounty that slide four pays off.
 *
 *        ⚠️ IT DOES NOT REMOUNT BETWEEN SLIDES. The screen keeps it outside the
 *        keyed stage, so the words step over a map that persists and morphs.
 *        OnboardingSlide's own header rejects per-slide artwork because "a
 *        thing sliding while its own contents did something else" reads wrong —
 *        this is the shape that answers it. The map is continuity; the words
 *        are the step.
 *
 *        ⚠️ ABSTRACT, NOT CARTOGRAPHIC. A real map means a real place, and on
 *        first launch we have neither location permission nor any business
 *        asking for one. The roads are a few curves that stop short of the
 *        edges; nothing here claims to be anywhere. (Straight lines running
 *        edge to edge read as a grid, which is a diagram, not a place.)
 *
 *        PINS AND RINGS ARE PERCENTAGES; the field is a viewBox STRETCHED to
 *        fit, and the fade has no viewBox at all. The first draft shared one
 *        `slice` viewBox between all three, so on a 16:9 handset the fade was
 *        clipped with a seventh of the map still showing under the headline.
 *        Nothing crops now: percentages cannot, `none` stretches instead, and a
 *        vertical gradient has no aspect to preserve.
 *
 *        NO springBouncy on the recovery stage. It is reserved for
 *        success/reward, and this is still someone reading about their car
 *        being stolen — the same instinct that once put a 🎉 on that slide.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx (owner, holds the stage);
 *        src/features/search-map/components/MapPins.tsx (the pill this copies);
 *        src/features/auth/components/OnboardingBackdrop.tsx (the wash below);
 *        docs/decisions/ADR-0006-monochrome-theme.md.
 */

import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { formatPounds } from '@/shared/lib/money';
import { NO_BOUNTY_LABEL } from '@/shared/ui/BountyTag';
import {
  mapPinFontScaleCap,
  motion,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

/**
 * The four states, in story order. Each ADDS to the one before, except the
 * alert rings, which are a moment rather than a state and retract once the car
 * is home.
 */
export type OnboardingMapStage = 'scatter' | 'posted' | 'alerted' | 'recovered';

const STAGE_ORDER: OnboardingMapStage[] = ['scatter', 'posted', 'alerted', 'recovered'];

/** The field's own coordinate space — geometry, not design tokens. Sized to the
 *  band it is stretched into so the curves keep roughly the shape they were
 *  drawn with. */
const FIELD_W = 360;
const FIELD_H = 440;

/** A point on the field, as percentages of the band — the space bounty pins and
 *  trail dots share, and the only one in this file that cannot be distorted by
 *  the stretch. */
type FieldPoint = { left: `${number}%`; top: `${number}%` };

/** A pin: a point, plus what it is worth. `null` is a listing with no reward. */
type BountyPoint = FieldPoint & { pence: number | null };

/**
 * Cars nearby. Placed to look incidental rather than gridded, and spread so the
 * widest alert ring encloses all of them — the first draft's rings reached one
 * pin out of six, which left the picture unable to do the job the deleted
 * "people nearby get alerted" slide used to do.
 *
 * The amounts are illustrative and go through formatPounds like every other sum
 * in the app; a literal "£250" here would be the one price string in the
 * codebase nobody could re-point.
 */
const NEIGHBOURS: BountyPoint[] = [
  { left: '18%', top: '24%', pence: 5000 },
  { left: '76%', top: '30%', pence: 120000 },
  // ⚠️ A FREE LISTING. ADR-0014 made the reward optional, `NO_BOUNTY_LABEL` is
  // what the real map prints for one, and a hero showing only priced cars
  // silently contradicts the product on the first screen.
  { left: '70%', top: '56%', pence: null },
  // ⚠️ THREE NEIGHBOURS, NOT FOUR (2026-09-05). A £10 pin sat at 26%/52% until
  // the owner's polish pass: four amounts on the opening slide read as a PRICE
  // LIST before a price means anything here, under a headline whose whole
  // message is cars-not-money. The spread argument survives without it — the
  // low anchor is now "No reward" (lower than any amount) plus £50, so the
  // "four amounts all in the top decile" failure is not recreated. Its removal
  // also frees the exact corridor the lengthened sighting trail crosses.
];

/**
 * The owner's car. Centre-ish and slightly high, so the rings have room.
 *
 * ⚠️ NOT 25000. That is `DEFAULT_BOUNTY_PENCE`, whose own comment says it is
 * "NOT a recommendation, and nothing may present it as one" — and putting it on
 * the owner’s car on the first screen, hours before the slider offers the same
 * number, is the most effective way to present it as one. The spread across
 * the four pins is deliberate too: "No reward" to £1,200 against a real
 * £10–£5,000 range, where the first draft had every amount in the top decile.
 */
const FOCAL: BountyPoint = { left: '50%', top: '42%', pence: 18000 };

/** Ring diameters as a share of the WIDTH, with aspectRatio 1 so they stay
 *  circles rather than ellipses. 84% clears the furthest neighbour. */
const RING_INNER = '52%';
const RING_OUTER = '84%';
const HOME_RING = '28%';
/** Half of each ring, to pull its centre onto the focal pin’s row. Percentage
 *  margins resolve against the parent’s WIDTH, exactly as the widths above do,
 *  so these are exact rather than approximate. */
const RING_INNER_PULL = '-26%';
const RING_OUTER_PULL = '-42%';
const HOME_RING_PULL = '-14%';

/**
 * ⚠️ THE SIGHTING TRAIL — the one thing the reference has that the first hero
 * did not (`docs/design-refs/onboarding/ob2-life360-gold.jpg`, owner call
 * 2026-09-03: "bounty amounts, as now, plus a path"). Its map is one connected
 * picture because a line runs through it; ours was five prices arranged on a
 * field, and the eye had nothing to follow between them.
 *
 * ⚠️ IT IS THE CAR'S HISTORY, NOT A ROUTE TO IT. This file's own rule — "rings,
 * not arrows: nothing here may suggest anyone should travel towards a stolen
 * car" — is the reason the trail runs the direction it does. It is a record of
 * where the car HAS BEEN SEEN, ending at the car, which is exactly what a
 * spotter's reports build in this product. Nothing on this map marks the
 * viewer, so there is no line from them to anywhere; a viewer reading these
 * dots is reading the past, not being given a destination.
 *
 * ⚠️ DASHED, and that is a claim rather than a texture. We know the points,
 * never the journey between them — a sighting trail is four reports and a lot
 * of guessing. `SightingTimeline` draws its uncertainty segment dashed for the
 * same reason, so this is the app's existing vocabulary for "we are joining
 * these up, not asserting the line".
 *
 * ⚠️ IN VIEWBOX UNITS, WHILE THE DOTS ARE PERCENTAGES — the split the file
 * already makes for the field vs the pins, and for the same reason. The path
 * lives inside the stretched field so it keeps the shape it was drawn with
 * against the roads it runs among; the dots must stay ROUND, and a circle in a
 * `preserveAspectRatio="none"` viewBox is an ellipse on every handset that is
 * not 360×440. Each dot's percentage is its point's field coordinate over
 * FIELD_W / FIELD_H, and the two spaces coincide BECAUSE the field is stretched
 * rather than fitted.
 *
 * ⚠️ THAT CORRESPONDENCE HOLDS FOR PERCENTAGES, NOT FOR THE PILLS. `pinSlot`
 * offsets its pill by translateX(-28)/translateY(-12), which are POINTS, while
 * everything here is in stretched viewBox units — so the clearances below were
 * checked at a 360×440 band and are only nominal on any other. They are wide
 * enough to survive it: the nearest pill box (the top-left pin's, y ending
 * ≈117.6) sits ~66 units above the trail's highest point at (84, 184), and the
 * "No reward" pin is ~168 units to its right. Anything tighter than that must
 * not be reasoned about this way.
 *
 * The route climbs the lower-left quarter — the corridor the £10 pin vacated —
 * and ends UNDER the focal pill: the last leg has no dot because its endpoint
 * is the car itself. That endpoint (168, 184) stays covered on any band
 * narrower than ~840pt, which is every phone and tablet we ship to.
 */
const TRAIL_REPORTED = 'M 24 258 C 40 232, 42 193, 84 184';
const TRAIL_HOME = 'M 84 184 C 112 178, 128 190, 168 192';

/**
 * Each leg's sighting dots, as `x / FIELD_W` and `y / FIELD_H`. The shared
 * point (84, 184) belongs to the first leg, so the legs never double one.
 *
 * ⚠️ THE APPROACH WAS LENGTHENED ON 2026-09-05 (owner polish pass). Leg 1 began
 * at (36, 214) — a ~60pt shallow wiggle beside the focal pill, with only ~26
 * units of vertical travel across four dots. Placed by arithmetic, it survived
 * every clearance check and still read as noise the first time anyone saw it
 * rendered: a journey needs somewhere to have come FROM. It now starts at
 * (24, 258), low on the field near the fade's edge, and climbs ~74 units on a
 * real diagonal before handing over to leg 2.
 *
 * ⚠️ THE JOIN IS TANGENT-EXACT, not merely close. Leg 1's end tangent is
 * (42, −9) and leg 2's start tangent (28, −6) — both slope −0.214 — so the two
 * paths render as ONE stroke. They stay two `Path`s because the stage gating
 * and the two testIDs need them separable.
 *
 * ⚠️ EVERY DOT CLEARS EVERY ROAD, and the numbers are written down rather than
 * left to be re-derived (this file's own rule, learned over two earlier goes —
 * the first draft's shared point sat 3.6 units off the vertical road, and the
 * fix put it 1.4 off the upper one). Each dot's ring is drawn in the FIELD'S
 * OWN COLOUR after the roads, so a dot on a road does not overlap it, it
 * deletes a bite out of it. Minimum distances, dense-sampled against all three
 * roads including their S-segments, vs a ring half-extent of ~5.5 × ~7:
 *
 *     (24, 258)      lower 58.5   vertical 77.9   upper 106.5
 *     (44.25, 214.6) upper 58.8   vertical 58.1
 *     (84, 184)      upper 16.6   vertical 16.5
 *     (121.5, 185)   upper 10.4   vertical 20.8   ← the binding one, unchanged
 *
 * The leg-1 PATH's own closest approach to any road is 16.5 (vertical). A leg
 * CROSSING a road is fine and still happens; a dot parked on one is not.
 */
const TRAIL_DOTS_REPORTED: FieldPoint[] = [
  { left: '6.7%', top: '58.6%' }, // 24, 258 — just above the fade's onset
  { left: '12.3%', top: '48.8%' }, // 44.25, 214.6 — the curve's midpoint
  { left: '23.3%', top: '41.8%' }, // 84, 184
];
const TRAIL_DOTS_HOME: FieldPoint[] = [
  { left: '33.8%', top: '42%' }, // 121.5, 185 — the curve's midpoint
];

/** A report dot plus its ring, which is the box that gets centred on the point. */
const TRAIL_DOT_SLOT = sizes.onboardingTrailDot + sizes.onboardingTrailDotRing * 2;

/** Narrowed literals, so RN's style types accept them. */
const absolutePosition = 'absolute' as const;
const alignCentre = 'center' as const;

export interface OnboardingMapProps {
  stage: OnboardingMapStage;
}

/** One clock and one curve for every layer, matching the slide transition, so
 *  the whole screen arrives together. Module-scope so TrailLeg shares it
 *  literally rather than by copy. */
const STAGE_TIMING = {
  duration: motion.standard,
  easing: easeOut,
  reduceMotion: ReduceMotion.System,
} as const;

export function OnboardingMap({ stage }: OnboardingMapProps) {
  const palette = usePalette();
  const styles = useThemedStyles(makeStyles);
  const step = Math.max(0, STAGE_ORDER.indexOf(stage));
  const timing = STAGE_TIMING;

  const focalIn = useDerivedValue(() => withTiming(step >= 1 ? 1 : 0, timing), [step]);
  // ⚠️ FROM THE POST, not from the spot slide. The alert goes out when the car
  // is posted, and the post slide's body is what says so. The first draft fired
  // these a slide late, so the one screen whose words claimed people nearby were
  // alerted showed a single pin and no alert at all — which undercut the whole
  // reason the alert slide could be absorbed into the map.
  // ⚠️ ONE RING PER STEP, NOT A BULLSEYE (2026-09-05, owner polish pass). The
  // first cut kept BOTH rings up through the spot slide, which put two
  // concentric `textSecondary` circles under the trail, four dots, five pills
  // and the safety pill — the busiest slide wearing the heaviest graphic. Since
  // the contrast fix flattened every mark to one ink, hierarchy has to come
  // from GEOMETRY, and the cheapest geometry is fewer rings: the inner ring
  // shows on the post slide, the outer replaces it on the spot slide, so the
  // alert reads as one pulse propagating outward rather than a static target.
  //
  // The original two-ring reason — "one gate for both made the post and spot
  // slides pixel-identical" — is still answered: posted = inner ring; alerted =
  // outer ring + the trail arriving. Four stages, four pictures.
  const alertNearIn = useDerivedValue(
    () => withTiming(step >= 1 && step < 2 ? 1 : 0, timing),
    [step],
  );
  const alertFarIn = useDerivedValue(
    () => withTiming(step >= 2 && step < 3 ? 1 : 0, timing),
    [step],
  );
  const homeIn = useDerivedValue(() => withTiming(step >= 3 ? 1 : 0, timing), [step]);
  // ⚠️ THE TRAIL ARRIVES ON THE SPOT SLIDE, NOT THE POST ONE. Reports exist
  // because somebody was alerted and then looked; drawing them beside "your car
  // is posted" would show sightings of a car nobody had been told about yet.
  // (The gates themselves now live at the TrailLeg call sites as booleans —
  // each leg owns its own fade and stagger; see TrailLeg's header.)

  const focalStyle = useAnimatedStyle(() => ({ opacity: focalIn.value }));
  // ⚠️ THE RINGS MOVE, A LITTLE (2026-09-05, owner polish pass). Scale rides
  // the SAME derived value as the fade — zero new clocks, zero new curves, and
  // under ReduceMotion the timing collapses and the ring simply appears at
  // rest, exactly as before. The direction is the meaning: an alert EXPANDS
  // outward (0.85 → 1, and shrinks back as it retracts); home SETTLES inward
  // (1.12 → 1) — the one note of arrival the recovery slide is allowed, well
  // short of the springBouncy this file bans.
  //
  // Scaling the LAYER is geometrically exact, not an approximation: the layer
  // has zero intrinsic height (its ring child is absolute), so its transform
  // origin is its own top-centre — which is precisely where the negative
  // margins pull the ring's centre. The ring scales about its own middle.
  const alertNearStyle = useAnimatedStyle(() => ({
    opacity: alertNearIn.value,
    transform: [{ scale: 0.85 + 0.15 * alertNearIn.value }],
  }));
  const alertFarStyle = useAnimatedStyle(() => ({
    opacity: alertFarIn.value,
    transform: [{ scale: 0.85 + 0.15 * alertFarIn.value }],
  }));
  const homeStyle = useAnimatedStyle(() => ({
    opacity: homeIn.value,
    transform: [{ scale: 1.12 - 0.12 * homeIn.value }],
  }));

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="onboarding-map"
    >
      {/* `preserveAspectRatio="none"` with a viewBox the size of the band: it
          STRETCHES to fit rather than cropping, which is the right trade for
          abstract curves and is what stops a 16:9 handset losing the top of the
          field. Nothing here is a circle, so nothing distorts visibly. */}
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        preserveAspectRatio="none"
      >
        {/* ⚠️ THE LAND. Without it a `surface` pill sits on `background` at
            1.04:1 and the picture is five prices floating on a page — nothing
            for a marker to be a marker ON. The draft had ground but drew it as
            REPEATED ROUNDED RECTS, which is this app’s loading skeleton; one
            full-bleed plane cannot be read that way, and it gives the roads
            and pills the same 1.16:1 the real basemap gives them. */}
        <Rect x="0" y="0" width={FIELD_W} height={FIELD_H} fill={palette.surfaceSubtle} />
        <Path
          d="M-20 150 C 40 128, 92 192, 152 170 S 264 118, 380 152"
          stroke={palette.mapZoneStroke}
          strokeWidth={1.5}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <Path
          d="M-20 322 C 62 300, 124 352, 202 330 S 322 288, 380 312"
          stroke={palette.mapZoneStroke}
          strokeWidth={1}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <Path
          d="M92 -20 C 80 92, 112 182, 100 282 S 122 402, 112 460"
          stroke={palette.mapZoneStroke}
          strokeWidth={1}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </Svg>

      {/* Where the car has been seen. ABOVE the field and BELOW the pins: the
          trail is something the markers stand on, like the roads it runs among,
          and its last leg has to disappear under the focal pill rather than
          crossing it. */}
      <TrailLeg
        path={TRAIL_REPORTED}
        dots={TRAIL_DOTS_REPORTED}
        shown={step >= 2}
        testID="onboarding-map-trail"
      />
      <TrailLeg
        path={TRAIL_HOME}
        dots={TRAIL_DOTS_HOME}
        shown={step >= 3}
        testID="onboarding-map-trail-home"
      />

      {/* The alert reaching the neighbours. Rings, not arrows: nothing here may
          suggest anyone should travel towards a stolen car. */}
      <Animated.View
        style={[styles.ringLayer, alertFarStyle]}
        testID="onboarding-map-alert-far"
      >
        <View style={[styles.ring, styles.ringOuter]} />
      </Animated.View>
      <Animated.View
        style={[styles.ringLayer, alertNearStyle]}
        testID="onboarding-map-alert"
      >
        <View style={[styles.ring, styles.ringInner]} />
      </Animated.View>

      <View style={StyleSheet.absoluteFill} testID="onboarding-map-pins">
        {NEIGHBOURS.map((pin) => (
          <BountyPin key={pin.left + pin.top} pin={pin} styles={styles} />
        ))}
      </View>

      {/* Home again: a quiet ring settling around the car. Not a flourish. */}
      <Animated.View style={[styles.ringLayer, homeStyle]} testID="onboarding-map-home">
        <View style={styles.homeRing} />
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, focalStyle]} testID="onboarding-map-focal">
        <BountyPin pin={FOCAL} styles={styles} selected />
      </Animated.View>

      {/* The map dissolving into the page at its own lower edge, so the band
          ends softly instead of being sliced. NO viewBox: a vertical gradient
          has no aspect to preserve, and sharing the field's cropped one is what
          left the fade clipped on a 16:9 handset.

          ⚠️ ONSET 0.62, NOT 0.55 (2026-09-05). The earlier onset dissolved the
          band's lower third early, and on the short-copy slides (1 and 4) that
          left a long empty wash between the faded field and the bottom-aligned
          headline. Holding the field ~7% longer shortens the void. These stops
          are DELIBERATELY independent of ONBOARDING_WASH_HOLD — that constant
          couples the band's flex to the backdrop's ramp and must not move; this
          gradient is the map's own edge, free to be tuned alone. It also puts
          the trail's lowest dot (58.6% of the band) fully ABOVE the fade rather
          than 9% inside it. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="onboardingMapFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.62" stopColor={palette.background} stopOpacity="0" />
            <Stop offset="0.88" stopColor={palette.background} stopOpacity="0.75" />
            <Stop offset="1" stopColor={palette.background} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#onboardingMapFade)" />
      </Svg>
    </View>
  );
}

/**
 * One leg of the sighting trail: the dashed run and the reports on it, fading
 * in together as a single unit.
 *
 * ⚠️ THE PATH IS `vectorEffect="non-scaling-stroke"`, matching the roads, so the
 * trail keeps its 2pt weight whatever the band's aspect does to the field. The
 * DASH lengths are user units and so do stretch with it — accepted, because a
 * dash rhythm that varies by a few points across handsets is invisible, while a
 * stroke that halves in thickness is the difference between a trail and a
 * scratch.
 */
interface TrailLegProps {
  path: string;
  dots: FieldPoint[];
  /** Whether this leg's stage has arrived. WHICH step that is stays the map's
   *  story to tell; HOW the leg arrives — its fade, and the dots' stagger — is
   *  the leg's own (2026-09-05, owner polish pass). A boolean rather than a
   *  DerivedValue because the leg now runs more than one animation off it. */
  shown: boolean;
  testID: string;
}

function TrailLeg({ path, dots, shown, testID }: TrailLegProps) {
  // Its own palette, unlike BountyPin, which is handed the parent's styles.
  // This one already calls hooks, so there is nothing to save by threading —
  // the dots draw themselves in TrailDot below for the same reason.
  const palette = usePalette();
  // The leg's own fade rides the shared stage clock, so the PATH still arrives
  // with everything else — only the dots run behind it.
  const shownIn = useDerivedValue(() => withTiming(shown ? 1 : 0, STAGE_TIMING), [shown]);
  const style = useAnimatedStyle(() => ({ opacity: shownIn.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} testID={testID}>
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
        preserveAspectRatio="none"
      >
        <Path
          d={path}
          // textSecondary, not borderStrong — see `ring` in the sheet below for
          // the ratios; this stroke stands on the same field.
          stroke={palette.textSecondary}
          strokeWidth={sizes.onboardingTrailStroke}
          strokeLinecap="round"
          strokeDasharray={`${sizes.onboardingTrailDash} ${sizes.onboardingTrailGap}`}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
      {dots.map((dot, index) => (
        <TrailDot
          key={dot.left + dot.top}
          dot={dot}
          index={index}
          shown={shown}
          testID={`${testID}-dot-${index}`}
        />
      ))}
    </Animated.View>
  );
}

/**
 * One report on the trail, arriving in sequence.
 *
 * ⚠️ THE STAGGER IS THE PRODUCT MECHANISM DRAWN, not decoration: reports come
 * in one at a time, oldest first, and this is the one place the intro shows it.
 * Delay is `motion.listStagger` per index — the same rhythm every staggered
 * list entrance in the app uses — with `motion.fast` fades, so the last dot has
 * landed by ~300ms, inside the list-stagger budget. On the way OUT the delay is
 * zero: departures are not a story.
 *
 * ⚠️ `ReduceMotion.System` ON THE DELAY AS WELL AS THE TIMING. Reanimated only
 * collapses what it is told to; a reduced-motion user must get the dots at
 * once, not a slower version of the sequence.
 *
 * Its own component because hooks cannot run inside `dots.map`.
 */
function TrailDot({
  dot,
  index,
  shown,
  testID,
}: {
  dot: FieldPoint;
  index: number;
  shown: boolean;
  testID: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const dotIn = useDerivedValue(() => {
    const fade = withTiming(shown ? 1 : 0, {
      duration: motion.fast,
      easing: easeOut,
      reduceMotion: ReduceMotion.System,
    });
    return shown
      ? withDelay(index * motion.listStagger, fade, ReduceMotion.System)
      : fade;
  }, [shown, index]);
  const style = useAnimatedStyle(() => ({ opacity: dotIn.value }));

  return (
    <Animated.View
      style={[styles.trailDotRing, { left: dot.left, top: dot.top }, style]}
      testID={testID}
    >
      <View style={styles.trailDot} />
    </Animated.View>
  );
}

/** One car on the map — MapPins' bounty pill, one size down. The selected one
 *  INVERTS to `surfaceInverse` rather than merely darkening: on a dark scheme a
 *  dark bubble measures ~1.2:1 and vanishes, which is the same reason the real
 *  map inverts. The first draft used a `surface` fill for every pin, which in
 *  dark mode is darker than the field it sits on — a hole, not a marker. */
function BountyPin({
  pin,
  styles,
  selected = false,
}: {
  pin: BountyPoint;
  styles: ReturnType<typeof makeStyles>;
  selected?: boolean;
}) {
  return (
    <View style={[styles.pinSlot, { left: pin.left, top: pin.top }]}>
      <View style={[styles.pill, selected && styles.pillSelected]}>
        <Text
          style={[styles.pillText, selected && styles.pillTextSelected]}
          maxFontSizeMultiplier={mapPinFontScaleCap}
        >
          {pin.pence === null ? NO_BOUNTY_LABEL : formatPounds(pin.pence)}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pinSlot: {
      position: 'absolute',
      // The slot's origin is its top-left corner, so pull the pill back onto
      // the point it is marking.
      transform: [{ translateX: -28 }, { translateY: -12 }],
    },
    // MapPins' anatomy: the same fill, radius, hairline and shadow, with the
    // tighter padding a decorative pin can afford.
    pill: {
      backgroundColor: c.surface,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderWidth: 1,
      // ⚠️ STILL `borderStrong`, while the rings and the trail beside it moved
      // to `textSecondary` — deliberately, not an oversight the 2026-09-04 pass
      // missed. Those graphics are the SOLE carrier of their own shape, so they
      // owe the full 3:1. This edge is not: the pill has a `surface` fill and a
      // shadow, and DESIGN_SYSTEM sanctions `borderStrong` at 2.61:1 for
      // precisely this element on the real map. Same distinction
      // ChoiceChipsMulti draws when it says the ring is doing ALL the work.
      // Do not unify these.
      borderColor: c.borderStrong,
      ...shadows.soft,
    },
    pillSelected: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      backgroundColor: c.surfaceInverse,
      borderColor: c.surfaceInverse,
    },
    pillText: {
      ...typography.mapPin,
      color: c.accentText,
    },
    pillTextSelected: {
      color: c.textOnPrimary,
    },
    // ⚠️ ANCHORED TO THE FOCAL PIN, not centred by eye. Percentage padding
    // resolves against WIDTH while the pin’s `top` resolves against HEIGHT, so
    // the two only coincided on a near-square phone band and drifted apart on
    // anything else — the alert would radiate from beside the car rather than
    // from it. `marginTop` is a percentage of width too, so -half the ring’s
    // width lands its centre exactly on the pin’s row.
    ringLayer: {
      position: absolutePosition,
      left: 0,
      right: 0,
      top: FOCAL.top,
      alignItems: alignCentre,
    },
    ring: {
      position: absolutePosition,
      aspectRatio: 1,
      borderRadius: radii.full,
      borderWidth: sizes.onboardingRingStroke,
      // ⚠️ NO OPACITY. This style reasoned its way to `borderStrong` and then
      // put 0.5 on the next line, compositing to 1.60:1 — WORSE than the
      // `mapZoneStroke` it rejected for being a whisper, and less than half the
      // 3:1 graphic floor. A whole slide’s job was handed to this graphic.
      //
      // ⚠️ AND `borderStrong` WAS STILL NOT ENOUGH (2026-09-04 review). It is
      // the app's graphic-floor token, but colors.test.ts only ever asserts it
      // against `background` and `surface`; this field is `surfaceSubtle`, one
      // step further down, where it measures 2.79:1 light / 2.81:1 dark and
      // misses the same 3:1 floor the paragraph above is about. CI could not
      // see it. `textSecondary` clears it at 4.66:1 / 5.69:1 — the ratios and
      // the reasoning ChoiceChipsMulti's swatch ring already records.
      borderColor: c.textSecondary,
    },
    ringOuter: {
      width: RING_OUTER,
      marginTop: RING_OUTER_PULL,
    },
    ringInner: {
      width: RING_INNER,
      marginTop: RING_INNER_PULL,
    },
    // ⚠️ A RING IN THE FIELD'S OWN COLOUR, exactly as SightingTimeline rings its
    // sighting dots in the page colour "so they sit crisply ON the rail". Here
    // the rail is dashed and the ground is `surfaceSubtle`, so the ring is
    // `surfaceSubtle` — it punches the dash out from under each report instead
    // of letting the line run through it, which is what stops four dots on a
    // dashed curve reading as a longer dash.
    trailDotRing: {
      position: absolutePosition,
      width: TRAIL_DOT_SLOT,
      height: TRAIL_DOT_SLOT,
      borderRadius: radii.full,
      backgroundColor: c.surfaceSubtle,
      alignItems: alignCentre,
      justifyContent: alignCentre,
      // The slot's origin is its top-left, and the point it marks is its
      // CENTRE — the same correction pinSlot makes, in the same direction.
      transform: [{ translateX: -TRAIL_DOT_SLOT / 2 }, { translateY: -TRAIL_DOT_SLOT / 2 }],
    },
    // `surfaceInverse`, the same ink the focal pill uses, and for the file's
    // existing reason: a `surface` fill is DARKER than this field in dark mode,
    // so it would read as a hole punched in the map rather than a report on it.
    trailDot: {
      width: sizes.onboardingTrailDot,
      height: sizes.onboardingTrailDot,
      borderRadius: radii.full,
      backgroundColor: c.surfaceInverse,
    },
    homeRing: {
      width: HOME_RING,
      marginTop: HOME_RING_PULL,
      aspectRatio: 1,
      borderRadius: radii.full,
      borderWidth: sizes.onboardingRingStroke,
      // Same field, same floor, same fix as `ring` above.
      borderColor: c.textSecondary,
    },
  });
