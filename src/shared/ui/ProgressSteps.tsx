/**
 * WHAT:  ProgressSteps — a short vertical tracker: each step is done, in
 *        progress, or still to come, with a line joining them and one quiet
 *        sentence under the step that is happening now.
 * WHY:   Owner request (2026-10-13): money moves through several hands here —
 *        our steps, Stripe's check, the release — and nothing showed someone
 *        WHERE they were in it. A pill says the state; this says the journey,
 *        so "Being checked" reads as step two of four rather than a wall.
 *
 *        MONOCHROME, like every selection mark in the app: done is an ink disc
 *        with a check, in progress an ink ring round a dot, still to come a
 *        quiet ring. No green — "done" here is not "succeeded", only "behind
 *        you", and the scheme keeps its one status hue for the pill.
 *
 *        THE CURRENT STEP LEADS: its label is the bold one. Done steps sit back
 *        in body weight (still ink — they happened), steps to come in grey, so
 *        "now" is the first thing read without reading the markers at all.
 *
 *        Static, on purpose: no pulsing "current" dot. Motion here would say
 *        "something is happening right now" about a check that can take a day.
 *
 *        ONE ACCESSIBLE STOP PER STEP, reading "Step 2 of 4, ID check,
 *        in progress. Usually a few minutes." — the marker alone can't be
 *        seen by a screen reader, so the state is spoken in words.
 * LINKS: src/features/payments/screens/PayoutsScreen.tsx (first consumer);
 *        docs/DESIGN_SYSTEM.md (Core components).
 */

import { Check } from 'lucide-react-native';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';

export type ProgressStepState = 'done' | 'current' | 'upcoming';

export interface ProgressStep {
  /** Stable id — the React key and the testID suffix. */
  id: string;
  /** A noun phrase — "Your details", "ID check" — never a claim like
   *  "Sent": the marker and the spoken state carry where it has got to. */
  label: string;
  state: ProgressStepState;
  /** One sentence under the label — say it for the CURRENT step; it is how
   *  "how long" and "who is waiting on whom" get said. */
  detail?: string;
}

export interface ProgressStepsProps {
  steps: ProgressStep[];
  /** Prefixes every step's testIDs, so two trackers on a screen never clash. */
  testID?: string;
}

const STATE_WORDS: Record<ProgressStepState, string> = {
  done: 'done',
  current: 'in progress',
  upcoming: 'not started',
};

/** The marker: the timeline rail's column, so the app's two rails agree. */
const MARKER = sizes.timelineRailColumn;
const STROKE = sizes.timelineRailStroke;

/** Each state's label type — the current step leads (see the header). */
const LABEL_TYPE: Record<ProgressStepState, { lineHeight: number }> = {
  done: typography.body,
  current: typography.cardTitle,
  upcoming: typography.body,
};

export function ProgressSteps({ steps, testID }: ProgressStepsProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // ⚠️ THE MARKER SITS ON THE LABEL'S FIRST LINE AT ANY TEXT SIZE. The line box
  // is `lineHeight × fontScale` while the marker stays 24pt, so a constant
  // offset rode the marker up to the cap tops at 2× (UI review, 2026-10-13 —
  // the trap SightingEntryCard's useEntryCardFirstLineY already solved).
  // Whichever is shorter is pushed down to centre on the other.
  const { fontScale } = useWindowDimensions();

  return (
    <View accessibilityRole="list" testID={testID}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const firstLine = LABEL_TYPE[step.state].lineHeight * (fontScale ?? 1);
        const markerOffset = Math.max(0, (firstLine - MARKER) / 2);
        const textOffset = Math.max(0, (MARKER - firstLine) / 2);
        const markerID = `${testID ?? 'step'}-${step.state}-${step.id}`;
        const spoken = [
          `Step ${index + 1} of ${steps.length}, ${step.label}, ${STATE_WORDS[step.state]}.`,
          step.detail,
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <View
            key={step.id}
            style={styles.row}
            accessible
            accessibilityLabel={spoken}
            testID={testID ? `${testID}-${step.id}` : undefined}
          >
            <View style={styles.rail}>
              <View style={{ marginTop: markerOffset }}>
                {step.state === 'done' ? (
                  <View style={[styles.marker, styles.markerDone]} testID={markerID}>
                    <Check
                      size={sizes.progressStepCheck}
                      color={palette.textOnPrimary}
                      strokeWidth={3}
                    />
                  </View>
                ) : step.state === 'current' ? (
                  <View style={[styles.marker, styles.markerCurrent]} testID={markerID}>
                    <View style={styles.markerDot} />
                  </View>
                ) : (
                  <View style={[styles.marker, styles.markerUpcoming]} testID={markerID} />
                )}
              </View>
              {/* The line to the next step, inked once this step is behind
                  them — so the filled part of the rail is the way they came. */}
              {last ? null : (
                <View style={[styles.line, step.state === 'done' ? styles.lineDone : null]} />
              )}
            </View>
            <View
              style={[styles.text, { paddingTop: textOffset }, last ? null : styles.textSpaced]}
            >
              <Text style={[styles.label, styles[`label_${step.state}`]]}>{step.label}</Text>
              {step.detail ? <Text style={styles.detail}>{step.detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    rail: {
      alignItems: 'center',
      width: MARKER,
    },
    marker: {
      width: MARKER,
      height: MARKER,
      borderRadius: radii.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markerDone: {
      backgroundColor: c.primary,
    },
    markerCurrent: {
      borderWidth: STROKE,
      borderColor: c.primary,
    },
    markerDot: {
      width: sizes.progressDot,
      height: sizes.progressDot,
      borderRadius: radii.full,
      backgroundColor: c.primary,
    },
    markerUpcoming: {
      borderWidth: STROKE,
      // ≥3:1 on the page — a ring that must be seen to mean anything.
      borderColor: c.borderStrong,
    },
    // Grows with the step's text, so a two-line detail never breaks the rail.
    // `borderStrong`, as the wizard's unfilled track: `border` all but vanished
    // on a card, and in dark mode entirely.
    line: {
      flex: 1,
      width: STROKE,
      minHeight: spacing.md,
      marginVertical: spacing.xs,
      backgroundColor: c.borderStrong,
    },
    lineDone: {
      backgroundColor: c.primary,
    },
    text: {
      flex: 1,
      gap: spacing.xs,
    },
    textSpaced: {
      paddingBottom: spacing.lg,
    },
    label: {
      color: c.textPrimary,
    },
    label_done: {
      ...typography.body,
    },
    label_current: {
      ...typography.cardTitle,
    },
    label_upcoming: {
      ...typography.body,
      color: c.textSecondary,
    },
    detail: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });
