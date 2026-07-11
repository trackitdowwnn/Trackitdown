/**
 * WHAT:  FeedAreaHeader — the near_you section's header: "Stolen cars near
 *        <Area>" with the area name tappable (→ Set my area). Replaces the
 *        old screen-level "Cars near <Area>" page title now that the search
 *        pill sits alone at the top (mobile-reference layout).
 * WHY:   The reference feed has no page title — location context lives in
 *        the first section's header, so the area-change control moves here
 *        with it. Only the area name is pressable (44pt target, screen-
 *        reader focusable) so mis-taps don't open the picker. Recycled
 *        FlashList row: derives everything from props.
 * LINKS: src/features/search-map/components/FeedSectionHeader.tsx (sibling);
 *        src/features/search-map/screens/HomeFeedScreen.tsx (renderItem
 *        special-case); docs/DESIGN_SYSTEM.md (sectionTitle, touch targets).
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, sizes, spacing, typography } from '@/shared/theme';

export interface FeedAreaHeaderProps {
  /** Short area name ("Salford"); '' falls back to a generic label. */
  areaLabel: string;
  onPressArea: () => void;
}

export const FeedAreaHeader = memo(function FeedAreaHeader({
  areaLabel,
  onPressArea,
}: FeedAreaHeaderProps) {
  const label = areaLabel || 'your area';
  return (
    <View style={styles.row}>
      {/* Hidden from screen readers — the button's label already carries
          the full sentence, so this would be spoken twice. */}
      <Text style={styles.title} accessibilityElementsHidden importantForAccessibility="no">
        Stolen cars near{' '}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Stolen cars near ${label}. Change area`}
        accessibilityHint="Opens the map to set your area"
        onPress={onPressArea}
        style={styles.areaButton}
        hitSlop={spacing.sm}
      >
        <Text style={[styles.title, styles.area]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception; the
    // xxl above matches FeedSectionHeader's section rhythm.
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  areaButton: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    flexShrink: 1,
  },
  area: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
