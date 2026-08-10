/**
 * WHAT:  StatBand — equal-width stat cells split by vertical hairlines, each a
 *        number over a caption. Renders nothing when it has no cells.
 * WHY:   The reference's stat module, measured in
 *        docs/design-refs/post-detail/REFERENCE_SPEC.md §"Stat module": two
 *        cells split by a VERTICAL hairline, bold number over caption. That
 *        entry ends "no analogue component — candidate pattern for
 *        bounty/sightings/days-active stat band", written before this screen
 *        existed and describing it exactly.
 *
 *        Number ~2× the label, hairline between cells only — the same anatomy
 *        profile/REFERENCE_SPEC measured on the passport card and StatColumn
 *        already implements for profiles. NOT imported from features/profile:
 *        that would couple two features, and StatColumn takes its own row type
 *        with its own reputation semantics.
 *
 *        DEGRADE BY OMISSION. The caller passes only the cells it actually
 *        has — the reference's sparse profiles "keep the card, drop absent
 *        sections entirely; no placeholders, no zeros". One cell is a valid
 *        band; zero cells renders nothing rather than an empty rule.
 * LINKS: docs/design-refs/post-detail/REFERENCE_SPEC.md (the measurement);
 *        src/features/profile/components/StatColumn.tsx (same anatomy, its
 *          own feature's semantics);
 *        src/features/vehicles/screens/PostStatsScreen.tsx (only consumer —
 *          promote to shared/ui when a second one appears, per the NudgeRow
 *          precedent).
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  displayFontScaleCap,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

export interface StatBandCell {
  key: string;
  /** Already formatted — the band never decides how a number reads. */
  value: string;
  label: string;
  /** What a screen reader says for the whole cell, e.g. "128 spotters alerted". */
  spoken: string;
}

export function StatBand({ cells }: { cells: StatBandCell[] }) {
  const styles = useThemedStyles(makeStyles);
  if (cells.length === 0) {
    return null;
  }
  return (
    <View style={styles.band}>
      {cells.map((cell, index) => (
        <View
          key={cell.key}
          style={[styles.cell, index > 0 && styles.cellDivided]}
          // ONE node per cell: a number and its label swiped separately are a
          // figure that means nothing followed by a label with nothing to label.
          accessible
          accessibilityLabel={cell.spoken}
          testID={`stat-${cell.key}`}
        >
          <Text style={styles.value} maxFontSizeMultiplier={displayFontScaleCap}>
            {cell.value}
          </Text>
          {/* Two lines, and NO font cap. "spotters alerted" at caption size is
              ~135dp against a 136dp cell on a 320dp phone, so one line clipped
              it at the default text size before Dynamic Type was involved. The
              cap belongs on the value (a hero number with a shape to keep), not
              on a caption inside a ScrollView with nothing to overflow — the
              band is `alignItems: 'stretch'`, so the divider still runs full
              height when one label wraps and the other does not. */}
          <Text style={styles.label} numberOfLines={2}>
            {cell.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  // Equal-width so two cells always balance, whatever the digits.
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  cellDivided: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: c.border,
  },
  // ~2:1 value-to-label — the measured reference ratio (22pt over 10pt) on our
  // nearest tokens. sectionTitle, NOT display: display is the app's
  // celebration size and this page is not a celebration.
  value: {
    ...typography.sectionTitle,
    color: c.textPrimary,
  },
  label: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
