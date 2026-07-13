/**
 * WHAT:  FeaturesGrid — the Airbnb-amenities-style icon grid of a car's
 *        checkable distinguishing features (dents, roof rack, tinted windows…).
 * WHY:   Structured features (the Part 2 taxonomy) read faster than a prose
 *        list and, being keyed, feed future search filters. Icon + label per
 *        item, two-up; renders nothing when a post has no features (old posts).
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        supabase vehicle_feature / post_feature tables.
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, sizes, spacing, typography } from '@/shared/theme';

import type { VehicleFeature } from '../types';

type FeatherName = ComponentProps<typeof Feather>['name'];

export interface FeaturesGridProps {
  features: VehicleFeature[];
}

export function FeaturesGrid({ features }: FeaturesGridProps) {
  return (
    <View style={styles.grid}>
      {features.map((feature) => (
        <View key={feature.key} style={styles.item} accessible accessibilityLabel={feature.label}>
          <Feather
            name={feature.icon as FeatherName}
            size={sizes.iconSm}
            color={colors.textSecondary}
            importantForAccessibility="no"
          />
          <Text style={styles.label} numberOfLines={2}>
            {feature.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    columnGap: spacing.sm,
  },
  item: {
    // Two columns (the columnGap above sits between them).
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
});
