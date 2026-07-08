/**
 * WHAT:  The wizard's dot-pill progress indicator — a row of small
 *        free-standing dots (one per phase, plus review), the current one
 *        stretched into a horizontal pill. Compact, top-right in the header
 *        row; the "Step 2 of 4" wording lives on as the screen-reader label
 *        only.
 * WHY:   Replicates the sticky-bubble-bar pattern the flow design follows:
 *        completed dots fill sage, upcoming dots stay sand, and on advance
 *        the pill "worms" to the next slot — each slot animates its width
 *        (dot ↔ pill) and colour, so the leading edge stretches out before
 *        the trailing edge catches up. 250ms ease-out per the design
 *        system's motion rule; honours OS reduce-motion (snaps). Non-visual
 *        state is exposed via the progressbar role, label, and value.
 * LINKS: src/shared/wizard/WizardScreen.tsx (owner; derives the props from
 *        navigation state); docs/DESIGN_SYSTEM.md (Motion, Accessibility).
 */

import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { colors, radii, sizes, spacing } from '../theme';

export interface WizardProgressBarProps {
  /** Fill fraction (0–1) per phase — drives the accessibility percentage. */
  fills: number[];
  /** Slot rendered as the pill (phase index, or the review dot). */
  activeIndex: number;
  /** Total dots — phases plus the review dot when the flow has one. */
  dotCount: number;
  /** Screen-reader name for the indicator, e.g. "Step 2 of 4" — not shown. */
  label: string;
}

/** Morph time — the design system's upper motion bound. */
const MORPH_MS = 250;

type SlotState = 'done' | 'active' | 'upcoming';

export function WizardProgressBar({ fills, activeIndex, dotCount, label }: WizardProgressBarProps) {
  const reduceMotion = useReducedMotion();

  const overallPercent = Math.round(
    (fills.reduce((sum, fill) => sum + fill, 0) / Math.max(fills.length, 1)) * 100,
  );

  return (
    <View
      style={styles.dots}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: overallPercent }}
    >
      {Array.from({ length: dotCount }, (_, index) => (
        <Slot
          key={index}
          state={index === activeIndex ? 'active' : index < activeIndex ? 'done' : 'upcoming'}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
}

/**
 * One slot: a dot that can stretch into the pill. Width and colour animate
 * independently, so during a transition the incoming slot widens while the
 * outgoing one narrows — the sticky "worm" between positions.
 */
function Slot({ state, reduceMotion }: { state: SlotState; reduceMotion: boolean }) {
  // JS-driven Animated (width/colour can't use the native driver), matching
  // the codebase's TextField pattern.
  const [widthAnim] = useState(() => new Animated.Value(state === 'active' ? 1 : 0));
  const [colorAnim] = useState(() => new Animated.Value(state === 'upcoming' ? 0 : 1));

  useEffect(() => {
    const widthTarget = state === 'active' ? 1 : 0;
    const colorTarget = state === 'upcoming' ? 0 : 1;
    if (reduceMotion) {
      widthAnim.setValue(widthTarget);
      colorAnim.setValue(colorTarget);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(widthAnim, {
        toValue: widthTarget,
        duration: MORPH_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(colorAnim, {
        toValue: colorTarget,
        duration: MORPH_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [state, reduceMotion, widthAnim, colorAnim]);

  return (
    <Animated.View
      style={[
        styles.slot,
        {
          width: widthAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [sizes.progressDot, sizes.progressPill],
          }),
          backgroundColor: colorAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [colors.borderStrong, colors.primary],
          }),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  slot: {
    height: sizes.progressDot,
    borderRadius: radii.sm,
  },
});
