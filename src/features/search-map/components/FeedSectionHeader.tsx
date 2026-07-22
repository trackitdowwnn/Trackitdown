/**
 * WHAT:  FeedSectionHeader — a feed section's title row: sectionTitle-size
 *        text with, when the section links somewhere, a circled chevron
 *        sitting directly beside the title (the reference feed's "see all"
 *        affordance).
 * WHY:   Recycled FlashList row: derives everything from props, holds no
 *        state. The chevron sits right-aligned at the row's end (mobile-
 *        reference pattern) — one glance, one tap target. Area carousels
 *        and near_you get it (see-all / change-area); other headers stay
 *        calm.
 * LINKS: src/features/search-map/lib/feedSections.ts (flattening);
 *        docs/DESIGN_SYSTEM.md (sectionTitle, touch targets).
 */

import { Feather } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';

export interface FeedSectionHeaderProps {
  title: string;
  /** Area carousels: navigates to search-map. Near you: opens the area
   *  picker (same calm chevron — one affordance style for every section). */
  onSeeAll?: () => void;
  /** Screen-reader label for the chevron; defaults to "See all — <title>".
   *  Near you passes "Change area" — its chevron doesn't navigate away. */
  seeAllAccessibilityLabel?: string;
}

export const FeedSectionHeader = memo(function FeedSectionHeader({
  title,
  onSeeAll,
  seeAllAccessibilityLabel,
}: FeedSectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {onSeeAll ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={seeAllAccessibilityLabel ?? `See all — ${title}`}
          onPress={onSeeAll}
          style={styles.seeAll}
          hitSlop={spacing.sm}
        >
          <View style={styles.chevronCircle}>
            <Feather name="chevron-right" size={sizes.iconSm} color={colors.textPrimary} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Chevron right-aligned at the row's end (mobile-reference pattern).
    justifyContent: 'space-between',
    gap: spacing.sm,
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception; the
    // xxl above gives sections the reference feed's breathing room.
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  seeAll: {
    minHeight: sizes.touchTarget,
    minWidth: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronCircle: {
    width: sizes.circleButtonSm,
    height: sizes.circleButtonSm,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
