/**
 * WHAT:  The onboarding "next" control — a filled circular button with a
 *        progress ring sweeping around it, tracking how far through the slides
 *        you are.
 * WHY:   The ring IS the progress indicator; it replaced a row of dots plus a
 *        numbered step rail (2026-08-08, docs/design-refs/onboarding/). One
 *        object now says both "where you are" and "what to press", which is the
 *        reference's whole idea: the control and the progress are the same
 *        thing, so the eye has one place to be rather than three.
 *
 *        PROGRESS IS (page + 1) / total, NOT page / lastPage. At rest on the
 *        first slide the ring is a quarter full, exactly as one of four dots
 *        used to be lit. A ring that starts empty reads as broken, and a ring
 *        that divided by lastPage would be full on the last slide — where this
 *        control does not even render (the last slide swaps to a full-width
 *        "Get started"; see OnboardingScreen).
 *
 *        DRIVEN BY THE SETTLED PAGE, NOT A FINGER (2026-08-08). This used to
 *        read a paging ScrollView's `scrollX` so the arc grew under the drag.
 *        The screen gave up the swipe when it adopted the wizard's layout
 *        animations, so there is no continuous offset to follow any more and a
 *        `scrollX` prop would have been a shared value nobody ever wrote to.
 *        The arc now animates between two settled amounts on the same curve as
 *        the step it accompanies — motion.standard, easeOut — so the ring and
 *        the words arrive together instead of on two schedules.
 *
 *        THE RING IS STATE, NOT DECORATION, so it is drawn BOTH statically and
 *        through animatedProps. That is not belt-and-braces, it is three
 *        separate requirements:
 *          1. react-native-svg only forwards strokeDashoffset when
 *             strokeDasharray is ALSO set — extractStroke.js gates on
 *             `strokeDasharray && strokeDashoffset` and only then lists the prop
 *             in the propList the native side uses to decide which stroke props
 *             are owned. ⚠️ Deleting either static prop as "dead — animatedProps
 *             sets it" silently kills the ring.
 *          2. First paint is correct before any worklet has run, so the ring
 *             never flashes empty.
 *          3. If animated SVG props ever misbehave on a device, the ring steps
 *             once per page instead of freezing — a graceful failure for
 *             something that carries information.
 *        Reduced motion is handled inside the timing (ReduceMotion.System), so
 *        it drops the SWEEP and never the truth of how far along you are.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx (owner);
 *        src/features/sightings/components/SightingTimeline.tsx (the other
 *          react-native-svg consumer);
 *        src/shared/theme/sizes.ts (fab / fabRing / fabRingGap);
 *        docs/design-refs/onboarding/ob1.webp.
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedProps,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';

import { motion, sizes, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Outer box: the fill plus the gap and stroke on both sides. */
export const RING_SLOT = sizes.fab + 2 * (sizes.fabRingGap + sizes.fabRing);
/** The stroke is centred on the path, so the radius is inset by half of it. */
const RING_RADIUS = (RING_SLOT - sizes.fabRing) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * How much of the ring is left UNDRAWN at a given page.
 *
 * Exported for the screen's static prop; the test deliberately recomputes the
 * circumference from the tokens rather than importing this, so the assertion
 * describes the spec instead of agreeing with the implementation.
 */
export function ringOffset(page: number, total: number): number {
  const progress = total > 0 ? Math.min(Math.max((page + 1) / total, 0), 1) : 0;
  return CIRCUMFERENCE * (1 - progress);
}

export interface OnboardingRingFabProps {
  /** Settled page index — the ring animates to the amount this implies. */
  page: number;
  total: number;
  onPress: () => void;
}

export function OnboardingRingFab({ page, total, onPress }: OnboardingRingFabProps) {
  'use no memo';

  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const settled = ringOffset(page, total);

  // Sweeps to the new amount on the same curve as the step transition beside
  // it. ReduceMotion.System is what makes the reduced path a JUMP to the right
  // amount rather than an arc that stops carrying information.
  const sweep = useDerivedValue(
    () =>
      withTiming(settled, {
        duration: motion.standard,
        easing: easeOut,
        reduceMotion: ReduceMotion.System,
      }),
    [settled],
  );

  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: sweep.value }));

  return (
    <View style={styles.slot}>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        // Decorative to assistive tech: each slide announces "Slide n of N",
        // so speaking the ring too would say the same thing twice.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg width={RING_SLOT} height={RING_SLOT}>
          {/* Rotate the canvas, not the arc: a static -90° puts 0% at twelve
              o'clock without another animated property to keep in step. */}
          <G rotation={-90} origin={`${RING_SLOT / 2}, ${RING_SLOT / 2}`}>
            <Circle
              cx={RING_SLOT / 2}
              cy={RING_SLOT / 2}
              r={RING_RADIUS}
              stroke={palette.border}
              strokeWidth={sizes.fabRing}
              fill="none"
            />
            <AnimatedCircle
              testID="onboarding-ring-arc"
              cx={RING_SLOT / 2}
              cy={RING_SLOT / 2}
              r={RING_RADIUS}
              stroke={palette.primary}
              strokeWidth={sizes.fabRing}
              strokeLinecap="round"
              fill="none"
              // ⚠️ BOTH static props are load-bearing — see the header. The
              // dash array gates the offset through extractStroke; the static
              // offset paints the first frame and keeps the ring honest if the
              // animated prop never lands.
              strokeDasharray={[CIRCUMFERENCE, CIRCUMFERENCE]}
              strokeDashoffset={settled}
              animatedProps={arcProps}
            />
          </G>
        </Svg>
      </View>

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Next"
        testID="onboarding-cta"
      >
        <Feather name="arrow-right" size={sizes.icon} color={palette.textOnPrimary} />
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  slot: {
    width: RING_SLOT,
    height: RING_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    width: sizes.fab,
    height: sizes.fab,
    borderRadius: sizes.fab / 2,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: c.primaryPressed,
  },
});
