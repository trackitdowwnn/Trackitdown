/**
 * WHAT:  TimeSlotPicker — the time half of the custom date & time picker.
 *        Top to bottom (no helper line: the owner removed "A rough time is
 *        fine." on 2026-09-30, and the design speaks for itself):
 *          - a full-width row of up to four part-of-day segments (Night,
 *            Morning, Afternoon, Evening) that jump close;
 *          - one large time with − / + steppers either side, moving in 15
 *            minutes (hold to repeat);
 *          - "about 17 hours ago" under it.
 *        Controlled.
 * WHY:   Third design (2026-09-29), from research into modern time pickers.
 *        The owner found the chip rows, then the hour grid, hard to use. What
 *        the research said:
 *          - ROUGH FIRST, THEN REFINE. People reconstruct past times from
 *            routines (Friedman 1993), so the part of the day comes first,
 *            then the minutes (Talebi, via Smashing Magazine).
 *          - 15-MINUTE STEPS. People round to 15 / 30 / 60 minutes even when
 *            asked to be exact (Sanko & Iriguchi 2022), and Apple's HIG
 *            suggests quarter hours.
 *          - TAPS, NOT DRAGS. WCAG 2.5.7. Dragging is slower and loses more
 *            answers (Couper 2006, Fernandez 2013), and fine motor control
 *            drops under stress. So: steppers, no wheel or dial.
 *          - ONE LARGE VALUE, then its controls, then one button that repeats
 *            it ("Confirm 21:15"). iOS Clock, Google Clock and Uber all do
 *            this. Tabular numerals keep the digits from jittering as they
 *            change (a Google Clock redesign complaint).
 *        The segments are equal width and all fit, so nothing hides off-screen
 *        (the first design's problem). A part of today that hasn't started
 *        isn't shown at all, and the rest share the row (owner's call,
 *        2026-09-30, over striking it through). With only one part started
 *        (just after midnight) there's nothing to choose, so the row goes.
 *        ONLY TRUE TIMES: every step and jump walks the day's OFFERED slots
 *        (lib/calendarDates.ts), which are checked as real instants. A
 *        DST-missing hour is stepped over, and "+" stops at the latest time
 *        that has passed.
 *        A11Y: the large time is ONE adjustable element (swipe up / down steps
 *        15 minutes), with its value spoken in full ("21:15, about 17 hours
 *        ago"). The steppers are buttons and the segments radios. Each step ticks
 *        like a system picker's detent (selectionHaptic). That's the one named
 *        exception to "draft taps get no haptic" (DESIGN_SYSTEM.md).
 * LINKS: src/shared/lib/calendarDates.ts (DAY_PERIODS, stepSlot, jumpToPeriod);
 *        src/shared/lib/haptics.ts (selectionHaptic);
 *        src/features/vehicles/post/components/LastSeenTimeField.tsx (consumer).
 */

import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, type ComponentProps } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  atTime,
  DAY_PERIODS,
  jumpToPeriod,
  periodOf,
  SLOT_MINUTES,
  slotsFor,
  stepSlot,
  type DayId,
  type DayPeriod,
  type TimeOfDay,
} from '../lib/calendarDates';
import { formatClock } from '../lib/dateTimeLabel';
import { selectionHaptic } from '../lib/haptics';
import {
  displayFontScaleCap,
  motion,
  radii,
  segmentFontScaleCap,
  shadows,
  shrinkToFitMinScale,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';

export interface TimeSlotPickerProps {
  /** Today or earlier. */
  day: DayId;
  /** Must be a slot on offer (not after `now`): run clampTime first. */
  value: TimeOfDay;
  onChange: (time: TimeOfDay) => void;
  /**
   * The moment "the future" starts. Held fixed while a sheet is open, so
   * "about N minutes ago" can lag a sheet left open a while. That's accepted:
   * don't swap it for a render-time `new Date()` (the React Compiler freezes
   * those, see src/shared/hooks/useNow.ts).
   */
  now: Date;
  step?: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * "about 17 hours ago": the gap in the words people use. Rounded down, and
 * "about" says so, because the time itself is only a rough answer.
 */
export function aboutAgo(at: Date, now: Date): string {
  const gap = now.getTime() - at.getTime();
  if (gap < MINUTE_MS) return 'just now';
  if (gap < HOUR_MS) {
    const minutes = Math.floor(gap / MINUTE_MS);
    return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (gap < 48 * HOUR_MS) {
    const hours = Math.floor(gap / HOUR_MS);
    return `about ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  return `about ${Math.floor(gap / (24 * HOUR_MS))} days ago`;
}

/**
 * "9:15 pm" → ["9:15", "pm"]; "21:15" → ["21:15", null]. The large time
 * sets its AM / PM smaller, as iOS and Google Clock do: at full size "12:45
 * pm" won't fit between the steppers, and the digits would re-centre as the
 * suffix width changes. ICU puts a narrow no-break space (U+202F) before the
 * suffix, so that counts as a separator too.
 */
export function splitMeridiem(clock: string): [string, string | null] {
  const match = /^(.*?)[\s  ]*([ap]\.?\s?m\.?)$/i.exec(clock);
  return match ? [match[1], match[2]] : [clock, null];
}

interface StepperProps {
  icon: ComponentProps<typeof Feather>['name'];
  label: string;
  enabled: boolean;
  onStep: () => void;
  onHold: () => void;
  onRelease: () => void;
}

/** A − or + button: a tap steps once, a hold repeats until release. */
function Stepper({ icon, label, enabled, onStep, onHold, onRelease }: StepperProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onStep}
      onLongPress={onHold}
      delayLongPress={motion.longPress}
      onPressOut={onRelease}
      style={({ pressed }) => [styles.stepper, pressed && enabled && styles.stepperPressed]}
    >
      <Feather name={icon} size={sizes.icon} color={enabled ? palette.textPrimary : palette.borderStrong} />
    </Pressable>
  );
}

/** The time half of the custom date & time picker (see the file header). */
export function TimeSlotPicker({ day, value, onChange, now, step = SLOT_MINUTES }: TimeSlotPickerProps) {
  const styles = useThemedStyles(makeStyles);

  // A held stepper reads and writes this, not the render's `value`: it can
  // step several times before the parent's new value has rendered back.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRepeat = () => {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
  };
  // Stop a hold on unmount, and if the day or the clock it was stepping
  // against changes underneath it: the interval closed over the old ones.
  useEffect(() => stopRepeat, [day, now, step]);

  const clock = (time: TimeOfDay) => formatClock(atTime(day, time.hour, time.minute).toISOString());
  const shown = clock(value);
  const [digits, meridiem] = splitMeridiem(shown);
  const ago = aboutAgo(atTime(day, value.hour, value.minute), now);
  const canStepBack = stepSlot(day, value, -1, now, step) !== null;
  const canStepOn = stepSlot(day, value, 1, now, step) !== null;
  const period = periodOf(value.hour);

  /** One step; false at the end of the offered range. */
  const stepBy = (direction: -1 | 1): boolean => {
    const next = stepSlot(day, valueRef.current, direction, now, step);
    if (!next) return false;
    valueRef.current = next;
    onChange(next);
    selectionHaptic();
    return true;
  };

  /** A tap: one step, spoken. A double-tap on "15 minutes later" would
   *  otherwise say nothing about the time it made. */
  const tapStep = (direction: -1 | 1) => {
    if (stepBy(direction)) AccessibilityInfo.announceForAccessibility(clock(valueRef.current));
  };

  /** A hold steps AT ONCE, then repeats. Otherwise nothing happens for the
   *  long-press delay plus one interval, about half a second. Holds aren't
   *  announced: eight a second would queue up. */
  const hold = (direction: -1 | 1) => {
    stopRepeat();
    if (!stepBy(direction)) return;
    repeat.current = setInterval(() => {
      if (!stepBy(direction)) stopRepeat();
    }, motion.stepRepeat);
  };

  const jump = (target: DayPeriod) => {
    if (target === period) return;
    const landed = jumpToPeriod(day, target, now, step);
    if (!landed) return;
    valueRef.current = landed;
    onChange(landed);
    AccessibilityInfo.announceForAccessibility(`Time set to ${clock(landed)}`);
  };

  // Equal segments on one track, every one on screen. Only the parts of the
  // day that have STARTED are shown (owner's call, 2026-09-30): on today at
  // 14:37 that's Night / Morning / Afternoon, and the three share the width.
  // A past day always has all four; one alone isn't a choice, so the row
  // goes. The picked one is a quiet raised thumb, not a black slab, so the
  // large time and Confirm stay the heavy shapes.
  const started = DAY_PERIODS.filter((candidate) => slotsFor(day, candidate.key, now, step).length > 0);
  const segments = started.map((candidate) => {
    const selected = candidate.key === period;
    return (
      <Pressable
        key={candidate.key}
        accessibilityRole="radio"
        accessibilityLabel={candidate.label}
        accessibilityState={{ checked: selected }}
        onPress={() => jump(candidate.key)}
        style={({ pressed }) => [
          styles.period,
          selected && styles.periodSelected,
          pressed && !selected && styles.periodPressed,
        ]}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={shrinkToFitMinScale}
          maxFontSizeMultiplier={segmentFontScaleCap}
          style={[styles.periodLabel, selected && styles.periodLabelSelected]}
        >
          {candidate.label}
        </Text>
      </Pressable>
    );
  });

  return (
    <View style={styles.root}>
      {segments.length > 1 ? (
        <View style={styles.periods} accessibilityRole="radiogroup">
          {segments}
        </View>
      ) : null}

      <View style={styles.readoutRow}>
        <Stepper
          icon="minus"
          label={`${step} minutes earlier`}
          enabled={canStepBack}
          onStep={() => tapStep(-1)}
          onHold={() => hold(-1)}
          onRelease={stopRepeat}
        />
        {/* One adjustable element: screen-reader users swipe up / down. */}
        <View
          style={styles.readout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Time"
          accessibilityValue={{ text: `${shown}, ${ago}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === 'increment') stepBy(1);
            else if (action === 'decrement') stepBy(-1);
          }}
        >
          <Text
            style={styles.time}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={shrinkToFitMinScale}
            maxFontSizeMultiplier={displayFontScaleCap}
          >
            {digits}
            {/* The cap is set again: nested Text doesn't reliably inherit it
                (DESIGN_SYSTEM.md, Typography). */}
            {meridiem ? (
              <Text style={styles.meridiem} maxFontSizeMultiplier={displayFontScaleCap}>
                {' '}
                {meridiem}
              </Text>
            ) : null}
          </Text>
          {/* Shrinks rather than wrapping or truncating: "about 23 minutes
              ago" is wider than the readout column on a 320pt phone, and a
              wrap would make the sheet jump as the user steps. Capped like
              the time above, or at 200% text shrink-to-fit can't save it;
              the adjustable value speaks it in full anyway. */}
          <Text
            style={styles.ago}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={shrinkToFitMinScale}
            maxFontSizeMultiplier={displayFontScaleCap}
          >
            {ago}
          </Text>
        </View>
        <Stepper
          icon="plus"
          label={`${step} minutes later`}
          enabled={canStepOn}
          onStep={() => tapStep(1)}
          onHold={() => hold(1)}
          onRelease={stopRepeat}
        />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: spacing.sm,
    },
    // One grey track holding up to four equal segments (iOS / Google Clock style).
    periods: {
      flexDirection: 'row',
      gap: spacing.xs,
      padding: spacing.xs,
      borderRadius: radii.md,
      backgroundColor: c.surfaceSubtle,
    },
    period: {
      flex: 1,
      minHeight: sizes.touchTarget,
      borderRadius: radii.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The hairline is what makes it read as RAISED in dark mode: there the
    // thumb (surface) is darker than the track (surfaceSubtle), and a soft
    // shadow barely shows on a dark sheet.
    periodSelected: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      ...shadows.soft,
    },
    periodPressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    periodLabel: {
      ...typography.label,
      color: c.textSecondary,
    },
    periodLabelSelected: {
      fontFamily: typography.cardTitle.fontFamily,
      color: c.textPrimary,
    },
    // The time gets the most air in the sheet: it is the thing being chosen.
    // 32pt either side: root gap (sm) + xl above; lg here + the sheet's own
    // lg gap below, before Confirm.
    readoutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
    },
    readout: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
    },
    // Tabular numerals: the digits keep their width as they change.
    time: {
      ...typography.timeReadout,
      color: c.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    // AM / PM set small beside the digits, as iOS and Google Clock do.
    meridiem: {
      ...typography.heading,
      color: c.textSecondary,
    },
    ago: {
      ...typography.body,
      color: c.textSecondary,
      marginTop: spacing.xs,
    },
    // Filled rather than hairline-outlined: reads as pressable, and matches
    // the segment track above.
    stepper: {
      width: sizes.timeStepper,
      height: sizes.timeStepper,
      borderRadius: radii.full,
      backgroundColor: c.surfaceSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperPressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
  });
