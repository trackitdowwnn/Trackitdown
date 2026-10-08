/**
 * WHAT:  "What they saw" on the owner's sighting page: the spotter's answers
 *        as labelled rows ("What it was doing — Parked · Looks settled"),
 *        then their note under "In their words", then the owner's own
 *        distinctive marks they said they could see, as a check list.
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
  radii,
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
          <Text style={styles.noteText}>“{note}”</Text>
        </View>
      ) : null}

      {/* The strongest identity signal a report can carry — "it really is my
          car" — so it reads as a confirmation, with ticks. */}
      {sighting.confirmedFeatures.length > 0 ? (
        <View style={styles.marks} testID="confirmed-marks">
          <Text style={styles.marksTitle}>Your marks they could see</Text>
          {sighting.confirmedFeatures.map((mark) => (
            <View key={mark.id} style={styles.markRow}>
              <Feather name="check" size={sizes.iconSm} color={palette.primary} />
              <Text style={styles.markText}>{mark.description}</Text>
            </View>
          ))}
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
    note: {
      gap: spacing.xs,
    },
    noteLabel: {
      ...typography.caption,
      color: c.textSecondary,
    },
    noteText: {
      ...typography.prose,
      color: c.textPrimary,
    },
    marks: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    marksTitle: {
      ...typography.label,
      color: c.textPrimary,
    },
    markRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    markText: {
      ...typography.body,
      color: c.textPrimary,
      flexShrink: 1,
    },
  });
