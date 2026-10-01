/**
 * WHAT:  SelectField — the trigger for a full-screen select: looks and sits
 *        like a TextField (floating label geometry, md radius, border/error
 *        colours) but the whole field is pressable, shows the selected
 *        option's label (or rests the label as placeholder), and opens a
 *        SelectScreen with a chevron cue on the right.
 * WHY:   Forms treat selects and text inputs as siblings, so they must read
 *        as one family (docs/DESIGN_SYSTEM.md, Forms). Controlled
 *        value/onChange keeps it form-library-agnostic — a react-hook-form
 *        Controller can drive it exactly like TextField. The field owns the
 *        screen's open state so consumers wire nothing but options and
 *        value. `clearable` (filters: search, alerts) adds an "Any …" row to
 *        the picker and a × on a filled field, as AutoTrader's filters do.
 * LINKS: src/shared/ui/SelectScreen.tsx; src/shared/ui/selectOptions.ts;
 *        src/shared/ui/TextField.tsx (visual sibling); docs/DESIGN_SYSTEM.md.
 *
 * Usage:
 *   <SelectField
 *     label="Car make"
 *     options={makeOptions}
 *     value={make}
 *     onChange={setMake}
 *     recentValues={recentMakes}
 *   />
 */

import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { lightHaptic } from '../lib/haptics';
import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';
import { SelectScreen } from './SelectScreen';
import type { SelectOption } from './selectOptions';

/** After a clear, before focus moves: long enough for the re-render to land
 *  (VoiceOver can drop a focus set in the same layout pass). */
const CLEAR_FOCUS_DELAY_MS = 100;

export interface SelectFieldProps<V extends string | number> {
  /** Field label — rests as the placeholder, sits floated once selected. */
  label: string;
  options: SelectOption<V>[];
  /** Controlled value; null renders the resting label/placeholder. */
  value: V | null;
  onChange: (value: V) => void;
  /** Hint shown instead of the label while nothing is selected. */
  placeholder?: string;
  /** Error message — styles the field invalid and replaces helperText. */
  error?: string;
  helperText?: string;
  disabled?: boolean;
  /** SelectScreen extras. Title defaults to the field label. */
  screenTitle?: string;
  searchPlaceholder?: string;
  recentValues?: V[];
  /** Heading for the pinned group (e.g. "Popular makes"). */
  pinnedTitle?: string;
  /** Auto-focus the picker's search on open. Off ⇒ browse-first. */
  autoFocusSearch?: boolean;
  /** Show the picker's A–Z jump-scroll index rail (long lists). */
  showIndex?: boolean;
  /** Soft stagger-in of the picker's rows on first open. */
  stagger?: boolean;
  /** Free-text selects (e.g. car make): the picker offers a "Use "<query>""
   *  row for unlisted values, and the field shows a chosen value even when it
   *  isn't one of `options`. `onChange` receives the free text as `V`. */
  allowManualEntry?: boolean;
  /**
   * Filters, where "nothing chosen" is itself a choice: the picker leads with
   * an `anyLabel` row ("Any make"), and a chosen value gets a clear (×)
   * button on the field. Both call `onClear`.
   */
  clearable?: { anyLabel: string; onClear: () => void; clearLabel: string };
  /** The picker's pinned group as two-up tiles, with `allTitle` above the
   *  full list (SelectScreen `pinnedLayout`). */
  pinnedLayout?: 'list' | 'grid';
  allTitle?: string;
}

export function SelectField<V extends string | number>({
  label,
  options,
  value,
  onChange,
  placeholder,
  error,
  helperText,
  disabled = false,
  screenTitle,
  searchPlaceholder,
  recentValues,
  pinnedTitle,
  autoFocusSearch,
  showIndex,
  stagger,
  allowManualEntry = false,
  clearable,
  pinnedLayout,
  allTitle,
}: SelectFieldProps<V>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [open, setOpen] = useState(false);

  const fieldRef = useRef<View>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );

  // A matched option's label, or else the raw value: a free-text field shows
  // what was typed, and a FILTER shows a value that isn't on the list (a
  // shared link, an alert saved before the list changed) so it can be seen and
  // cleared rather than silently applied behind "Any make". An empty string is
  // nothing chosen.
  const selectedLabel =
    options.find((option) => option.value === value)?.label ??
    ((allowManualEntry || clearable) && value != null && value !== '' ? String(value) : null);
  const message = error ?? helperText;
  const showClear = clearable != null && selectedLabel != null && !disabled;

  const clear = () => {
    if (!clearable) return;
    lightHaptic(); // the same tick as picking "Any…"
    clearable.onClear();
    // The × unmounts under the screen reader's focus: hand it to the field
    // once the re-render has landed, so the field reads its NEW label ("Make,
    // Any make") and that is the confirmation. If the field itself is gone
    // (a filter whose model had no list), say so instead.
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      if (fieldRef.current) {
        AccessibilityInfo.sendAccessibilityEvent(fieldRef.current, 'focus');
      } else {
        AccessibilityInfo.announceForAccessibility(`${label} cleared`);
      }
    }, CLEAR_FOCUS_DELAY_MS);
  };

  // iOS has no accessibilityLiveRegion; announce errors explicitly so
  // VoiceOver users hear them the moment they appear (TextField parity).
  useEffect(() => {
    if (error) {
      AccessibilityInfo.announceForAccessibility(`${label}: ${error}`);
    }
  }, [error, label]);

  return (
    <View style={styles.root}>
      <View>
        <Pressable
          ref={fieldRef}
          accessibilityRole="button"
          // In a filter, nothing chosen IS the answer: "Make, Any make".
          accessibilityLabel={`${label}, ${selectedLabel ?? clearable?.anyLabel ?? 'not selected'}, opens selection screen`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.field,
            { borderColor: error ? palette.danger : palette.border },
            pressed && !disabled && styles.fieldPressed,
            disabled && styles.fieldDisabled,
          ]}
        >
          <View style={styles.fieldText}>
            {selectedLabel ? (
              <>
                <Text numberOfLines={1} style={styles.floatedLabel}>
                  {label}
                </Text>
                {/* Two lines, not one: "Any Mercedes-Benz model" at large
                    text would otherwise cut mid-word. */}
                <Text numberOfLines={2} style={styles.value}>
                  {selectedLabel}
                </Text>
              </>
            ) : (
              <Text numberOfLines={2} style={styles.restingLabel}>
                {placeholder ?? label}
              </Text>
            )}
          </View>
          {/* The × takes the chevron's spot; a spacer keeps the text clear of it. */}
          {showClear ? (
            <View style={styles.clearSpace} />
          ) : (
            <Feather
              name="chevron-down"
              size={sizes.iconSm}
              color={palette.textSecondary}
            />
          )}
        </Pressable>
        {/* A SIBLING of the field, not a child: nested inside, it would be
            folded into the field's own accessible element and a screen reader
            could never reach it. */}
        {showClear ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={clearable.clearLabel}
            onPress={clear}
            style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
          >
            <Feather name="x" size={sizes.iconSm} color={palette.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {message ? (
        <Text
          style={[styles.message, error ? styles.messageError : styles.messageHelper]}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
        >
          {message}
        </Text>
      ) : null}

      <SelectScreen
        visible={open}
        title={screenTitle ?? label}
        options={options}
        value={value}
        onSelect={onChange}
        onClose={() => setOpen(false)}
        searchPlaceholder={searchPlaceholder}
        recentValues={recentValues}
        pinnedTitle={pinnedTitle}
        autoFocusSearch={autoFocusSearch}
        showIndex={showIndex}
        stagger={stagger}
        // Free text is a valid value for these fields (V is string), so the
        // "Use "<query>"" row feeds the typed make straight to onChange.
        manualEntry={allowManualEntry ? { onSubmit: (text) => onChange(text as V) } : undefined}
        anyOption={clearable ? { label: clearable.anyLabel, onSelect: clearable.onClear } : undefined}
        pinnedLayout={pinnedLayout}
        allTitle={allTitle}
      />
    </View>
  );
}

// Mirrors TextField's floating-label geometry so the two sit as siblings.
const makeStyles = (c: Palette) =>
  StyleSheet.create({
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
      backgroundColor: c.surface,
      paddingHorizontal: spacing.lg,
    },
    fieldPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    // Wide enough that the text (which ends one `md` gap before this) stops
    // where the × starts: the × is 44pt + `xs` in from the field's right edge,
    // and the field pads `lg`. 20pt today.
    clearSpace: {
      width: sizes.touchTarget + spacing.xs - spacing.lg - spacing.md,
    },
    // Over the chevron's spot, inside the field's border, a 48pt-tall target
    // in the 56pt field; inset top and bottom so its pressed fill never paints
    // over the border.
    clear: {
      position: 'absolute',
      right: spacing.xs,
      top: spacing.xs,
      bottom: spacing.xs,
      width: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      // `sm` inside the field's `md`, `xs` in: the inner corner follows the outer.
      borderRadius: radii.sm,
    },
    clearPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    fieldDisabled: {
      backgroundColor: c.surfaceSubtle,
      opacity: opacity.disabled,
    },
    fieldText: {
      flex: 1,
      paddingVertical: spacing.sm,
    },
    restingLabel: {
      ...typography.body,
      color: c.textSecondary,
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
    message: {
      ...typography.caption,
    },
    messageHelper: {
      color: c.textSecondary,
    },
    messageError: {
      color: c.danger,
    },
  });
