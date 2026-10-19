/**
 * WHAT:  "What they saw" on the owner's sighting page — the page's first
 *        section since 2026-10-19 (owner: evidence first): every one of the
 *        owner's marks the spotter was asked about, the ones they could see
 *        ticked ("Seen 1 of 3") — or, for an older report, the seen ones alone
 *        ("Your marks they could see"; markChecklist says which); then the
 *        spotter's answers as labelled rows
 *        ("What it was doing — Parked · Looks settled"); then their note under
 *        "In their words" (set apart by a rule).
 * WHY:   The marks are the report wizard's own "Could you see any of these?"
 *        list, read back in the SAME rows (MarkTile, read-only) with the same
 *        ticks — the owner asked to see it exactly as the spotter answered it,
 *        unseen marks included (2026-10-19). Until then only the seen ones
 *        were listed, and the owner couldn't tell "they didn't see the dent"
 *        from "the dent isn't on my listing".
 *
 *        The rows used to be one dense unlabelled line ("Parked · Looks
 *        settled · Heading north · 2 people nearby") and an unlabelled
 *        paragraph (2026-10-08, "hard to read and understand"). They use the
 *        SAME labels the spotter checked before sending (sightingDetailRows),
 *        so both sides read one account of the sighting. Only answered
 *        questions appear.
 * LINKS: ./MarkTile.tsx; ../lib/markChecklist.ts (which marks, seen or not);
 *        src/features/sightings/lib/contextLabels.ts (sightingDetailRows);
 *        src/features/sightings/screens/SightingDetailScreen.tsx.
 */

import { StyleSheet, Text, View } from 'react-native';

import { sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { sightingDetailRows } from '../lib/contextLabels';
import type { MarkChecklist } from '../lib/markChecklist';
import type { OwnerSighting } from '../types';
import { MarkTile } from './MarkTile';

export interface SightingSeenSectionProps {
  sighting: OwnerSighting;
  /** The marks to list, seen or not, and whether that is all of the ones the
   *  spotter was asked about (markChecklist). */
  marks: MarkChecklist;
}

/** True when there is anything for this section to show. Offered marks always
 *  list — "none of them seen" is an answer too. */
export function hasSeenDetails(sighting: OwnerSighting, marks: MarkChecklist): boolean {
  return (
    marks.checks.length > 0 ||
    sightingDetailRows(sighting).length > 0 ||
    Boolean(sighting.note?.trim())
  );
}

/** The marks, the spotter's answers and their note — see the header. */
export function SightingSeenSection({ sighting, marks }: SightingSeenSectionProps) {
  const styles = useThemedStyles(makeStyles);
  const rows = sightingDetailRows(sighting);
  const note = sighting.note?.trim();
  const { checks, complete } = marks;
  const seen = checks.filter((check) => check.seen).length;

  return (
    <View style={styles.root}>
      {/* FIRST (owner: evidence first): the strongest identity signal a
          report can carry — "it really is my car". */}
      {checks.length > 0 ? (
        <View style={styles.marks} testID="sighting-marks">
          {/* Short: the section title already says "What they saw". A total
              only when it is one — the seen ones alone claim none. */}
          <Text style={styles.rowLabel}>
            {complete ? `Seen ${seen} of ${checks.length}` : 'Your marks they could see'}
          </Text>
          <View style={styles.markTiles}>
            {checks.map(({ mark, seen: isSeen }) => (
              <MarkTile
                key={mark.id}
                description={mark.description}
                photoUrl={mark.photoUrl}
                selected={isSeen}
                testID={`seen-mark-${mark.id}`}
              />
            ))}
          </View>
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
    // The label sits on its list like the rows' labels on their values (xs);
    // the tiles keep the wizard's own spacing (sightingSteps' markTiles).
    marks: {
      gap: spacing.xs,
    },
    markTiles: {
      gap: spacing.sm,
    },
  });
