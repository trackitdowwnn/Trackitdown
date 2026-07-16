/**
 * WHAT:  AppImage — the app's image primitive: expo-image with our defaults
 *        baked in (thumbhash placeholder passthrough, 200ms fade-in,
 *        surfaceSubtle backdrop while loading, recyclingKey for list reuse).
 * WHY:   Photos recur across every surface (cards, post detail, sightings,
 *        chat); one wrapper keeps placeholder/transition behaviour
 *        consistent and gives a single place to tune caching later. Kept
 *        deliberately thin — it adds defaults, not abstraction.
 * LINKS: src/shared/ui/VehicleCard.tsx (first consumer); expo-image docs;
 *        docs/DESIGN_SYSTEM.md (Loading, Motion).
 *
 * Usage:
 *   <AppImage
 *     uri={photo.uri}
 *     thumbhash={photo.thumbhash}
 *     recyclingKey={post.id}
 *     style={styles.photo}
 *   />
 */

import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { StyleSheet, type StyleProp } from 'react-native';

import { colors, motion } from '../theme';

export interface AppImageProps {
  uri: string;
  /** Thumbhash placeholder shown while the full image loads. */
  thumbhash?: string;
  /** Stable identity for recycled list rows (FlashList/FlatList). */
  recyclingKey?: string;
  contentFit?: ImageContentFit;
  style?: StyleProp<ImageStyle>;
  /** Images are decorative by default; pass a label to expose one. */
  accessibilityLabel?: string;
  /** Load failure — callers with a non-photo fallback (e.g. the tab-bar
   *  avatar reverting to its icon) switch on this. */
  onError?: () => void;
  testID?: string;
}

/** expo-image with the app's placeholder/transition/recycling defaults. */
export function AppImage({
  uri,
  thumbhash,
  recyclingKey,
  contentFit = 'cover',
  style,
  accessibilityLabel,
  onError,
  testID,
}: AppImageProps) {
  return (
    <Image
      source={{ uri }}
      placeholder={thumbhash ? { thumbhash } : undefined}
      recyclingKey={recyclingKey}
      contentFit={contentFit}
      transition={motion.fast}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      style={[styles.base, style]}
      onError={onError}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceSubtle,
  },
});
