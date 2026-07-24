/**
 * WHAT:  MapPillButton — the floating dark "Map" pill, bottom-centre of the
 *        feed. Slides away on scroll-down and returns on scroll-up
 *        (Reanimated), so it never sits over content mid-read.
 * WHY:   Airbnb's map toggle: the feed and the map are two views of the same
 *        search. surfaceInverse is the one sanctioned dark floating fill —
 *        it must read above any card photo without competing with the near-black
 *        bounty tags. While hidden it leaves the accessibility tree too
 *        (opacity alone would keep it in the screen-reader focus order).
 * LINKS: src/features/search-map/screens/HomeFeedScreen.tsx (scroll wiring);
 *        docs/DESIGN_SYSTEM.md (Motion — 200–250ms ease-out, no bounce).
 */

import { Feather } from '@expo/vector-icons';
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, motion, radii, shadows, sizes, spacing, typography } from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

/** Travel to clear the screen edge when hidden: pill height + its bottom
 *  offset + one more gutter of slack. */
const HIDE_TRAVEL = sizes.touchTarget + spacing.xl + spacing.xl;

export interface MapPillButtonProps {
  visible: boolean;
  onPress: () => void;
}

export const MapPillButton = memo(function MapPillButton({
  visible,
  onPress,
}: MapPillButtonProps) {
  const shown = useSharedValue(visible ? 1 : 0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, {
      duration: reduceMotion ? 0 : motion.standard,
      easing: easeOut,
    });
  }, [visible, shown, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * HIDE_TRAVEL }],
    // Style-level pointerEvents (the prop form is deprecated in newer RN).
    pointerEvents: shown.value > 0.5 ? ('auto' as const) : ('none' as const),
  }));

  return (
    <Animated.View
      style={[styles.wrap, animatedStyle]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open the map"
        onPress={onPress}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <Feather name="map" size={sizes.iconSm} color={colors.textOnPrimary} />
        <Text style={styles.label}>Map</Text>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: spacing.xl,
    alignSelf: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceInverse,
    borderRadius: radii.full,
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.xl,
    ...shadows.lifted,
  },
  pillPressed: {
    backgroundColor: colors.surfaceInversePressed,
  },
  label: {
    ...typography.label,
    color: colors.textOnPrimary,
  },
});
