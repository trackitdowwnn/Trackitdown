/**
 * WHAT:  SearchThisAreaButton — the floating "Search this area" pill that
 *        appears when the viewport has drifted from the last search.
 * WHY:   The calm-map rule: panning never auto-refreshes; this button is
 *        the ONE way results change after entry. It shows "Searching…"
 *        while the re-search runs (results stay put behind it).
 * LINKS: src/features/search-map/hooks/useViewportPosts.ts (showSearchArea
 *        / searchThisArea); docs/DESIGN_SYSTEM.md (tokens, motion).
 */

import { Feather } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, shadows, sizes, spacing, typography } from '@/shared/theme';

export interface SearchThisAreaButtonProps {
  visible: boolean;
  searching: boolean;
  onPress: () => void;
}

export const SearchThisAreaButton = memo(function SearchThisAreaButton({
  visible,
  searching,
  onPress,
}: SearchThisAreaButtonProps) {
  if (!visible && !searching) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search this area"
      accessibilityState={{ busy: searching }}
      disabled={searching}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
    >
      <Feather name="refresh-cw" size={sizes.iconSm} color={colors.primary} />
      <Text style={styles.label}>{searching ? 'Searching…' : 'Search this area'}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.lg,
    ...shadows.lifted,
  },
  pillPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  label: {
    ...typography.label,
    color: colors.primary,
  },
});
