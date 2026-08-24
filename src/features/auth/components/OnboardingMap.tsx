/**
 * WHAT:  The onboarding hero — a small piece of the app's own map, with bounty
 *        pins, changing state as the slides step: cars scattered nearby, one
 *        posted, the alert reaching the others, that one home again. Built from
 *        components and tokens; no image assets.
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
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { formatPounds } from '@/shared/lib/money';
import {
  motion,
  radii,
  shadows,
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
const NEIGHBOURS: { left: `${number}%`; top: `${number}%`; pence: number }[] = [
  { left: '18%', top: '24%', pence: 15000 },
  { left: '76%', top: '30%', pence: 40000 },
  { left: '26%', top: '66%', pence: 10000 },
  { left: '70%', top: '70%', pence: 30000 },
];

/** The owner's car. Centre-ish and slightly high, so the rings have room. */
const FOCAL = { left: '50%' as const, top: '42%' as const, pence: 25000 };

/** Ring diameters as a share of the WIDTH, with aspectRatio 1 so they stay
 *  circles rather than ellipses. 84% clears the furthest neighbour. */
const RING_INNER = '52%';
const RING_OUTER = '84%';

export interface OnboardingMapProps {
  stage: OnboardingMapStage;
}

export function OnboardingMap({ stage }: OnboardingMapProps) {
  const palette = usePalette();
  const styles = useThemedStyles(makeStyles);
  const step = Math.max(0, STAGE_ORDER.indexOf(stage));

  // One clock and one curve for every layer, matching the slide transition and
  // the ring sweep, so the whole screen arrives together.
  const timing = {
    duration: motion.standard,
    easing: easeOut,
    reduceMotion: ReduceMotion.System,
  } as const;

  const focalIn = useDerivedValue(() => withTiming(step >= 1 ? 1 : 0, timing), [step]);
  // ⚠️ FROM THE POST, not from the spot slide. The alert goes out when the car
  // is posted, and the post slide's body is what says so. The first draft fired
  // these a slide late, so the one screen whose words claimed people nearby were
  // alerted showed a single pin and no alert at all — which undercut the whole
  // reason the alert slide could be absorbed into the map.
  const alertIn = useDerivedValue(() => withTiming(step >= 1 && step < 3 ? 1 : 0, timing), [step]);
  const homeIn = useDerivedValue(() => withTiming(step >= 3 ? 1 : 0, timing), [step]);

  const focalStyle = useAnimatedStyle(() => ({ opacity: focalIn.value }));
  const alertStyle = useAnimatedStyle(() => ({ opacity: alertIn.value }));
  const homeStyle = useAnimatedStyle(() => ({ opacity: homeIn.value }));

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
        <Path
          d="M-20 150 C 40 128, 92 192, 152 170 S 264 118, 380 152"
          stroke={palette.mapZoneStroke}
          strokeWidth={1.5}
          fill="none"
        />
        <Path
          d="M-20 322 C 62 300, 124 352, 202 330 S 322 288, 380 312"
          stroke={palette.mapZoneStroke}
          strokeWidth={1}
          fill="none"
        />
        <Path
          d="M92 -20 C 80 92, 112 182, 100 282 S 122 402, 112 460"
          stroke={palette.mapZoneStroke}
          strokeWidth={1}
          fill="none"
        />
      </Svg>

      {/* The alert reaching the neighbours. Rings, not arrows: nothing here may
          suggest anyone should travel towards a stolen car. */}
      <Animated.View style={[styles.ringLayer, alertStyle]} testID="onboarding-map-alert">
        <View style={[styles.ring, styles.ringOuter]} />
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
          left the fade clipped on a 16:9 handset. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="onboardingMapFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.55" stopColor={palette.background} stopOpacity="0" />
            <Stop offset="0.85" stopColor={palette.background} stopOpacity="0.75" />
            <Stop offset="1" stopColor={palette.background} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#onboardingMapFade)" />
      </Svg>
    </View>
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
  pin: { left: `${number}%`; top: `${number}%`; pence: number };
  styles: ReturnType<typeof makeStyles>;
  selected?: boolean;
}) {
  return (
    <View style={[styles.pinSlot, { left: pin.left, top: pin.top }]}>
      <View style={[styles.pill, selected && styles.pillSelected]}>
        <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
          {formatPounds(pin.pence)}
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
    // Centred on the focal pin, which sits at 50%/42% — hence the bottom pad
    // rather than dead centre.
    ringLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: '16%',
    },
    ring: {
      position: 'absolute',
      aspectRatio: 1,
      borderRadius: radii.full,
      borderWidth: 1,
      // borderStrong, not the zone stroke: at ~2.2:1 on light `background` the
      // alert beat was a whisper in one theme and clear in the other.
      borderColor: c.borderStrong,
      opacity: 0.5,
    },
    ringOuter: {
      width: RING_OUTER,
    },
    ringInner: {
      width: RING_INNER,
    },
    homeRing: {
      width: '28%',
      aspectRatio: 1,
      borderRadius: radii.full,
      borderWidth: 1.5,
      borderColor: c.borderStrong,
    },
  });
