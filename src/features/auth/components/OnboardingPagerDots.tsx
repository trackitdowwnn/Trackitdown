/**
 * WHAT:  Scroll-linked paging dots for the onboarding pager — the active dot
 *        stretches into a sage pill, morphing continuously with the scroll
 *        position (not step-jumped).
 * WHY:   The dots mirror finger position so the pager feels physical, using
 *        the wizard's existing progressDot/progressPill size tokens so both
 *        steppers read as one system. Purely decorative: page position is
 *        announced by each slide's accessibility label, so the row is hidden
 *        from the accessibility tree entirely.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx (owner);
 *        src/shared/theme/sizes.ts (progressDot/progressPill);
 *        docs/DESIGN_SYSTEM.md (Motion, Accessibility).
 */

import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { colors, sizes, spacing } from '@/shared/theme';

export interface OnboardingPagerDotsProps {
  count: number;
  /** Horizontal scroll offset of the pager, in px. */
  scrollX: SharedValue<number>;
  /** Page width, so the offset maps to slide positions. */
  pageWidth: number;
}

export function OnboardingPagerDots({ count, scrollX, pageWidth }: OnboardingPagerDotsProps) {
  return (
    <View
      style={styles.row}
      // Decorative: slides announce "Slide n of N" themselves.
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {Array.from({ length: count }, (_, index) => (
        <Dot key={index} index={index} scrollX={scrollX} pageWidth={pageWidth} />
      ))}
    </View>
  );
}

function Dot({
  index,
  scrollX,
  pageWidth,
}: {
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
}) {
  'use no memo';
  const animatedStyle = useAnimatedStyle(() => {
    const position = pageWidth > 0 ? scrollX.value / pageWidth : 0;
    const range = [index - 1, index, index + 1];
    return {
      width: interpolate(
        position,
        range,
        [sizes.progressDot, sizes.progressPill, sizes.progressDot],
        'clamp',
      ),
      backgroundColor: interpolateColor(position, range, [
        colors.borderStrong,
        colors.primary,
        colors.borderStrong,
      ]),
    };
  });

  return <Animated.View style={[styles.dot, animatedStyle]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    height: sizes.progressDot,
    borderRadius: sizes.progressDot / 2,
  },
});
