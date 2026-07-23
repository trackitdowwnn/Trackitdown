/**
 * WHAT:  DateTimeField — the form family's date/time input: a TextField-
 *        look trigger showing the picked moment as a friendly local label
 *        ("Today, 14:30"), opening a BottomSheet with one-tap presets
 *        ("Just now", "Yesterday"…) and a platform-native exact picker.
 * WHY:   Built first for "when was the car last seen": victims think in
 *        "about an hour ago", not clock times, so the fast path is a
 *        preset pill — one tap, done. Values are ISO 8601 UTC strings
 *        (display always local, minute precision), maxDate defaults to now
 *        (a car cannot be last seen in the future) and clamps presets too.
 *        PLATFORM SPLIT, deliberately non-uniform: iOS renders the native
 *        datetime spinner INSIDE our sheet with a primary Confirm (commit
 *        on Confirm only); Android's pickers are unstyleable system
 *        DIALOGS, so the sheet offers presets plus a "Pick exact date &
 *        time" button that runs the standard two-step date→time dialog
 *        flow — cancelling either step commits nothing, and with no presets
 *        the sheet is skipped entirely. Don't fight the platform. CAVEAT:
 *        Android's TIME dialog cannot enforce maximumDate, so a future
 *        time on today's date is clamped at commit (announced to screen
 *        readers; the field shows the adjusted value). Validation stays at
 *        the form layer (zod); this renders the standard error/helper
 *        slots like TextField.
 * LINKS: docs/DESIGN_SYSTEM.md (Forms, Accessibility);
 *        src/shared/lib/dateTimeLabel.ts (display format);
 *        src/shared/ui/{SelectField,ChoiceChips,BottomSheet,Button}.tsx.
 *
 * Usage:
 *   <DateTimeField
 *     label="When did you last see it?"
 *     value={lastSeenAt}
 *     onChange={setLastSeenAt}
 *   />
 */

import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDateTimeLabel } from '../lib';
import { colors, opacity, radii, sizes, spacing, typography } from '../theme';
import { BottomSheet, type BottomSheetRef } from './BottomSheet';
import { Button } from './Button';
import { ChoiceChips } from './ChoiceChips';

export interface DateTimePreset {
  label: string;
  /** Evaluated when the sheet opens; result is clamped to min/max. */
  getValue: (now: Date) => Date;
}

/** The last-seen defaults: approximate moments, newest first. */
export const DEFAULT_DATE_TIME_PRESETS: DateTimePreset[] = [
  { label: 'Just now', getValue: (now) => now },
  { label: 'About an hour ago', getValue: (now) => new Date(now.getTime() - 60 * 60_000) },
  {
    label: 'Earlier today',
    // ~3h back, but never before local midnight — "today" must stay honest.
    getValue: (now) => {
      const candidate = new Date(now.getTime() - 3 * 60 * 60_000);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return candidate > midnight ? candidate : midnight;
    },
  },
  { label: 'Yesterday', getValue: (now) => new Date(now.getTime() - 24 * 60 * 60_000) },
];

export interface DateTimeFieldProps {
  label: string;
  /** ISO 8601 UTC, or null when unset. Display formats in local time. */
  value: string | null;
  onChange: (iso: string) => void;
  /** Hint shown while nothing is picked. */
  placeholder?: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  /** One-tap approximate values; pass [] to hide the row. */
  presets?: DateTimePreset[];
  /** Latest pickable moment. Defaults to "now" at sheet-open time. */
  maxDate?: Date;
  minDate?: Date;
  /** Sheet heading; defaults to the field label. */
  sheetTitle?: string;
}

/** Clamp into [min, max] and zero seconds — the field is minute-precise. */
function normalise(date: Date, min: Date | undefined, max: Date | undefined): Date {
  let time = date.getTime();
  if (min && time < min.getTime()) {
    time = min.getTime();
  }
  if (max && time > max.getTime()) {
    time = max.getTime();
  }
  const result = new Date(time);
  result.setSeconds(0, 0);
  return result;
}

export function DateTimeField({
  label,
  value,
  onChange,
  placeholder,
  error,
  helperText,
  disabled = false,
  presets = DEFAULT_DATE_TIME_PRESETS,
  maxDate,
  minDate,
  sheetTitle,
}: DateTimeFieldProps) {
  const sheetRef = useRef<BottomSheetRef>(null);
  // iOS spinner edits a draft; only Confirm commits it.
  const [draft, setDraft] = useState<Date>(new Date());

  const formatted = value ? formatDateTimeLabel(value) : null;
  const message = error ?? helperText;

  // iOS has no accessibilityLiveRegion; announce errors explicitly
  // (TextField/SelectField parity).
  useEffect(() => {
    if (error) {
      AccessibilityInfo.announceForAccessibility(`${label}: ${error}`);
    }
  }, [error, label]);

  /** maxDate defaults to "now" evaluated at use time, not mount time. */
  const effectiveMax = () => maxDate ?? new Date();

  const commit = (picked: Date) => {
    const normalised = normalise(picked, minDate, effectiveMax());
    // The Android TIME dialog can't enforce maximumDate, so a future time on
    // today's date gets clamped here (minDate clamps the other way). Tell
    // screen-reader users; sighted users see the adjusted value land in the
    // field.
    if (Math.abs(normalised.getTime() - picked.getTime()) >= 60_000) {
      AccessibilityInfo.announceForAccessibility('Adjusted to the nearest allowed time');
    }
    onChange(normalised.toISOString());
    sheetRef.current?.close();
  };

  // iOS picker props want a stable max for the sheet's lifetime; commit
  // still clamps against a fresh "now".
  const [sheetMax, setSheetMax] = useState<Date>(() => effectiveMax());

  const openSheet = () => {
    const max = effectiveMax();
    const start = normalise(value ? new Date(value) : new Date(), minDate, max);
    setSheetMax(max);
    setDraft(start);
    if (Platform.OS === 'android' && presets.length === 0) {
      // No presets: the sheet would be a dead hop to one button — go
      // straight to the system dialogs. Pass `start` explicitly; the draft
      // state set above hasn't rendered yet.
      openAndroidDialogs(start);
      return;
    }
    sheetRef.current?.open();
  };

  // Android: unstyleable system dialogs, run as the standard two-step flow.
  // Our sheet closes first — a sheet lingering under a system dialog reads
  // as broken. Cancelling either step commits nothing.
  const openAndroidDialogs = (startValue: Date) => {
    sheetRef.current?.close();
    // onValueChange fires ONLY when the user sets a value (9.x API), so a
    // dismissal at either step simply never advances — nothing commits.
    DateTimePickerAndroid.open({
      mode: 'date',
      value: startValue,
      maximumDate: effectiveMax(),
      minimumDate: minDate,
      onValueChange: (_event, pickedDate) => {
        if (!pickedDate) {
          return;
        }
        DateTimePickerAndroid.open({
          mode: 'time',
          value: pickedDate,
          onValueChange: (_timeEvent, pickedDateTime) => {
            if (pickedDateTime) {
              commit(pickedDateTime);
            }
          },
        });
      },
    });
  };

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatted ?? 'not set'}, opens date picker`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={openSheet}
        style={({ pressed }) => [
          styles.field,
          { borderColor: error ? colors.danger : colors.border },
          pressed && !disabled && styles.fieldPressed,
          disabled && styles.fieldDisabled,
        ]}
      >
        <View style={styles.fieldText}>
          {formatted ? (
            <>
              <Text numberOfLines={1} style={styles.floatedLabel}>
                {label}
              </Text>
              <Text numberOfLines={1} style={styles.value}>
                {formatted}
              </Text>
            </>
          ) : (
            <Text numberOfLines={1} style={styles.restingLabel}>
              {placeholder ?? label}
            </Text>
          )}
        </View>
        <Feather
          name="calendar"
          size={typography.heading.fontSize}
          color={colors.textSecondary}
        />
      </Pressable>

      {message ? (
        <Text
          style={[styles.message, error ? styles.messageError : styles.messageHelper]}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
        >
          {message}
        </Text>
      ) : null}

      <BottomSheet ref={sheetRef} title={sheetTitle ?? label}>
        {presets.length > 0 ? (
          <View style={styles.presets}>
            <ChoiceChips
              role="button" // presets are one-tap actions, not a selection
              options={presets.map((preset) => ({ value: preset.label, label: preset.label }))}
              value={null}
              onSelect={(presetLabel) => {
                const preset = presets.find((candidate) => candidate.label === presetLabel);
                if (preset) {
                  commit(preset.getValue(new Date()));
                }
              }}
            />
          </View>
        ) : null}

        {Platform.OS === 'ios' ? (
          <>
            <DateTimePicker
              mode="datetime"
              display="spinner"
              value={draft}
              maximumDate={sheetMax}
              minimumDate={minDate}
              onValueChange={(_event, picked) => picked && setDraft(picked)}
            />
            <Button label="Confirm" onPress={() => commit(draft)} />
          </>
        ) : (
          <Button
            label="Pick exact date & time"
            variant="secondary"
            onPress={() => openAndroidDialogs(draft)}
          />
        )}
      </BottomSheet>
    </View>
  );
}

// Mirrors SelectField's TextField-family geometry.
const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.input,
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  fieldPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  fieldDisabled: {
    backgroundColor: colors.surfaceSubtle,
    opacity: opacity.disabled,
  },
  fieldText: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  restingLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  floatedLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.textSecondary,
  },
  value: {
    ...typography.body,
    color: colors.textPrimary,
  },
  message: {
    ...typography.caption,
  },
  messageHelper: {
    color: colors.textSecondary,
  },
  messageError: {
    color: colors.danger,
  },
  presets: {
    marginBottom: spacing.lg,
  },
});
