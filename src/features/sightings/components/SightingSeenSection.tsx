/**
 * WHAT:  "What they saw" on the owner's sighting page — the page's first
 *        section since 2026-10-19 (owner: evidence first): the owner's own
 *        distinctive marks the spotter said they could see, as ticks; then
 *        the spotter's answers as labelled rows ("What it was doing — Parked ·
 *        Looks settled"); then their note under "In their words" (set apart
 *        by a rule).
 * WHY:   It used to be one dense unlabelled line ("Parked · Looks settled ·
 *        Heading north · 2 people nearby") and an unlabelled paragraph — the
 *        owner had to work out what each part answered (2026-10-08, "hard to
 *        read and understand"). The rows use the SAME labels the spotter
 *        checked before sending (sightingDetailRows), so both sides read one
 *        account of the sighting. Only answered questions appear.
 * LINKS: src/features/sightings/lib/contextLabels.ts (sightingDetailRows);
 *        src/features/sightings/screens/SightingDetailScreen.tsx.
 */

import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import {
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

import { sightingDetailRows } from '../lib/contextLabels';
import type { OwnerSighting } from '../types';

export interface SightingSeenSectionProps {
  sighting: OwnerSighting;
}

/** True when the sighting has anything for this section to show. */
export function hasSeenDetails(sighting: OwnerSighting): boolean {
  return (
    sightingDetailRows(sighting).length > 0 ||
    Boolean(sighting.note?.trim()) ||
    sighting.confirmedFeatures.length > 0
  );
}

/** The spotter's answers, note and confirmed marks — see the header. */
export function SightingSeenSection({ sighting }: SightingSeenSectionProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const rows = sightingDetailRows(sighting);
  const note = sighting.note?.trim();

  return (
    <View style={styles.root}>
      {/* FIRST since 2026-10-19 (owner: evidence first): the strongest
          identity signal a report can carry — "it really is my car" — read
          before anything else, as ticks. A plain list under a label like the
          rows below, no longer a card of its own: the section is one account. */}
      {sighting.confirmedFeatures.length > 0 ? (
        <View style={styles.marks} testID="confirmed-marks">
          <Text style={styles.rowLabel}>Your marks they could see</Text>
          {sighting.confirmedFeatures.map((mark) => (
            // One stop per mark — never the tick glyph on its own.
            <View
              key={mark.id}
              style={styles.markRow}
              accessible
              accessibilityLabel={mark.description}
            >
              <Feather
                name="check"
                size={sizes.iconSm}
                color={palette.primary}
                style={styles.markTick}
              />
              <Text style={styles.markText}>{mark.description}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.map((row) => (
            // One accessible line per answer: "What it was doing, Parked".
            <View
              key={row.key}
              style={styles.row}
              accessible
              accessibilityLabel={`${row.label}, ${row.value}`}
              testID={`seen-${row.key}`}
            >
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {note ? (
        <View style={styles.note} testID="seen-note">
          <Text style={styles.noteLabel}>In their words</Text>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: spacing.xl,
    },
    rows: {
      gap: spacing.lg,
    },
    // Label above value, not side by side: values run long ("Parked · Looks
    // settled · Doors open") and large text would crush a two-column row.
    row: {
      gap: spacing.xs,
    },
    rowLabel: {
      ...typography.caption,
      color: c.textSecondary,
    },
    rowValue: {
      ...typography.body,
      color: c.textPrimary,
    },
    // Their words, set apart by a rule rather than quote marks (which hang on
    // a wrapped note) — the design system's inline-quote form.
    note: {
      gap: spacing.xs,
      borderLeftWidth: sizes.followUpRule,
      borderLeftColor: c.border,
      paddingLeft: spacing.md,
    },
    noteLabel: {
      ...typography.caption,
      color: c.textSecondary,
    },
    noteText: {
      ...typography.body,
      color: c.textPrimary,
    },
    // Label then ticks — the rows' own form (caption label above), so the
    // section reads as one account.
    marks: {
      gap: spacing.xs,
    },
    // Top-aligned, the tick centred on the FIRST line: on a two-line mark a
    // centred tick floats between the lines.
    markRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    markTick: {
      marginTop: (typography.body.lineHeight - sizes.iconSm) / 2,
    },
    markText: {
      ...typography.body,
      color: c.textPrimary,
      flexShrink: 1,
    },
  });
