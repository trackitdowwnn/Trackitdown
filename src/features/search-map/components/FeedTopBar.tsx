/**
 * WHAT:  FeedTopBar — the feed's floating search pill, alone at the very
 *        top of the screen with its icon + label centred.
 * WHY:   The mobile-reference layout: the pill IS the top of the feed (no
 *        page title above it — location context lives in the first
 *        section's FeedAreaHeader). It's a fake input (a button) because
 *        v1 search lives on the search-map screen, not inline.
 * LINKS: src/features/search-map/components/FeedAreaHeader.tsx (where the
 *        area control went); src/features/search-map/README.md (anatomy);
 *        docs/DESIGN_SYSTEM.md (tokens).
 */

import { Feather } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, sizes, spacing, typography } from '@/shared/theme';

export interface FeedTopBarProps {
  onPressSearch: () => void;
}

export const FeedTopBar = memo(function FeedTopBar({ onPressSearch }: FeedTopBarProps) {
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search make, model or plate"
        onPress={onPressSearch}
        style={({ pressed }) => [styles.searchPill, pressed && styles.searchPillPressed]}
      >
        <Feather name="search" size={sizes.iconSm} color={colors.textPrimary} />
        <Text style={styles.searchPlaceholder}>Search make, model or plate</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centred icon+label — the reference pill reads as an invitation, not
    // an input field.
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    minHeight: sizes.control,
    paddingHorizontal: spacing.lg,
    ...shadows.soft,
  },
  searchPillPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  searchPlaceholder: {
    ...typography.label,
    color: colors.textPrimary,
  },
});
