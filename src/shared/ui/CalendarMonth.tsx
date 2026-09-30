/**
 * WHAT:  CalendarMonth — one month of the app's custom date picker. It has a
 *        left-aligned month title with bordered ‹ › buttons, a row of weekday
 *        letters, and a Monday-first grid of day circles. It selects one day
 *        or a range. Controlled: the parent owns the shown month and the
 *        selection.
 * WHY:   Replaces the platform pickers (2026-09-29) with one Airbnb-style
 *        calendar in the app's own design language:
 *          - selected days are filled near-black circles;
 *          - a range is a light band that joins its end circles and rounds off
 *            at week edges;
 *          - days that can't be picked are struck through, never hidden;
 *          - today carries a small dot.
 *        One month at a time, with arrows, rather than a scrolling list: inside
 *        a bottom sheet a vertical month list fights the sheet's own scroll and
 *        pan-to-close, and the arrows are also the accessible path.
 *        ALWAYS SIX ROWS. A month spans 4-6 weeks, and the sheet sizes to its
 *        content from the bottom, so a changing row count would move the ‹ ›
 *        arrows under the user's finger between taps.
 *        THE WHOLE CELL IS THE TARGET, not the drawn circle. The circle shrinks
 *        to the column on narrow phones (7 × 44 doesn't fit a 320pt screen
 *        inside the sheet's gutter); the target stays a full column × 44pt.
 *        A11Y: every day is a button named in full ("Tuesday 29 September 2026,
 *        today") with selected / disabled state. "Selected" is left to the
 *        state rather than repeated in the name, and range roles ("start of
 *        range") are named. The weekday letters are hidden, since each day's
 *        name already carries its weekday. Month changes are announced.
 * LINKS: src/shared/lib/calendarDates.ts (all date maths and labels);
 *        src/shared/ui/{TimeSlotPicker,DateRangeField}.tsx;
 *        docs/DESIGN_SYSTEM.md (Date & time).
 */

import { Feather } from '@expo/vector-icons';
import { memo, useCallback, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import {
  addMonths,
  compareMonths,
  dayA11yLabel,
  dayNumber,
  monthKey,
  monthMatrix,
  monthOf,
  monthTitle,
  weekdayInitials,
  type CalendarMonthRef,
  type DayId,
} from '../lib/calendarDates';
import {
  calendarFontScaleCap,
  motion,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';
import { SHEET_GUTTER } from './BottomSheet';

export type CalendarSelection =
  | { mode: 'single'; day: DayId | null }
  | { mode: 'range'; from: DayId | null; to: DayId | null };

export interface CalendarMonthProps {
  /** The month on show. */
  month: CalendarMonthRef;
  onMonthChange: (month: CalendarMonthRef) => void;
  /** Earliest / latest pickable day; null leaves that end open. */
  minDay?: DayId | null;
  maxDay?: DayId | null;
  selection: CalendarSelection;
  onSelectDay: (day: DayId) => void;
  /** The day to mark as today. Required: a default computed here would be
   *  frozen by the React Compiler's memoisation. The caller reads "today" when
   *  its sheet opens. */
  today: DayId;
  testID?: string;
}

/** Every month is drawn with this many weeks, so the grid never changes height. */
const WEEKS_SHOWN = 6;

type Band = 'none' | 'full' | 'start' | 'end';

interface DayCellProps {
  id: DayId;
  size: number;
  selected: boolean;
  disabled: boolean;
  isToday: boolean;
  band: Band;
  roundLeft: boolean;
  roundRight: boolean;
  a11yLabel: string;
  onPress: (id: DayId) => void;
}

/**
 * One day: the whole cell is the button, and the circle is drawn inside it.
 * Memoised on primitives. It skips re-rendering when its props are unchanged,
 * which holds for every cell a new selection doesn't touch, provided the
 * parent keeps `onPress` stable.
 */
const DayCell = memo(function DayCell({
  id,
  size,
  selected,
  disabled,
  isToday,
  band,
  roundLeft,
  roundRight,
  a11yLabel,
  onPress,
}: DayCellProps) {
  const styles = useThemedStyles(makeStyles);
  const radius = size / 2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={() => onPress(id)}
      style={styles.cell}
    >
      {({ pressed }) => (
        <>
          {band !== 'none' ? (
            <View
              style={[
                styles.band,
                { height: size },
                band === 'start' && styles.bandStart,
                band === 'end' && styles.bandEnd,
                roundLeft && { borderTopLeftRadius: radius, borderBottomLeftRadius: radius },
                roundRight && { borderTopRightRadius: radius, borderBottomRightRadius: radius },
              ]}
            />
          ) : null}
          <View
            style={[
              styles.circle,
              { width: size, height: size, borderRadius: radius },
              selected && (pressed ? styles.circleSelectedPressed : styles.circleSelected),
              !selected && pressed && styles.circlePressed,
            ]}
          >
            <Text
              maxFontSizeMultiplier={calendarFontScaleCap}
              style={[styles.dayNumber, selected && styles.dayNumberSelected, disabled && styles.dayNumberDisabled]}
            >
              {dayNumber(id)}
            </Text>
            {isToday ? <View style={[styles.todayDot, selected && styles.todayDotSelected]} /> : null}
          </View>
        </>
      )}
    </Pressable>
  );
});

/** What a screen reader hears after the date itself, in Airbnb's order. */
function stateSuffix(flags: { isToday: boolean; disabled: boolean; role: string | null }): string {
  const parts: string[] = [];
  if (flags.isToday) parts.push('today');
  if (flags.role) parts.push(flags.role);
  if (flags.disabled) parts.push('not available');
  return parts.length ? `, ${parts.join(', ')}` : '';
}

/** The month grid of the custom date picker (see the file header). */
export function CalendarMonth({
  month,
  onMonthChange,
  minDay = null,
  maxDay = null,
  selection,
  onSelectDay,
  today,
  testID,
}: CalendarMonthProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // The circle shrinks on narrow phones rather than overflowing seven columns.
  // Seeded from the window (inside a sheet's gutter) so the first frame is
  // already right; the grid's own layout then refines it.
  const { width: windowWidth } = useWindowDimensions();
  const fit = (width: number) => Math.min(sizes.calendarDay, Math.floor(width / 7));
  const [cellSize, setCellSize] = useState<number>(() => fit(windowWidth - 2 * SHEET_GUTTER));
  const onGridLayout = (event: LayoutChangeEvent) => setCellSize(fit(event.nativeEvent.layout.width));

  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  const canGoBack = minDay === null || compareMonths(previous, monthOf(minDay)) >= 0;
  const canGoForward = maxDay === null || compareMonths(next, monthOf(maxDay)) <= 0;

  const goTo = (target: CalendarMonthRef) => {
    onMonthChange(target);
    AccessibilityInfo.announceForAccessibility(monthTitle(target));
  };

  const pick = useCallback((id: DayId) => onSelectDay(id), [onSelectDay]);

  const from = selection.mode === 'range' ? selection.from : selection.day;
  const to = selection.mode === 'range' ? selection.to : null;
  // A band only when the range spans more than one day.
  const hasBand = from !== null && to !== null && from !== to;

  const weeks = monthMatrix(month);
  while (weeks.length < WEEKS_SHOWN) weeks.push(Array.from({ length: 7 }, () => null));

  return (
    <View testID={testID}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {monthTitle(month)}
        </Text>
        <View style={styles.nav}>
          {[
            { key: 'prev', icon: 'chevron-left' as const, target: previous, enabled: canGoBack, label: 'Previous month' },
            { key: 'next', icon: 'chevron-right' as const, target: next, enabled: canGoForward, label: 'Next month' },
          ].map((button) => (
            <Pressable
              key={button.key}
              accessibilityRole="button"
              accessibilityLabel={`${button.label}, ${monthTitle(button.target)}`}
              accessibilityState={{ disabled: !button.enabled }}
              disabled={!button.enabled}
              hitSlop={(sizes.touchTarget - sizes.calendarNavButton) / 2}
              onPress={() => goTo(button.target)}
              style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
            >
              {/* Disabled reads as a quieter glyph, not a faded button: at the
                  default opening month "Next" is always disabled, and a
                  faded-but-bordered circle looked nearly live. */}
              <Feather
                name={button.icon}
                size={sizes.iconSm}
                color={button.enabled ? palette.textPrimary : palette.borderStrong}
              />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.weekdays} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {weekdayInitials().map((letter, index) => (
          <Text key={index} style={styles.weekday} maxFontSizeMultiplier={calendarFontScaleCap}>
            {letter}
          </Text>
        ))}
      </View>

      <Animated.View
        key={monthKey(month)}
        entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
        onLayout={onGridLayout}
        testID="calendar-grid"
      >
        {weeks.map((week, row) => (
          <View key={row} style={styles.week}>
            {week.map((id, column) => {
              if (id === null) return <View key={column} style={styles.cell} />;
              const disabled = (minDay !== null && id < minDay) || (maxDay !== null && id > maxDay);
              const isStart = id === from;
              const isEnd = id === to;
              const inside = hasBand && id > (from as DayId) && id < (to as DayId);
              const selected = isStart || isEnd;
              // Where this row of the band ends: the week's edge or the month's.
              const atRowStart = column === 0 || week[column - 1] === null;
              const atRowEnd = column === 6 || week[column + 1] === null;
              // An end circle at a row edge gets no half band: the range
              // doesn't continue that way in this row, so a stub would poke out.
              const band: Band = !hasBand
                ? 'none'
                : isStart
                  ? atRowEnd
                    ? 'none'
                    : 'start'
                  : isEnd
                    ? atRowStart
                      ? 'none'
                      : 'end'
                    : inside
                      ? 'full'
                      : 'none';
              const role =
                selection.mode === 'range' && hasBand
                  ? isStart
                    ? 'start of range'
                    : isEnd
                      ? 'end of range'
                      : inside
                        ? 'in selected range'
                        : null
                  : null;
              return (
                <DayCell
                  key={id}
                  id={id}
                  size={cellSize}
                  selected={selected}
                  disabled={disabled}
                  isToday={id === today}
                  band={band}
                  roundLeft={atRowStart}
                  roundRight={atRowEnd}
                  a11yLabel={`${dayA11yLabel(id)}${stateSuffix({ isToday: id === today, disabled, role })}`}
                  onPress={pick}
                />
              );
            })}
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    // A step below the sheet's own title (`heading`), so the two don't compete.
    title: {
      ...typography.cardTitle,
      color: c.textPrimary,
      flexShrink: 1,
    },
    nav: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    // Bordered, not bare chevrons: Airbnb's A/B-tested calendar win.
    navButton: {
      width: sizes.calendarNavButton,
      height: sizes.calendarNavButton,
      borderRadius: sizes.calendarNavButton / 2,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navButtonPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    weekdays: {
      flexDirection: 'row',
      marginBottom: spacing.sm,
    },
    weekday: {
      ...typography.caption,
      flex: 1,
      textAlign: 'center',
      color: c.textSecondary,
    },
    week: {
      flexDirection: 'row',
    },
    cell: {
      flex: 1,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    band: {
      position: 'absolute',
      left: 0,
      right: 0,
      backgroundColor: c.surfaceSubtle,
    },
    // Start and end cells carry half a band, so it runs into their circles.
    bandStart: {
      left: '50%',
    },
    bandEnd: {
      right: '50%',
    },
    circle: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    circlePressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    circleSelected: {
      backgroundColor: c.primary,
    },
    circleSelectedPressed: {
      backgroundColor: c.primaryPressed,
    },
    dayNumber: {
      ...typography.body,
      fontFamily: typography.label.fontFamily,
      color: c.textPrimary,
    },
    dayNumberSelected: {
      color: c.textOnPrimary,
    },
    // Struck through, never hidden: the day is still there, it just can't be picked.
    dayNumberDisabled: {
      color: c.textSecondary,
      textDecorationLine: 'line-through',
    },
    todayDot: {
      position: 'absolute',
      bottom: spacing.xs,
      width: sizes.calendarTodayDot,
      height: sizes.calendarTodayDot,
      borderRadius: sizes.calendarTodayDot / 2,
      backgroundColor: c.textPrimary,
    },
    todayDotSelected: {
      backgroundColor: c.textOnPrimary,
    },
  });
