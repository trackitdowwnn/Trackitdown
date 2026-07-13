/**
 * WHAT:  AppHeader — a top bar that starts TRANSPARENT over a full-bleed hero
 *        and cross-fades to a solid surface + hairline + centred title as the
 *        hero scrolls away. A left back button and a right-actions slot float
 *        over the hero throughout. Also exports AppHeaderButton, the circular
 *        surface-white icon button used for back/share/flag.
 * WHY:   The Airbnb detail-page header: the photo owns the top of the screen
 *        and chrome fades in only once you've scrolled past it. Driven by a
 *        Reanimated scroll value on the UI thread so the fade never janks the
 *        scroll. First shared scroll-linked header in the app.
 * LINKS: src/features/vehicles (post-detail hero); docs/DESIGN_SYSTEM.md
 *        (Motion, hairline, circular controls).
 */

import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, shadows, sizes, spacing, typography } from '../theme';

/** Bar height below the status bar. Exported so a hero screen can align its
 *  scroll-fade range to where the header sits. */
export const HEADER_BAR_HEIGHT = 56;
/** Side gaps that keep the centred title clear of up to two action buttons. */
const TITLE_SIDE_INSET = sizes.touchTarget * 2 + spacing.md;

export interface AppHeaderButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
}

/** Circular surface-white icon button — stays legible floating over a photo. */
export function AppHeaderButton({ onPress, accessibilityLabel, children }: AppHeaderButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.circle, pressed && styles.circlePressed]}
    >
      {children}
    </Pressable>
  );
}

export interface AppHeaderProps {
  title: string;
  /** Scroll offset (px) from the page's Reanimated scroll handler. */
  scrollY: SharedValue<number>;
  /** Scroll range (px) over which transparent → solid happens — typically
   *  [heroHeight − headerHeight − insetTop, heroHeight − insetTop]. */
  fadeStart: number;
  fadeEnd: number;
  onBack: () => void;
  /** Right-aligned action buttons (share, flag, …). */
  rightActions?: ReactNode;
}

export function AppHeader({
  title,
  scrollY,
  fadeStart,
  fadeEnd,
  onBack,
  rightActions,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();

  // Background + hairline + title all fade in together on the UI thread.
  const solidStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [fadeStart, fadeEnd], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View
      style={[styles.container, { paddingTop: insets.top, height: insets.top + HEADER_BAR_HEIGHT }]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.solid, solidStyle]}
        pointerEvents="none"
      />
      <Animated.View
        style={[
          styles.titleWrap,
          { top: insets.top, left: TITLE_SIDE_INSET, right: TITLE_SIDE_INSET },
          solidStyle,
        ]}
        pointerEvents="none"
      >
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </Animated.View>
      <View style={styles.row} pointerEvents="box-none">
        <AppHeaderButton onPress={onBack} accessibilityLabel="Back">
          <Feather name="chevron-left" size={sizes.icon} color={colors.textPrimary} />
        </AppHeaderButton>
        <View style={styles.rightRow}>{rightActions}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  solid: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  titleWrap: {
    position: 'absolute',
    height: HEADER_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  row: {
    height: HEADER_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  circle: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lifted,
  },
  circlePressed: {
    backgroundColor: colors.surfaceSubtle,
  },
});
