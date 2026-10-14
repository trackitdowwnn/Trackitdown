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
 *        Static BY DEFAULT: no pulsing "current" dot. Motion here would say
 *        "something is happening right now" about a check that can take a day.
 *        EXCEPT while it is true (2026-10-14, owner: "some visual that
 *        something is happening"): a step marked `working` breathes — the
 *        caller sets it only while the app is actually checking, and clears it
 *        when it stops, so the motion never outlives the claim. Reduce Motion
 *        keeps it still; the step's detail says "checking now" in words.
 *
 *        ONE ACCESSIBLE STOP PER STEP, reading "Step 2 of 4, ID check,
 *        in progress. Usually a few minutes." — the marker alone can't be
 *        seen by a screen reader, so the state is spoken in words.
 * LINKS: src/features/payments/screens/PayoutsScreen.tsx (first consumer);
 *        docs/DESIGN_SYSTEM.md (Core components).
 */

import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';

import { Button } from './Button';

/**
 * `attention` (2026-10-14): the current step is waiting on THE PERSON READING
 * — a photo ID, new bank details. Told apart from `current` by SHAPE (a "!"
 * in the ring), never by colour alone, and spoken as "needs you".
 */
export type ProgressStepState = 'done' | 'current' | 'attention' | 'upcoming';

export interface ProgressStep {
  /** Stable id — the React key and the testID suffix. */
  id: string;
  /** A noun phrase — "Your details", "ID check" — never a claim like
   *  "Sent": the marker and the spoken state carry where it has got to. */
  label: string;
  state: ProgressStepState;
  /** A date or an expectation beside the label — "13 October", "Expected
   *  by Thu 16 October" (2026-10-14). A real date on every step behind them,
   *  a cautious one on the step ahead. */
  meta?: string;
  /** One sentence under the label — say it for the CURRENT step; it is how
   *  "how long" and "who is waiting on whom" get said. */
  detail?: string;
  /** The current step's marker breathes — ONLY while something is actually
   *  being done right now (see the header). Ignored on other states. */
  working?: boolean;
  /** The ONE thing to do, under a current or attention step (2026-10-14).
   *  Outside the step's spoken stop, so a screen reader can reach it. */
  action?: { label: string; onPress: () => void; testID?: string };
}

export interface ProgressStepsProps {
  steps: ProgressStep[];
  /** Prefixes every step's testIDs, so two trackers on a screen never clash. */
  testID?: string;
  /** Names the tracker — a header above it ("Your reward"). */
  heading?: string;
  /** A finished road, as one line ("Paid 16 Oct · £190") that opens into the
   *  full list (2026-10-14). Absent: the list, always. */
  collapsed?: { summary: string; expandLabel: string };
}

const STATE_WORDS: Record<ProgressStepState, string> = {
  done: 'done',
  current: 'in progress',
  attention: 'needs you',
  upcoming: 'not started',
};

/** The marker: the timeline rail's column, so the app's two rails agree. */
const MARKER = sizes.timelineRailColumn;
const STROKE = sizes.timelineRailStroke;

/** Each state's label type — the current step leads (see the header). */
const LABEL_TYPE: Record<ProgressStepState, { lineHeight: number }> = {
  done: typography.body,
  current: typography.cardTitle,
  attention: typography.cardTitle,
  upcoming: typography.body,
};

export function ProgressSteps({ steps, testID, heading, collapsed }: ProgressStepsProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // ⚠️ THE MARKER SITS ON THE LABEL'S FIRST LINE AT ANY TEXT SIZE. The line box
  // is `lineHeight × fontScale` while the marker stays 24pt, so a constant
  // offset rode the marker up to the cap tops at 2× (UI review, 2026-10-13 —
  // the trap SightingEntryCard's useEntryCardFirstLineY already solved).
  // Whichever is shorter is pushed down to centre on the other.
  const { fontScale } = useWindowDimensions();
  // A finished road starts folded; opening it is the reader's choice.
  const [expanded, setExpanded] = useState(false);

  const header = heading ? (
    <Text style={styles.heading} accessibilityRole="header">
      {heading}
    </Text>
  ) : null;

  if (collapsed && !expanded) {
    return (
      <View testID={testID}>
        {header}
        <View style={styles.collapsedRow}>
          <View style={[styles.marker, styles.markerDone]} importantForAccessibility="no">
            <Check size={sizes.progressStepCheck} color={palette.textOnPrimary} strokeWidth={3} />
          </View>
          <Text style={styles.collapsedSummary}>{collapsed.summary}</Text>
          <Pressable
            onPress={() => setExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel={`${collapsed.expandLabel}: ${collapsed.summary}`}
            hitSlop={spacing.sm}
            testID={testID ? `${testID}-expand` : undefined}
          >
            <Text style={styles.expand}>{collapsed.expandLabel}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View testID={testID}>
      {header}
      <View accessibilityRole="list">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const firstLine = LABEL_TYPE[step.state].lineHeight * (fontScale ?? 1);
          const markerOffset = Math.max(0, (firstLine - MARKER) / 2);
          const textOffset = Math.max(0, (MARKER - firstLine) / 2);
          const markerID = `${testID ?? 'step'}-${step.state}-${step.id}`;
          const spoken = [
            `Step ${index + 1} of ${steps.length}, ${step.label}, ${STATE_WORDS[step.state]}.`,
            step.meta ? `${step.meta}.` : undefined,
            step.detail,
          ]
            .filter(Boolean)
            .join(' ');
          const showAction = step.action && (step.state === 'current' || step.state === 'attention');
          return (
            <View
              key={step.id}
              style={styles.row}
              testID={testID ? `${testID}-${step.id}` : undefined}
            >
              {/* Drawn, not read: the markers carry no text (the "!" is hidden),
                  so a screen reader passes them; the stop beside says it. */}
              <View style={styles.rail}>
                <View style={{ marginTop: markerOffset }}>
                  <Marker step={step} markerID={markerID} />
                </View>
                {/* The line to the next step, inked once this step is behind
                    them — so the filled part of the rail is the way they came. */}
                {last ? null : (
                  <View style={[styles.line, step.state === 'done' ? styles.lineDone : null]} />
                )}
              </View>
              <View style={[styles.column, last ? null : styles.textSpaced]}>
                {/* ONE accessible stop per step — the button below sits OUTSIDE
                    it, or a screen reader could never reach it (2026-10-14). */}
                <View
                  style={[styles.text, { paddingTop: textOffset }]}
                  accessible
                  accessibilityLabel={spoken}
                >
                  <View style={styles.labelRow}>
                    <Text style={[styles.label, styles[`label_${step.state}`]]}>{step.label}</Text>
                    {step.meta ? <Text style={styles.meta}>{step.meta}</Text> : null}
                  </View>
                  {step.detail ? <Text style={styles.detail}>{step.detail}</Text> : null}
                </View>
                {showAction && step.action ? (
                  <View style={styles.action} testID={step.action.testID ?? `${markerID}-action`}>
                    <Button label={step.action.label} onPress={step.action.onPress} />
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** The step's marker: done ✓, current ring (breathing when working), "!" for
 *  attention, hollow when upcoming — four SHAPES, so colour is never the cue. */
function Marker({ step, markerID }: { step: ProgressStep; markerID: string }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  if (step.state === 'done') {
    return (
      <View style={[styles.marker, styles.markerDone]} testID={markerID}>
        <Check size={sizes.progressStepCheck} color={palette.textOnPrimary} strokeWidth={3} />
      </View>
    );
  }
  if (step.state === 'current') {
    return (
      <View style={[styles.marker, styles.markerCurrent]} testID={markerID}>
        {step.working ? <WorkingDot testID={`${markerID}-working`} /> : <View style={styles.markerDot} />}
      </View>
    );
  }
  if (step.state === 'attention') {
    return (
      <View style={[styles.marker, styles.markerCurrent]} testID={markerID}>
        {/* Shape, not words: "needs you" is spoken by the step's stop. */}
        <Text style={styles.attentionGlyph} accessibilityElementsHidden importantForAccessibility="no">
          !
        </Text>
      </View>
    );
  }
  return <View style={[styles.marker, styles.markerUpcoming]} testID={markerID} />;
}

/**
 * The current marker's dot, breathing: fades and swells, slowly, for as long
 * as it is mounted — which is exactly as long as the step is `working`.
 * Reduce Motion: the plain dot, still.
 */
function WorkingDot({ testID }: { testID: string }) {
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    breath.set(
      withRepeat(
        withTiming(1, { duration: motion.progressWorking, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(breath);
  }, [breath, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: 1 - breath.get() * 0.6,
    transform: [{ scale: 1 + breath.get() * 0.35 }],
  }));

  if (reduceMotion) {
    return <View style={styles.markerDot} testID={testID} />;
  }
  return <Animated.View style={[styles.markerDot, animated]} testID={testID} />;
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
    column: {
      flex: 1,
    },
    text: {
      gap: spacing.xs,
    },
    textSpaced: {
      paddingBottom: spacing.lg,
    },
    // Label and its date share a line; at large text the date wraps under.
    labelRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
    },
    label: {
      color: c.textPrimary,
      flexShrink: 1,
    },
    label_done: {
      ...typography.body,
    },
    label_current: {
      ...typography.cardTitle,
    },
    label_attention: {
      ...typography.cardTitle,
    },
    label_upcoming: {
      ...typography.body,
      color: c.textSecondary,
    },
    meta: {
      ...typography.caption,
      color: c.textSecondary,
    },
    detail: {
      ...typography.caption,
      color: c.textSecondary,
    },
    attentionGlyph: {
      ...typography.label,
      color: c.primary,
      lineHeight: sizes.progressStepCheck,
    },
    action: {
      marginTop: spacing.md,
    },
    heading: {
      ...typography.heading,
      color: c.textPrimary,
      marginBottom: spacing.md,
    },
    collapsedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    collapsedSummary: {
      ...typography.body,
      color: c.textPrimary,
      flex: 1,
    },
    expand: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
  });
