/**
 * WHAT:  MapSearchPill — the floating pill at the top of the map that opens the
 *        search surface. Shows the "Search make or model" placeholder when no
 *        search is active, or the active-search summary ("Blue BMW · £500+")
 *        with a clear (×) button when one is.
 * WHY:   The map's single entry into the unified search surface (mirrors the
 *        feed's FeedTopBar), and the persistent readout of what's filtering the
 *        map — Airbnb's active-search chip. Tapping the body reopens the surface
 *        to refine; the × clears back to the full active set without opening it.
 * LINKS: src/features/search-map/components/SearchSheet.tsx (what it opens);
 *        src/features/search-map/screens/MapSearchScreen.tsx (host);
 *        src/features/search-map/components/FeedTopBar.tsx (feed sibling).
 */

import { Feather } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, opacity, radii, shadows, sizes, spacing, typography } from '@/shared/theme';

export interface MapSearchPillProps {
  /** The active-search summary, or null/'' when nothing is filtered. */
  summary: string | null;
  /** Open the search surface. */
  onPress: () => void;
  /** Clear the active search (only shown when a summary is present). */
  onClear: () => void;
}

export const MapSearchPill = memo(function MapSearchPill({
  summary,
  onPress,
  onClear,
}: MapSearchPillProps) {
  const active = Boolean(summary && summary.trim());
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? `Search: ${summary}. Edit search` : 'Search make or model'}
        onPress={onPress}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <Feather name="search" size={sizes.iconSm} color={colors.textPrimary} />
        <Text
          numberOfLines={1}
          style={[styles.label, !active && styles.placeholder]}
        >
          {active ? summary : 'Search make or model'}
        </Text>
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={spacing.sm}
            onPress={onClear}
            style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
          >
            <Feather name="x" size={sizes.iconSm} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    // The screen positions this absolutely; it owns only its own width.
    flex: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    minHeight: sizes.control,
    paddingHorizontal: spacing.lg,
    ...shadows.lifted,
  },
  pillPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  label: {
    ...typography.label,
    color: colors.textPrimary,
    flex: 1,
  },
  placeholder: {
    color: colors.textSecondary,
  },
  clear: {
    // Full 44pt target; negative margin pulls it to the pill's edge without
    // inflating the pill height (the target overlaps the pill's padding).
    minWidth: sizes.touchTarget,
    minHeight: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.md,
  },
  clearPressed: {
    opacity: opacity.pressed,
  },
});
