/**
 * WHAT:  FeaturesGrid — the Airbnb-amenities-style list of a car's checkable
 *        distinguishing features (dents, roof rack, tinted windows…): one
 *        feature per row, ink-coloured line icon + label.
 * WHY:   Structured features (the Part 2 taxonomy) read faster than a prose
 *        list and, being keyed, feed future search filters. Single column at a
 *        comfortable row height (the reference's mobile amenities pattern —
 *        the two-up grid is a web layout) so long labels never squeeze;
 *        renders nothing when a post has no features (old posts).
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        docs/design-refs/post-detail/REFERENCE_SPEC.md §6;
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
    <View style={styles.list}>
      {features.map((feature) => (
        <View key={feature.key} style={styles.item} accessible accessibilityLabel={feature.label}>
          <Feather
            name={feature.icon as FeatherName}
            size={sizes.icon}
            color={colors.textPrimary}
            importantForAccessibility="no"
          />
          <Text style={styles.label}>{feature.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  item: {
    // One feature per row; content, not metadata — ink icon at full size.
    minHeight: sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  label: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
});
