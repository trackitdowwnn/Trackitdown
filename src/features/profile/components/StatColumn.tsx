/**
 * WHAT:  StatColumn — the passport-style stat rows: a big number over a
 *        one-word caption label, hairlines between rows only (not above the
 *        first or below the last). Stacked by default; `horizontal` lays the
 *        same cells side by side for the spotter story's stat strip.
 * WHY:   The reference's trust scaffold presents counters as
 *        number-over-label stat rows at roughly 2:1 scale
 *        (docs/design-refs/profile/REFERENCE_SPEC.md §1b, §2) — where bare
 *        narrative reads as story, stats read as record; the profile hero and
 *        the public passport sheet use both. Rows arrive pre-filtered by
 *        passportStats (nonzero only — degrade by omission), so this
 *        component never decides what to hide.
 * LINKS: src/features/profile/lib/reputation.ts (passportStats);
 *        components/ProfileHeroCard.tsx, components/PublicProfileSheet.tsx
 *        (consumers); docs/DESIGN_SYSTEM.md.
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, displayFontScaleCap, spacing, typography } from '@/shared/theme';

import type { StatRowItem } from '../lib/reputation';

export function StatColumn({
  stats,
  horizontal = false,
  testID,
}: {
  stats: StatRowItem[];
  /** Lay the stats out side by side (hairlines between cells) instead of
   *  stacked — the spotter story's full-width strip. */
  horizontal?: boolean;
  testID?: string;
}) {
  return (
    <View style={horizontal ? styles.strip : styles.column} testID={testID}>
      {stats.map((stat, index) => (
        <View
          key={stat.key}
          style={
            horizontal
              ? [styles.cell, index > 0 && styles.cellDivided]
              : [styles.row, index > 0 && styles.rowDivided]
          }
          accessible
          accessibilityLabel={stat.spoken}
          testID={`stat-${stat.key}`}
        >
          <Text style={styles.value} maxFontSizeMultiplier={displayFontScaleCap}>
            {stat.value}
          </Text>
          <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={displayFontScaleCap}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    justifyContent: 'center',
  },
  // No gap: the value/label line-heights (26 + 18) already breathe, and the
  // 4pt scale doesn't subdivide.
  row: {
    paddingVertical: spacing.sm,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  // Equal-width centred cells so two or three stats always balance.
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  cellDivided: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  // ~2:1 value-to-label scale (reference: 22pt w600 over 10pt) on our
  // nearest tokens: sectionTitle 20 SemiBold over caption 13.
  value: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
