/**
 * WHAT:  CollectionTile — one square in the Watchlist grid: cover photo, list
 *        name, and how many cars are in it.
 * WHY:   A list the user just made is empty by definition, and that empty tile
 *        is the FIRST thing they see after the feature's key action — so the
 *        no-cover state is a designed placeholder rather than a blank frame or
 *        a broken image. Width comes from the caller (the grid measures once)
 *        so every tile in a row is identical regardless of screen size.
 * LINKS: src/features/watchlist/screens/CollectionsGridScreen.tsx;
 *        src/features/watchlist/lib/collectionsModel.ts (the tile data);
 *        src/shared/ui/VehicleCard.tsx (the photo-fallback precedent).
 */

import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  radii,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage } from '@/shared/ui';

import type { CollectionTile as CollectionTileData } from '../lib/collectionsModel';

export interface CollectionTileProps {
  tile: CollectionTileData;
  /** Measured once by the grid so a row's tiles can't disagree by a pixel. */
  width: number;
  onPress: () => void;
}

function carCount(count: number): string {
  return count === 1 ? '1 car' : `${count} cars`;
}

export function CollectionTile({ tile, width, onPress }: CollectionTileProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <Pressable
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${tile.name}, ${carCount(tile.count)}`}
      testID={`collection-tile-${tile.routeId}`}
    >
      <View style={[styles.cover, { width, height: width }]}>
        {tile.coverUrl === null ? (
          // Deliberately calm: a just-made list is empty, and this is the state
          // right after the user's key action. It must read as "ready", never
          // as a failed image.
          <View style={styles.placeholder}>
            <Feather name="bookmark" size={typography.display.fontSize} color={palette.textSecondary} />
          </View>
        ) : (
          <AppImage uri={tile.coverUrl} recyclingKey={tile.routeId} style={styles.photo} />
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {tile.name}
      </Text>
      <Text style={styles.count}>{carCount(tile.count)}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  pressed: {
    opacity: 0.85,
  },
  cover: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: c.surfaceSubtle,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    ...typography.body,
    color: c.textPrimary,
    paddingTop: spacing.sm,
  },
  count: {
    ...typography.caption,
    color: c.textSecondary,
    paddingTop: spacing.xs,
  },
});
