/**
 * WHAT:  DateRangeField — a field showing a picked date range ("11 Jul – 2
 *        Aug"). It opens a sheet with a CalendarMonth in range mode, a live
 *        summary and hint, Apply, and "Clear dates". The sheet edits a draft:
 *        nothing changes until Apply, or until "Clear dates", which commits an
 *        empty range at once.
 * WHY:   Replaces the search sheet's two native "From" / "To" DateTimeFields
 *        (2026-09-29):
 *          - one field and one calendar, the way Airbnb picks check-in and
 *            check-out, in place of two dialogs that had to keep each other in
 *            order;
 *          - a real way to clear the range, which the old pair lacked
 *            (search-map/README.md).
 *        Range taps follow Airbnb:
 *          - the first tap sets the start and a later day sets the end;
 *          - a tap on or before the start, or any tap after a finished range,
 *            starts again. The always-present hint line says so;
 *          - Apply with only a NEW start means that one day. A stored
 *            open-ended range ("From 11 Jul", from an older version) applied
 *            unchanged stays open-ended.
 *        `noFuture` takes "today" when the sheet OPENS. A maxDay the caller
 *        computed during render could be frozen by the React Compiler.
 *        Works in day IDs (lib/calendarDates.ts). A caller that stores
 *        instants converts at its edge (SeenRangeFields does).
 * LINKS: src/shared/ui/{CalendarMonth,FieldTrigger}.tsx; src/shared/lib/calendarDates.ts;
 *        src/features/search-map/components/SeenRangeFields.tsx (consumer).
 */

import { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import {
  daySpokenLabel,
  dayShortLabel,
  monthOf,
  toDayId,
  type CalendarMonthRef,
  type DayId,
} from '../lib/calendarDates';
import { useNow } from '../hooks/useNow';
import { lightHaptic } from '../lib/haptics';
import { spacing, typography, useThemedStyles, type Palette } from '../theme';
import { BottomSheet, type BottomSheetRef } from './BottomSheet';
import { Button } from './Button';
import { CalendarMonth } from './CalendarMonth';
import { FieldTrigger } from './FieldTrigger';

const HOUR_MS = 60 * 60_000;

export interface DayRange {
  from: DayId | null;
  to: DayId | null;
}

export interface DateRangeFieldProps {
  /** The field's name, floated once a range is set, e.g. "Dates seen". */
  label: string;
  value: DayRange;
  onChange: (range: DayRange) => void;
  /** Shown while nothing is picked. */
  placeholder?: string;
  sheetTitle?: string;
  minDay?: DayId | null;
  maxDay?: DayId | null;
  /** No day after today, today being read when the sheet opens. */
  noFuture?: boolean;
  testID?: string;
}

function formatRange({ from, to }: DayRange, label: (id: DayId) => string, joiner: string): string | null {
  if (from !== null && to !== null) return from === to ? label(from) : `${label(from)}${joiner}${label(to)}`;
  if (from !== null) return `From ${label(from)}`;
  if (to !== null) return `Until ${label(to)}`;
  return null;
}

/** "11 Jul – 2 Aug", "11 Jul", "From 11 Jul", or null for no range. */
export function describeRange(range: DayRange, now: Date): string | null {
  return formatRange(range, (id) => dayShortLabel(id, now), ' – ');
}

/** The spoken form: "11 July to 2 August". */
export function speakRange(range: DayRange, now: Date): string | null {
  return formatRange(range, (id) => daySpokenLabel(id, now), ' to ');
}

/** The next draft after tapping `day`, by Airbnb's rules (see the header). */
export function nextRange({ from, to }: DayRange, day: DayId): DayRange {
  if (from === null || to !== null || day <= from) return { from: day, to: null };
  return { from, to: day };
}

/** The earlier of two optional days: the tighter of two maximums. */
const earlierOf = (a: DayId | null, b: DayId | null) => (a === null ? b : b === null ? a : a < b ? a : b);

/** A field that picks a date range in a calendar sheet (see the file header). */
export function DateRangeField({
  label,
  value,
  onChange,
  placeholder = 'Any dates',
  sheetTitle = 'Pick dates',
  minDay = null,
  maxDay = null,
  noFuture = false,
  testID,
}: DateRangeFieldProps) {
  const styles = useThemedStyles(makeStyles);
  const sheetRef = useRef<BottomSheetRef>(null);
  const [draft, setDraft] = useState<DayRange>(value);
  const [sheetToday, setSheetToday] = useState<DayId>(() => toDayId(new Date()));
  const [month, setMonth] = useState<CalendarMonthRef>(() => monthOf(sheetToday));

  // Only decides whether a range needs its year, so an hourly tick is plenty.
  // useNow, not `new Date()` here: the React Compiler would freeze it.
  const now = useNow(HOUR_MS);
  const shown = describeRange(value, now);
  const effectiveMax = noFuture ? earlierOf(maxDay, sheetToday) : maxDay;

  const openSheet = () => {
    const today = toDayId(new Date());
    setSheetToday(today);
    setDraft(value);
    // Open on the range's end if there is one, else on today's month.
    setMonth(monthOf(value.to ?? value.from ?? (noFuture ? today : maxDay) ?? today));
    sheetRef.current?.open();
  };

  const commit = (range: DayRange) => {
    onChange(range);
    lightHaptic();
    sheetRef.current?.close();
    const said = speakRange(range, new Date());
    AccessibilityInfo.announceForAccessibility(said ? `${label}, ${said}` : `${label} cleared`);
  };

  const apply = () => {
    const unchanged = draft.from === value.from && draft.to === value.to;
    // A NEW start alone is that one day; an untouched stored range keeps its shape.
    commit(!unchanged && draft.from !== null && draft.to === null ? { from: draft.from, to: draft.from } : draft);
  };

  const selectDay = useCallback((day: DayId) => setDraft((current) => nextRange(current, day)), []);

  const hasDraft = draft.from !== null || draft.to !== null;
  const hint =
    draft.from === null
      ? 'Tap a day to start.'
      : draft.to === null
        ? 'Tap a later day to add an end date, or apply for just this day.'
        : 'Tap any day to start again.';

  return (
    <View testID={testID}>
      <FieldTrigger
        label={label}
        value={shown}
        placeholder={placeholder}
        onPress={openSheet}
        accessibilityLabel={
          shown
            ? `${label}, ${speakRange(value, now)}, change dates`
            : `${label}, ${placeholder.toLowerCase()}, pick dates`
        }
        accessibilityHint="Opens a calendar to pick a date range"
      />

      <BottomSheet ref={sheetRef} title={sheetTitle}>
        <View style={styles.sheetBody}>
          <CalendarMonth
            month={month}
            onMonthChange={setMonth}
            minDay={minDay}
            maxDay={effectiveMax}
            selection={{ mode: 'range', from: draft.from, to: draft.to }}
            onSelectDay={selectDay}
            today={sheetToday}
            testID="range-calendar"
          />
          <View style={styles.confirmBlock}>
            {/* One summary line and one hint line, always: the sheet sizes to
                its content, so a line that came and went would move the
                calendar under the finger. */}
            <View accessibilityLiveRegion="polite">
              <Text style={styles.summary}>{describeRange(draft, now) ?? 'No dates picked'}</Text>
              <Text style={styles.hint}>{hint}</Text>
            </View>
            <View style={styles.actions}>
              <Button label="Apply" onPress={apply} disabled={!hasDraft} />
              <Button
                label="Clear dates"
                variant="ghost"
                onPress={() => commit({ from: null, to: null })}
                disabled={!hasDraft && value.from === null && value.to === null}
              />
            </View>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    sheetBody: {
      gap: spacing.lg,
    },
    confirmBlock: {
      gap: spacing.md,
    },
    summary: {
      ...typography.body,
      color: c.textPrimary,
    },
    hint: {
      ...typography.caption,
      color: c.textSecondary,
      marginTop: spacing.xs,
    },
    actions: {
      gap: spacing.sm,
    },
  });
