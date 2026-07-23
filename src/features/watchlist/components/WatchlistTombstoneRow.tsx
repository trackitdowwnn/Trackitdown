/**
 * WHAT:  WatchlistTombstoneRow — the "this post you watched has closed" row:
 *        thumbnail (or placeholder), colour + make + model, StatusBadge, and
 *        a quiet closed line. Not pressable — the post is gone from public
 *        reads; there is nowhere truthful to navigate.
 * WHY:   Watching a car and never learning the outcome is the failure mode
 *        the resolved section exists to prevent. The row renders ONLY what
 *        the tombstone payload carries (no plate, no bounty, no location —
 *        the DOMAIN carve-out exposes less than the post's public era).
 * LINKS: src/features/watchlist/types.ts (WatchedTombstone);
 *        supabase/migrations/20260722100000_watchlist.sql (payload rules).
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { AppImage, StatusBadge } from '@/shared/ui';

import type { WatchedTombstone } from '../types';

export const WatchlistTombstoneRow = memo(function WatchlistTombstoneRow({
  entry,
}: {
  entry: WatchedTombstone;
}) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${entry.colour} ${entry.make} ${entry.model}, no longer listed`}
    >
      <View style={styles.thumb}>
        {entry.thumbnailUrl ? (
          <AppImage uri={entry.thumbnailUrl} style={styles.thumbImage} />
        ) : null}
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>
          {entry.make} {entry.model}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {entry.colour} · no longer listed
        </Text>
      </View>
      <StatusBadge status={entry.status} />
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  thumb: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
