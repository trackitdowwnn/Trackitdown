/**
 * WHAT:  LastSeenTimeField — the body of "When did you last see it?".
 *        Five one-tap presets sit on the step itself. Below them, a field
 *        shows the stored answer ("Last seen / Today, 13:05 · 1h ago") and
 *        opens a sheet for an exact moment: three chip rows (day, hour,
 *        quarter hour), a live summary, then Confirm over a ghost Cancel.
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
 *        Chip rows scroll sideways rather than listing 96 time slots down the
 *        page. BottomSheet has no footer, and a long vertical list would push
 *        Confirm off the bottom (and nest two vertical scrollers on Android).
 *        A11Y: the chosen time is ANNOUNCED on every commit. VoiceOver would
 *        otherwise only say "selected" after a preset tap and never the time,
 *        and iOS has no live regions.
 * LINKS: src/features/vehicles/post/lib/lastSeenTime.ts (presets, options, draft);
 *        src/features/vehicles/post/components/postSteps.tsx (LastSeenWhenStep);
 *        src/shared/ui/DateTimeField.tsx (the field geometry this mirrors);
 *        src/shared/ui/{ChoiceChips,BottomSheet,Button}.tsx; docs/DESIGN_SYSTEM.md.
 */

import { Feather } from '@expo/vector-icons';
import { useEffect, useReducer, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  clampDraft,
  dayOptions,
  draftFromDate,
  draftToDate,
  hourOptions,
  lastSeenPresets,
  minuteOptions,
  toLastSeenIso,
  type LastSeenDraft,
  type LastSeenPresetKey,
} from '../lib/lastSeenTime';
import { formatClock, formatDateTimeLabel, timeAgo } from '@/shared/lib';
import { lightHaptic } from '@/shared/lib/haptics';
import { BottomSheet, type BottomSheetRef, Button, ChoiceChips, SHEET_GUTTER } from '@/shared/ui';
import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

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

const TICK_MS = 60_000;

/**
 * Re-render once a minute while the step is on screen, so "16h ago" stays true
 * and the preset set follows the clock ("Earlier today" appears at 04:00). The
 * same tick as useTimeAgo, which can't be used directly: it needs a timestamp,
 * and here there may be no answer yet.
 */
function useMinuteTick() {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);
}

export function LastSeenTimeField({ value, onChange }: LastSeenTimeFieldProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const sheetRef = useRef<BottomSheetRef>(null);
  const [preset, setPreset] = useState<LastSeenPresetKey | null>(null);

  // The sheet works against the moment it OPENED, so its options can't shift
  // under the user's finger as a clock minute ticks over.
  const [sheetNow, setSheetNow] = useState(() => new Date());
  const [draft, setDraft] = useState<LastSeenDraft>(() => draftFromDate(new Date(), new Date()));

  useMinuteTick();
  const renderNow = new Date();
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
    setSheetNow(now);
    setDraft(draftFromDate(value ? new Date(value) : now, now));
    sheetRef.current?.open();
  };

  const updateDraft = (patch: Partial<LastSeenDraft>) => {
    const next = clampDraft({ ...draft, ...patch }, sheetNow);
    // Picking "Today" with 22:00 selected pulls the time back to the latest
    // one that has passed. Sighted users see the chip move; say it out loud
    // too, as iOS has no live regions.
    const moved =
      (patch.hour === undefined && next.hour !== draft.hour) ||
      (patch.minute === undefined && next.minute !== draft.minute);
    if (moved) {
      const time = formatClock(toLastSeenIso(draftToDate(next)));
      AccessibilityInfo.announceForAccessibility(`Time moved to ${time}, the latest available`);
    }
    setDraft(next);
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

      {/* The answer field: TextField-family geometry with a floated label,
          as DateTimeField's trigger. One trailing icon: a calendar, since a
          chevron would promise a new screen rather than a sheet. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          value ? `Last seen, ${spoken(value, renderNow)}, change date and time` : PICK_LABEL
        }
        accessibilityHint="Opens a picker for the exact day and time"
        onPress={openSheet}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
      >
        <View style={styles.fieldText}>
          {value ? (
            <>
              <Text numberOfLines={1} style={styles.floatedLabel}>
                Last seen
              </Text>
              <Text numberOfLines={1} style={styles.value}>
                {describe(value, renderNow)}
              </Text>
            </>
          ) : (
            <Text numberOfLines={1} style={styles.restingLabel}>
              {PICK_LABEL}
            </Text>
          )}
        </View>
        <Feather name="calendar" size={sizes.iconSm} color={palette.textSecondary} />
      </Pressable>

      <BottomSheet ref={sheetRef} title={PICK_LABEL}>
        <View style={styles.sheetBody}>
          {/* Header role on purpose, unlike SearchSheet's field labels. These
              rows hold up to 30 and 24 chips, and heading navigation is a
              screen reader's only cheap way past them. Labelling the
              radiogroups instead is unreliable in React Native: iOS merges the
              chips, Android adds a duplicate stop. */}
          <View style={styles.group}>
            <Text style={styles.groupLabel} accessibilityRole="header">
              Day
            </Text>
            <ChoiceChips
              options={dayOptions(sheetNow)}
              value={draft.day}
              onSelect={(day) => updateDraft({ day })}
              scrollable
              scrollToSelected
              bleed={SHEET_GUTTER}
              testID="last-seen-day"
            />
          </View>

          <View style={styles.group}>
            <Text style={styles.groupLabel} accessibilityRole="header">
              Time
            </Text>
            <ChoiceChips
              options={hourOptions(draft.day, sheetNow)}
              value={String(draft.hour)}
              onSelect={(hour) => updateDraft({ hour: Number(hour) })}
              scrollable
              scrollToSelected
              bleed={SHEET_GUTTER}
              testID="last-seen-hour"
            />
            <ChoiceChips
              options={minuteOptions(draft.day, draft.hour, sheetNow)}
              value={String(draft.minute)}
              onSelect={(minute) => updateDraft({ minute: Number(minute) })}
              testID="last-seen-minute"
            />
          </View>

          {/* The summary sits WITH the buttons, so it reads as "confirm this". */}
          <View style={styles.confirmBlock}>
            <Text style={styles.draftSummary} accessibilityLiveRegion="polite">
              {describe(draftIso, sheetNow)}
            </Text>
            {/* Stacked, primary over ghost: the pattern every confirm/dismiss
                sheet in the app uses (PostSectionEditor, SaveYourCarSheet). */}
            <View style={styles.actions}>
              <Button label="Confirm" onPress={confirm} />
              <Button label="Cancel" variant="ghost" onPress={() => sheetRef.current?.close()} />
            </View>
          </View>
        </View>
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
    // Mirrors DateTimeField's trigger (TextField-family geometry).
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: sizes.input,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      backgroundColor: c.surface,
      paddingHorizontal: spacing.lg,
    },
    fieldPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    fieldText: {
      flex: 1,
      paddingVertical: spacing.sm,
    },
    floatedLabel: {
      ...typography.caption,
      fontFamily: typography.label.fontFamily,
      color: c.textSecondary,
    },
    value: {
      ...typography.body,
      color: c.textPrimary,
    },
    restingLabel: {
      ...typography.body,
      color: c.textSecondary,
    },
    sheetBody: {
      gap: spacing.xl,
    },
    group: {
      gap: spacing.md,
    },
    groupLabel: {
      ...typography.label,
      color: c.textSecondary,
    },
    confirmBlock: {
      gap: spacing.md,
    },
    draftSummary: {
      ...typography.body,
      color: c.textPrimary,
    },
    actions: {
      gap: spacing.sm,
    },
  });
