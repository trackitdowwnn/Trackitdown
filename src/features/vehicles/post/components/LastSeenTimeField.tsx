/**
 * WHAT:  LastSeenTimeField — the body of "When did you last see it?".
 *        Five one-tap presets sit on the step itself. Below them, a field
 *        shows the stored answer ("Last seen / Today, 13:05 · 1h ago") and
 *        opens a two-stage sheet for an exact moment:
 *          1. "Pick a date": the app's own calendar (one month, ‹ › arrows, the
 *             last 30 days pickable). Tapping a day moves straight on.
 *          2. "Pick a time": the chosen day with a "Change" link back, then the
 *             time picker (part-of-day segments to jump close, then a large
 *             time with − / + 15-minute steppers), and "Confirm 21:15" over a
 *             ghost Cancel.
 * WHY:   Replaces the shared DateTimeField on this step (2026-09-28). There,
 *        the presets were hidden inside a sheet titled "Last seen" (the step's
 *        own question again), and they never showed as picked. Android also
 *        left the sheet for two system dialogs. Here:
 *          - the common answer is ONE tap on the step, and the picked chip
 *            stays highlighted;
 *          - the exact picker is the same on both platforms, inside the sheet;
 *          - it only offers moments that can be true (lib/lastSeenTime.ts), so
 *            nothing is ever silently clamped.
 *        Which preset is highlighted is local state, not a stored answer: after
 *        Back, Edit or a restored draft no chip is lit, and the field carries
 *        the value instead.
 *        The calendar and time slots are the shared custom picker (2026-09-29,
 *        CalendarMonth + TimeSlotPicker), so search's date range speaks the
 *        same visual language.
 *        TWO STAGES, not one long sheet (owner's call, 2026-09-29). Date then
 *        time is the order people answer in. It also halves the sheet: calendar
 *        plus time plus buttons came to about 740pt, which pushed Confirm below
 *        the fold on most phones. Each stage now fits on its own. The draft
 *        survives "Change", so going back to the date keeps the chosen time
 *        where it's still valid.
 *        A11Y: the chosen time is ANNOUNCED on every commit. VoiceOver would
 *        otherwise only say "selected" after a preset tap and never the time,
 *        and iOS has no live regions.
 * LINKS: src/features/vehicles/post/lib/lastSeenTime.ts (presets, window, draft);
 *        src/features/vehicles/post/components/postSteps.tsx (LastSeenWhenStep);
 *        src/shared/ui/{CalendarMonth,TimeSlotPicker,DateRangeField}.tsx;
 *        src/shared/ui/{ChoiceChips,BottomSheet,Button}.tsx; docs/DESIGN_SYSTEM.md.
 */

import { useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import {
  clampDraft,
  draftFromDate,
  draftToDate,
  lastSeenPresets,
  lastSeenWindow,
  toLastSeenIso,
  type LastSeenDraft,
  type LastSeenPresetKey,
} from '../lib/lastSeenTime';
import { useNow } from '@/shared/hooks';
import { formatClock, formatDateTimeLabel, timeAgo } from '@/shared/lib';
import {
  dayA11yLabel,
  dayHeading,
  monthOf,
  type CalendarMonthRef,
  type DayId,
} from '@/shared/lib/calendarDates';
import { lightHaptic } from '@/shared/lib/haptics';
import {
  BottomSheet,
  type BottomSheetRef,
  Button,
  CalendarMonth,
  ChoiceChips,
  FieldTrigger,
  TimeSlotPicker,
} from '@/shared/ui';
import { motion, sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

export interface LastSeenTimeFieldProps {
  /** ISO 8601 UTC, or null when unset. */
  value: string | null;
  onChange: (iso: string) => void;
}

const PICK_LABEL = 'Pick a date and time';
const DAY_MS = 24 * 60 * 60_000;

/**
 * "Today, 13:05 · 1h ago": the moment, then how long ago it was, while that's
 * under a day. Beyond a day the elapsed count stops helping: timeAgo floors, so
 * Saturday evening reads "1d ago" on Monday afternoon. The day name ("Sat 26
 * Sept") already says it. `separator` is " · " on screen and ", " when spoken,
 * so a screen reader doesn't read out "dot".
 */
function describe(iso: string, now: Date, separator = ' · '): string {
  const label = formatDateTimeLabel(iso, now);
  return now.getTime() - new Date(iso).getTime() < DAY_MS
    ? `${label}${separator}${timeAgo(iso, now)}`
    : label;
}

const spoken = (iso: string, now: Date) => describe(iso, now, ', ');

// Once a minute while the step is on screen, so "16h ago" stays true and the
// preset set follows the clock ("Earlier today" appears at 04:00). useNow, not
// a render-time `new Date()`: the React Compiler would freeze that.
const TICK_MS = 60_000;

/** The body of "When did you last see it?" (see the file header). */
export function LastSeenTimeField({ value, onChange }: LastSeenTimeFieldProps) {
  const styles = useThemedStyles(makeStyles);
  const sheetRef = useRef<BottomSheetRef>(null);
  const [preset, setPreset] = useState<LastSeenPresetKey | null>(null);

  // The sheet works against the moment it OPENED, so its options can't shift
  // under the user's finger as a clock minute ticks over.
  const [sheetNow, setSheetNow] = useState(() => new Date());
  const [draft, setDraft] = useState<LastSeenDraft>(() => draftFromDate(new Date(), new Date()));
  const [month, setMonth] = useState<CalendarMonthRef>(() => monthOf(draft.day));
  const [stage, setStage] = useState<'date' | 'time'>('date');
  const span = lastSeenWindow(sheetNow);

  const renderNow = useNow(TICK_MS);
  const presets = lastSeenPresets(renderNow);

  // Every commit gets the app's "picked it" haptic and a spoken confirmation.
  // Draft edits inside the sheet get neither: they aren't answers yet.
  const commit = (iso: string) => {
    onChange(iso);
    lightHaptic();
    AccessibilityInfo.announceForAccessibility(`Last seen ${spoken(iso, new Date())}`);
  };

  const pickPreset = (key: LastSeenPresetKey) => {
    // Re-evaluated at tap time, not render time: "Just now" means now.
    const picked = lastSeenPresets(new Date()).find((candidate) => candidate.key === key);
    if (!picked) return;
    setPreset(key);
    commit(toLastSeenIso(picked.value));
  };

  const openSheet = () => {
    const now = new Date();
    const start = draftFromDate(value ? new Date(value) : now, now);
    setSheetNow(now);
    setDraft(start);
    setMonth(monthOf(start.day));
    // Always the date first, even with an answer stored: the calendar shows
    // it selected, and one tap on it goes straight back to its time.
    setStage('date');
    sheetRef.current?.open();
  };

  // A day moves the sheet on to the time. clampDraft keeps the time valid
  // for the new day (22:00 yesterday becomes the latest slot today).
  const pickDay = (day: DayId) => {
    setDraft((current) => clampDraft({ ...current, day }, sheetNow));
    setStage('time');
    // The calendar just left the screen, so say where the user is now.
    AccessibilityInfo.announceForAccessibility(`${dayA11yLabel(day)}. Now pick a time.`);
  };

  const confirm = () => {
    setPreset(null);
    sheetRef.current?.close();
    commit(toLastSeenIso(draftToDate(draft)));
  };

  const draftIso = toLastSeenIso(draftToDate(draft));

  return (
    <View style={styles.root}>
      <ChoiceChips
        options={presets.map((option) => ({ value: option.key, label: option.label }))}
        value={preset}
        onSelect={pickPreset}
        testID="last-seen-presets"
      />

      {/* The answer field (shared FieldTrigger, as DateRangeField's). */}
      <FieldTrigger
        label="Last seen"
        value={value ? describe(value, renderNow) : null}
        placeholder={PICK_LABEL}
        onPress={openSheet}
        accessibilityLabel={
          value ? `Last seen, ${spoken(value, renderNow)}, change date and time` : PICK_LABEL
        }
        accessibilityHint="Opens a picker for the exact day and time"
      />

      <BottomSheet ref={sheetRef} title={stage === 'date' ? 'Pick a date' : 'Pick a time'}>
        {/* Keyed on the stage, so each one fades in rather than swapping. */}
        <Animated.View
          key={stage}
          entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
          style={styles.sheetBody}
        >
          {stage === 'date' ? (
            <>
              {/* Stage 1: the calendar alone. Tapping a day moves straight on
                  to the time, so a date is one tap. */}
              <CalendarMonth
                month={month}
                onMonthChange={setMonth}
                minDay={span.minDay}
                maxDay={span.maxDay}
                selection={{ mode: 'single', day: draft.day }}
                onSelectDay={pickDay}
                today={span.maxDay}
                testID="last-seen-calendar"
              />
              <Button label="Cancel" variant="ghost" onPress={() => sheetRef.current?.close()} />
            </>
          ) : (
            <>
              {/* Stage 2: the picked day, with a way back, then the time. */}
              <View style={styles.dayRow}>
                <Text
                  style={styles.dayTitle}
                  accessibilityRole="header"
                  accessibilityLabel={dayA11yLabel(draft.day)}
                >
                  {dayHeading(draft.day)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change date"
                  // 44pt tall like every target: 18pt text + hitSlop was 42.
                  hitSlop={{ left: spacing.md, right: spacing.md }}
                  onPress={() => {
                    setStage('date');
                    // The focused link just unmounted: say where the user is.
                    AccessibilityInfo.announceForAccessibility('Pick a date');
                  }}
                  style={styles.changeTarget}
                >
                  {({ pressed }) => (
                    <Text style={[styles.changeLink, pressed && styles.changeLinkPressed]}>Change</Text>
                  )}
                </Pressable>
              </View>

              <TimeSlotPicker
                day={draft.day}
                value={draft}
                onChange={(time) => setDraft((current) => clampDraft({ ...current, ...time }, sheetNow))}
                now={sheetNow}
              />

              {/* No separate summary: the picker's large time IS the summary,
                  and Confirm repeats it ("Confirm 21:15"). Stacked, primary
                  over ghost: the app's confirm / dismiss sheet pattern. */}
              <View style={styles.actions}>
                <Button label={`Confirm ${formatClock(draftIso)}`} onPress={confirm} />
                <Button label="Cancel" variant="ghost" onPress={() => sheetRef.current?.close()} />
              </View>
            </>
          )}
        </Animated.View>
      </BottomSheet>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // xl, not lg: the presets and the exact field are ALTERNATIVES, and 16pt
    // between them read as one group.
    root: {
      gap: spacing.xl,
    },
    sheetBody: {
      gap: spacing.lg,
    },
    dayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    // A step below the sheet's title, like CalendarMonth's month title.
    dayTitle: {
      ...typography.cardTitle,
      color: c.textPrimary,
      flexShrink: 1,
    },
    // Airbnb's underlined text button, for a secondary step back.
    changeLink: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
    changeTarget: {
      minHeight: sizes.touchTarget,
      justifyContent: 'center',
    },
    changeLinkPressed: {
      color: c.textSecondary,
    },
    actions: {
      gap: spacing.sm,
    },
  });
