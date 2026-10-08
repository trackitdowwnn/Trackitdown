/**
 * WHAT:  The wizard's progress bar — one rounded segment per phase, side by
 *        side in the header beside the X, each filling with its phase's
 *        steps. "Step 2 of 3" lives on as the screen-reader label only.
 * WHY:   It used to be a dot per phase with the current one stretched into a
 *        pill, so it stood still across a whole phase — eight screens on
 *        "Post a car" without the bar moving once — and it animated widths
 *        and colours on the JS thread, eight animations at mount, right as
 *        the form slid up (2026-10-08, "janky, slow and not smooth"; the
 *        owner chose segments that fill). Now each step moves the bar a
 *        little, on the UI thread, and NOTHING animates on mount: a segment
 *        starts at its value and only animates when it changes. ease-out on
 *        the standard clock, as every wizard move; instant under reduced
 *        motion. The fill MOVES (translateX inside a clipped track) rather
 *        than resizing, so it never asks for a layout pass per frame.
 *        Exposed as a progressbar with a label and percentage.
 * LINKS: src/shared/wizard/WizardScreen.tsx (owner);
 *        src/shared/wizard/navigation.ts (phaseProgress — the fills);
 *        docs/DESIGN_SYSTEM.md (Motion, Accessibility).
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion, radii, sizes, spacing, usePalette } from '../theme';
import { easeOut } from '@/shared/theme/motionEasing';

export interface WizardProgressBarProps {
  /** Fill fraction (0–1) per phase, one segment each. */
  fills: number[];
  /** Screen-reader name for the bar, e.g. "Step 2 of 7" — not shown. */
  label: string;
  /** How far through the flow, 0–100, for screen readers. */
  percent: number;
}

export function WizardProgressBar({ fills, label, percent }: WizardProgressBarProps) {
  const reduceMotion = useReducedMotion();

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
    >
      {fills.map((fill, index) => (
        <Segment key={index} fill={fill} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

function Segment({ fill, reduceMotion }: { fill: number; reduceMotion: boolean }) {
  const palette = usePalette();
  // Starts AT its value: the bar is simply there when the form slides up.
  const progress = useSharedValue(fill);
  const lastFill = useRef(fill);
  useEffect(() => {
    if (lastFill.current === fill) {
      return;
    }
    lastFill.current = fill;
    progress.value = reduceMotion
      ? fill
      : withTiming(fill, { duration: motion.standard, easing: easeOut });
  }, [fill, reduceMotion, progress]);

  // The fill is the track's full width, slid left out of the clipped track by
  // the part not yet done. Hidden until the track is measured, so it can't
  // show full for a frame.
  const trackWidth = useSharedValue(0);
  const onLayout = (event: LayoutChangeEvent) => {
    trackWidth.value = event.nativeEvent.layout.width;
  };
  const fillStyle = useAnimatedStyle(() => ({
    opacity: trackWidth.value > 0 ? 1 : 0,
    transform: [{ translateX: (progress.value - 1) * trackWidth.value }],
  }));

  return (
    <View
      style={[styles.track, { backgroundColor: palette.borderStrong }]}
      onLayout={onLayout}
      testID="wizard-progress-segment"
    >
      <Animated.View style={[styles.fill, { backgroundColor: palette.primary }, fillStyle]} />
    </View>
  );
}

// Geometry only — the colours come from the palette per render.
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  track: {
    flex: 1,
    height: sizes.progressSegment,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: radii.full,
  },
});
