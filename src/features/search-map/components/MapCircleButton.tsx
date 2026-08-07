/**
 * WHAT:  MapCircleButton — the round white control that floats over map tiles
 *        (back, recentre). Icon-only, 44pt, lifted, with press feedback.
 * WHY:   Three copies of this had accumulated and they had already drifted:
 *        two of them shipped with no pressed state while every other floating
 *        control in the feature had one. Adjacent buttons behaving differently
 *        is visible, so the shape lives here once.
 *
 *        `lifted`, not `soft`: this is CHROME over map tiles and has to hold
 *        an edge against them. Markers go the other way — see MapPins.
 * LINKS: docs/DESIGN_SYSTEM.md (Map screens — controls vs markers);
 *        src/features/search-map/components/MapRecentreButton.tsx.
 */

import { Feather } from '@expo/vector-icons';
import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radii, shadows, sizes } from '@/shared/theme';

export interface MapCircleButtonProps {
  /** Feather glyph name. Ignored when `children` is given (e.g. a spinner). */
  icon?: keyof typeof Feather.glyphMap;
  /** Replaces the icon entirely — for a busy spinner. */
  children?: ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
  busy?: boolean;
  testID?: string;
}

export const MapCircleButton = memo(function MapCircleButton({
  icon,
  children,
  accessibilityLabel,
  onPress,
  busy = false,
  testID,
}: MapCircleButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy }}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      testID={testID}
    >
      {children ?? (icon ? <Feather name={icon} size={sizes.icon} color={colors.textPrimary} /> : null)}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lifted,
  },
  buttonPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
});
