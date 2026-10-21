/**
 * WHAT:  The owner's sighting page's two evidence sections, each under its
 *        own title (the screen's Section):
 *        - "What they saw" (SightingMarks) — the page's first section since
 *          2026-10-19 (owner: evidence first): every one of the owner's marks
 *          the spotter was asked about, the ones they could see ticked ("Seen
 *          1 of 3") — or, for an older report, the seen ones alone ("Your
 *          marks they could see"; markChecklist says which);
 *        - "Details" (SightingDetails; owner, 2026-10-20: "a title above the
 *          table just like the What they saw") — the spotter's answers as a
 *          small TABLE, label | answers, one row per question they answered
 *          (Doing | Parked · Looks settled), their words about the damage as
 *          a short quote just under it ("About the damage", 2026-10-21) and
 *          their words about what's missing likewise ("About what's
 *          missing"), then
 *          their note under "In their words" (set apart by a rule).
 * WHY:   - The marks read back the report wizard the way the spotter filled
 *          it in (owner, 2026-10-19): the SAME rows (MarkTile, read-only),
 *          the same ticks, unseen marks included — so "they didn't see the
 *          dent" and "the dent isn't on my listing" no longer look alike.
 *        - The answers as a table (owner, 2026-10-20: "a table look … instead
 *          of stacked on top of each other"), with the owner's picks: SHORT
 *          labels (Doing / People / Condition) so the answers keep the width,
 *          and PLAIN TEXT, not chips — nothing here is tappable, and 44pt
 *          filled chips sat heavy in a table cell. Only what was chosen:
 *          skipped and "Not sure" store nothing, so those rows aren't here.
 *          A state's follow-up stays on its line (Parked · Looks settled);
 *          conditions take a line each, the damage seen on its own ("Damage
 *          visible · Smashed window, Dents or scrapes", owner, 2026-10-21),
 *          and which parts in brackets on "Missing panels or parts"
 *          ("Missing panels or parts (Bumpers, Doors)").
 *        Before: chips under the full questions (2026-10-19), caption/text
 *        rows (2026-10-08), and before THAT one dense unlabelled line.
 *
 *        ⚠️ LARGE TEXT STACKS THE ROWS. Two columns on a 360dp phone squeeze
 *        both at big font sizes, so past listRowStackFontScale each row puts
 *        its label above its answers — the decision bar's and the maps
 *        buttons' rule. Nothing truncates at any size.
 *        Each row is ONE screen-reader stop, read as a statement ("Condition:
 *        Damage visible, Plate changed or missing").
 * LINKS: ./MarkTile.tsx; ../lib/markChecklist.ts (which marks, seen or not);
 *        ../lib/contextLabels.ts (sightingAnswerGroups, CONTEXT_SHORT_LABELS);
 *        src/features/sightings/screens/SightingDetailScreen.tsx.
 */

import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  listRowStackFontScale,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

import { sightingAnswerGroups, type ContextAnswerGroup } from '../lib/contextLabels';
import type { MarkChecklist } from '../lib/markChecklist';
import type { OwnerSighting } from '../types';
import { MarkTile } from './MarkTile';

/** True when the "Details" section has anything to show: an answered
 *  question, their words about the damage or about what's missing, or a note. */
export function hasSightingDetails(sighting: OwnerSighting): boolean {
  return (
    sightingAnswerGroups(sighting).length > 0 ||
    Boolean(sighting.damageNote?.trim()) ||
    Boolean(sighting.missingPartsNote?.trim()) ||
    Boolean(sighting.note?.trim())
  );
}

/** A row's answer lines: the state with its follow-up on ONE line ("Parked ·
 *  Looks settled" is one answer, qualified), everything else a line each. */
function answerLines(group: ContextAnswerGroup): string[] {
  return group.key === 'state' ? [group.answers.join(' · ')] : group.answers;
}

/** "What they saw": the owner's marks, seen or not — see the header. The
 *  screen shows the section only when there are marks to list. */
export function SightingMarks({ marks }: { marks: MarkChecklist }) {
  const styles = useThemedStyles(makeStyles);
  const { checks, complete } = marks;
  const seen = checks.filter((check) => check.seen).length;

  // The strongest identity signal a report can carry — "it really is my
  // car" — so it leads the page (owner: evidence first).
  return (
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
  );
}

/** "Details": the spotter's answers as a table, then their note — see the
 *  header. The screen shows the section only when hasSightingDetails. */
export function SightingDetails({ sighting }: { sighting: OwnerSighting }) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > listRowStackFontScale;
  const groups = sightingAnswerGroups(sighting);
  const note = sighting.note?.trim();
  const damageNote = sighting.damageNote?.trim();
  const partsNote = sighting.missingPartsNote?.trim();

  return (
    <View style={styles.root}>
      {groups.length > 0 || damageNote || partsNote ? (
        // The table and their words about the damage and what's missing read
        // as one block: the quotes sit close under the row they qualify.
        <View style={styles.answers}>
          {groups.length > 0 ? (
            <View testID="sighting-answers">
              {groups.map((group, index) => (
                // One stop per row, read as a statement — see the header.
                <View
                  key={group.key}
                  style={[
                    styles.row,
                    stacked && styles.rowStacked,
                    index > 0 && styles.rowDivided,
                    // The section's own rhythm frames the table: no extra padding
                    // above the first row or below the last.
                    index === 0 && styles.rowFirst,
                    index === groups.length - 1 && styles.rowLast,
                  ]}
                  accessible
                  accessibilityLabel={`${group.label}: ${group.answers.join(', ')}`}
                  testID={`seen-${group.key}`}
                >
                  <Text style={[styles.cellLabel, !stacked && styles.cellLabelColumn]}>
                    {group.label}
                  </Text>
                  <View
                    style={[styles.cellAnswers, !stacked && styles.cellAnswersColumn]}
                    testID={`seen-${group.key}-answers`}
                  >
                    {answerLines(group).map((line, lineIndex) => (
                      // Indexed: a legacy or direct-RPC row can repeat a flag, and
                      // the answers are shown as stored, never deduped.
                      <Text key={`${lineIndex}-${line}`} style={styles.answer}>
                        {line}
                      </Text>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {damageNote ? (
            <SpotterQuote label="About the damage" words={damageNote} testID="seen-damage-note" />
          ) : null}
          {partsNote ? (
            <SpotterQuote label="About what’s missing" words={partsNote} testID="seen-parts-note" />
          ) : null}
        </View>
      ) : null}

      {note ? (
        <View style={styles.note} testID="seen-note">
          <Text style={styles.label}>In their words</Text>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The spotter's own words about one answer, as a short quote under the
 *  table: one screen-reader stop, read as a statement, like a table row. */
function SpotterQuote({ label, words, testID }: { label: string; words: string; testID: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.quote} accessible accessibilityLabel={`${label}: ${words}`} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.noteText}>{words}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: spacing.xl,
    },
    // The blocks' quiet label — the marks' count, the words about the damage
    // and the note.
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
    // A table row: label | answers, top-aligned so a two-line answer cell
    // keeps its label on the first line.
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    // Large text: the label over its answers, the row otherwise the same.
    rowStacked: {
      flexDirection: 'column',
      gap: spacing.xs,
    },
    // Hairlines BETWEEN rows only — the section's own dividers frame the
    // table, so none above the first or below the last.
    rowFirst: {
      paddingTop: 0,
    },
    rowLast: {
      paddingBottom: 0,
    },
    rowDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    cellLabel: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // A fixed share of the row, so every row's answers start on one line
    // down the table — wide enough for "Condition" at normal text.
    // Side by side, the caption takes the answer's line height, so the label
    // sits on the answer's first line rather than above it.
    cellLabelColumn: {
      lineHeight: typography.body.lineHeight,
      flexBasis: '30%',
    },
    cellAnswers: {
      gap: spacing.xs,
    },
    // Side by side only: the rest of the row. (Stacked, flex: 1 in an
    // auto-height column would collapse the cell.)
    cellAnswersColumn: {
      flex: 1,
    },
    answer: {
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
    noteText: {
      ...typography.body,
      color: c.textPrimary,
    },
    // The table, then their words about the damage close beneath it (md, not
    // the section's xl): the quote belongs to the Condition row.
    answers: {
      gap: spacing.md,
    },
    // The note's inline-quote form, its text in the note's own style
    // (noteText): their words read the same wherever they appear.
    quote: {
      gap: spacing.xs,
      borderLeftWidth: sizes.followUpRule,
      borderLeftColor: c.border,
      paddingLeft: spacing.md,
    },
  });
