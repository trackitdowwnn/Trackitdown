/**
 * WHAT:  AppHeader — a top bar that starts TRANSPARENT over a full-bleed hero
 *        and cross-fades to a solid surface + hairline + centred title as the
 *        hero scrolls away. Also exports AppHeaderButton, the circular
 *        surface-white icon button used for back/share: over the hero it is a
 *        floating white circle; as the bar solidifies the circle (and its
 *        shadow) fade out, leaving a flat icon on the bar — the reference's
 *        two-state icon treatment.
 * WHY:   The Airbnb detail-page header: the photo owns the top of the screen
 *        and chrome fades in only once you've scrolled past it. Driven by a
 *        Reanimated scroll value on the UI thread so the fade never janks the
 *        scroll. The circle fade rides the SAME scroll range via context, so
 *        consumers' buttons (passed as `rightActions`) need no wiring; outside
 *        an AppHeader the button stays a solid circle.
 * LINKS: src/features/vehicles (post-detail hero); docs/DESIGN_SYSTEM.md
 *        (Motion, hairline, circular controls);
 *        docs/design-refs/post-detail/REFERENCE_SPEC.md §3.
 */

import { Feather } from '@expo/vector-icons';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
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

/** The header's fade range, shared with its buttons so their circle layer can
 *  ride the same scroll interpolation. Null outside an AppHeader. */
interface HeaderFade {
  scrollY: SharedValue<number>;
  fadeStart: number;
  fadeEnd: number;
}
const HeaderFadeContext = createContext<HeaderFade | null>(null);

export interface AppHeaderButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
}

/** Circular surface-white icon button — stays legible floating over a photo.
 *  Inside an AppHeader the circle fades out as the bar solidifies. */
export function AppHeaderButton({ onPress, accessibilityLabel, children }: AppHeaderButtonProps) {
  const fade = useContext(HeaderFadeContext);

  // Circle + shadow fade 1 → 0 over the bar's own fade range; a plain solid
  // circle when rendered outside a header (fade == null).
  const circleStyle = useAnimatedStyle(() => ({
    opacity: fade
      ? interpolate(
          fade.scrollY.value,
          [fade.fadeStart, fade.fadeEnd],
          [1, 0],
          Extrapolation.CLAMP,
        )
      : 1,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.buttonHit}
    >
      {({ pressed }) => (
        <>
          <Animated.View style={[styles.circle, circleStyle]} pointerEvents="none" />
          {/* Pressed tint on its OWN layer, outside the fade interpolation, so
              feedback survives the flat-icon (solid bar) state too. */}
          {pressed ? <View style={styles.pressedTint} pointerEvents="none" /> : null}
          {children}
        </>
      )}
    </Pressable>
  );
}

export interface AppHeaderProps {
  title: string;
  /** Scroll offset (px) from the page's Reanimated scroll handler. */
  scrollY: SharedValue<number>;
  /** Scroll range (px) over which transparent → solid happens — typically
   *  [visual hero bottom − headerHeight − insetTop − travel, …]. */
  fadeStart: number;
  fadeEnd: number;
  onBack: () => void;
  /** Right-aligned action buttons (share, …). */
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

  const fade = useMemo(
    () => ({ scrollY, fadeStart, fadeEnd }),
    [scrollY, fadeStart, fadeEnd],
  );

  return (
    <HeaderFadeContext.Provider value={fade}>
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, height: insets.top + HEADER_BAR_HEIGHT },
        ]}
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
    </HeaderFadeContext.Provider>
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
  buttonHit: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    ...shadows.lifted,
  },
  pressedTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtlePressed,
  },
});
