/**
 * WHAT:  "What they saw" on the owner's sighting page — the page's first
 *        section since 2026-10-19 (owner: evidence first): every one of the
 *        owner's marks the spotter was asked about, the ones they could see
 *        ticked ("Seen 1 of 3") — or, for an older report, the seen ones alone
 *        ("Your marks they could see"; markChecklist says which); then each
 *        question they answered, in the report's own words, with what they
 *        chose as chips ("What was it doing?" — [Parked] [Looks settled]);
 *        then their note under "In their words" (set apart by a rule).
 * WHY:   Both halves read back the report wizard the way the spotter filled
 *        it in (owner, 2026-10-19):
 *        - the marks in the SAME rows (MarkTile, read-only) with the same
 *          ticks, unseen marks included — so "they didn't see the dent" and
 *          "the dent isn't on my listing" no longer look alike;
 *        - the answers as the chips they tapped, under the questions they
 *          were asked — ONLY the chosen ones (owner's pick): unlike a mark,
 *          an option nobody chose says nothing ("not Driving" is noise).
 *          Skipped and "Not sure" store nothing, so those questions aren't
 *          here at all.
 *        Before that the answers were caption/text rows (2026-10-08), and
 *        before THAT one dense unlabelled line ("Parked · Looks settled ·
 *        Heading north · 2 people nearby").
 *
 *        A follow-up rides in its question's group as its own chip ([Parked]
 *        [Looks settled], [Moving] [Heading north-east]) — the compass
 *        direction never was a chip in the wizard, but here it is an answer
 *        like the rest, and one block per question reads faster than the
 *        wizard's indented follow-ups.
 *
 *        ⚠️ THE CHIPS ARE NOT CONTROLS. They wear ChoiceChips' selected look
 *        but are plain text in a box: no radio/checkbox role, nothing to
 *        press, and each question is ONE screen-reader stop that reads as a
 *        statement ("What was it doing? Parked, Looks settled").
 * LINKS: ./MarkTile.tsx; ../lib/markChecklist.ts (which marks, seen or not);
 *        ../lib/contextLabels.ts (sightingAnswerGroups, CONTEXT_QUESTIONS);
 *        src/shared/ui/ChoiceChips.tsx (the look the answer chips copy);
 *        src/features/sightings/screens/SightingDetailScreen.tsx.
 */

import { StyleSheet, Text, View } from 'react-native';

import { radii, sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { sightingAnswerGroups } from '../lib/contextLabels';
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
    sightingAnswerGroups(sighting).length > 0 ||
    Boolean(sighting.note?.trim())
  );
}

/** "What was it doing? Parked, Looks settled" / "Its condition: Damage
 *  visible" — a question that isn't phrased as one still gets a break, so
 *  the screen reader doesn't run it into the answer. */
function spokenAnswer(question: string, answers: readonly string[]): string {
  return `${question}${question.endsWith('?') ? '' : ':'} ${answers.join(', ')}`;
}

/** The marks, the spotter's answers and their note — see the header. */
export function SightingSeenSection({ sighting, marks }: SightingSeenSectionProps) {
  const styles = useThemedStyles(makeStyles);
  const groups = sightingAnswerGroups(sighting);
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
          <Text style={styles.label}>
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

      {groups.map((group) => (
        // One stop per question, read as a statement — see the header.
        <View
          key={group.key}
          style={styles.group}
          accessible
          accessibilityLabel={spokenAnswer(group.question, group.answers)}
          testID={`seen-${group.key}`}
        >
          <Text style={styles.label}>{group.question}</Text>
          <View style={styles.chips}>
            {group.answers.map((answer, index) => (
              // Indexed: a legacy or direct-RPC row can repeat a flag, and
              // the answers are shown as stored, never deduped.
              <View key={`${index}-${answer}`} style={styles.chip}>
                <Text style={styles.chipLabel}>{answer}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {note ? (
        <View style={styles.note} testID="seen-note">
          <Text style={styles.label}>In their words</Text>
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
    // Every block's quiet label — the marks' count, each question, the note.
    label: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // The label sits on what it labels (xs); the tiles keep the wizard's own
    // spacing (sightingSteps' markTiles).
    marks: {
      gap: spacing.xs,
    },
    markTiles: {
      gap: spacing.sm,
    },
    group: {
      gap: spacing.xs,
    },
    // ChoiceChips' own row and SELECTED chip, token for token (plus centred
    // text for large-text wraps, below), so an answer
    // looks exactly like the chip the spotter tapped. Wraps at large text.
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    chip: {
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.sm,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Centred, so a long answer that wraps at large text stays one block.
    chipLabel: {
      ...typography.label,
      color: c.textOnPrimary,
      textAlign: 'center',
    },
    // Their words, set apart by a rule rather than quote marks (which hang on
    // a wrapped note) — the design system's inline-quote form.
    note: {
      gap: spacing.xs,
      borderLeftWidth: sizes.followUpRule,
      borderLeftColor: c.border,
      paddingLeft: spacing.md,
    },
    noteText: {
      ...typography.body,
      color: c.textPrimary,
    },
  });
