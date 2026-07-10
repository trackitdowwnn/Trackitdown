/**
 * WHAT:  Avatar — a user's photo in a circle, with a calm initial-letter
 *        fallback when there is no photo. Three token sizes (sm/md/lg).
 * WHY:   Faces build the trust this app runs on (spotter ↔ owner), so the
 *        avatar treatment must be identical everywhere: profile header,
 *        public spotter sheet, chat rows later. The fallback is a sage
 *        initial on surfaceSubtle — friendly, never a grey silhouette.
 *        Decorative by default; pass accessibilityLabel where the avatar is
 *        the only identification on screen.
 * LINKS: src/shared/ui/AppImage.tsx (photo rendering);
 *        src/features/profile (first consumer); docs/DESIGN_SYSTEM.md.
 *
 * Usage:
 *   <Avatar uri={profile.avatarUrl} name={profile.firstName} size="lg" />
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, typography } from '../theme';
import { AppImage } from './AppImage';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  /** Photo URL; falls back to the name initial when absent. */
  uri?: string | null;
  /** Name whose first letter becomes the fallback initial. */
  name?: string;
  size?: AvatarSize;
  /** Avatars are decorative by default; label when standalone. */
  accessibilityLabel?: string;
  testID?: string;
}

const DIAMETER: Record<AvatarSize, number> = {
  sm: sizes.avatarSm,
  md: sizes.avatarMd,
  lg: sizes.avatarLg,
};

/** Initial glyph scales with the circle: roughly half the diameter. */
const initialStyleFor = (size: AvatarSize) => ({
  fontSize: DIAMETER[size] / 2,
  lineHeight: DIAMETER[size], // vertically centres within the circle
});

export function Avatar({ uri, name, size = 'md', accessibilityLabel, testID }: AvatarProps) {
  const diameter = DIAMETER[size];
  const initial = name?.trim().charAt(0).toUpperCase() ?? '';

  return (
    <View
      style={[styles.circle, { width: diameter, height: diameter }]}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      testID={testID}
    >
      {uri ? (
        <AppImage uri={uri} style={styles.photo} />
      ) : (
        <Text style={[styles.initial, initialStyleFor(size)]} maxFontSizeMultiplier={1}>
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  initial: {
    ...typography.heading, // weight only; size/lineHeight come per-diameter
    color: colors.primary,
  },
});
