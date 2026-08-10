/**
 * WHAT:  ChoiceChipsMulti — a MULTI-select row of pill chips: `surfaceSubtle`
 *        resting, `primary` fill + trailing check when selected, wrapping to new
 *        lines or (with `scrollable`) running along one horizontal line. Options
 *        may carry a Feather icon or a colour SWATCH dot. The checkbox sibling
 *        of ChoiceChips (which is single-select).
 * WHY:   The post-a-car wizard's distinguishing-features step lets an owner
 *        pick many tags from the vehicle_feature taxonomy at once — a checkbox
 *        group, not a radio. One shared implementation keeps checkbox semantics
 *        (checkbox role + checked state, 44pt targets, a non-colour selection
 *        cue) and pressed states consistent with the rest of the kit. Options
 *        may carry a Feather icon so the picker mirrors the detail page's
 *        Car details rows.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour, Accessibility, Forms);
 *        src/shared/ui/ChoiceChips.tsx (single-select sibling);
 *        src/features/vehicles/lib/carDetails.ts (icon convention).
 *
 * Usage:
 *   <ChoiceChipsMulti
 *     options={[{ value: 'roof_rack', label: 'Roof rack', icon: 'box' }]}
 *     value={featureKeys}
 *     onChange={(next) => setAnswers({ featureKeys: next })}
 *   />
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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

type FeatherName = ComponentProps<typeof Feather>['name'];

export interface ChoiceChipMultiOption<V extends string = string> {
  value: V;
  label: string;
  /** Optional Feather icon shown left of the label (matches the detail
   *  page's Car details rows — lib/carDetails.ts). */
  icon?: FeatherName;
  /**
   * Optional colour DOT shown left of the label — a hex from the data (e.g.
   * CAR_COLOURS), not a theme token, so it is exempt from the token rule the
   * same way ColourField's swatches are.
   *
   * The label always stays: colour is NEVER the sole signal (DESIGN_SYSTEM;
   * ~4.5% of users have a colour-vision deficiency), so this decorates the
   * name rather than replacing it. Mutually exclusive with `icon` in practice
   * — a chip showing both would be noise.
   */
  swatch?: string;
}

export interface ChoiceChipsMultiProps<V extends string = string> {
  options: ChoiceChipMultiOption<V>[];
  /** Currently selected values; order is preserved by the caller's array. */
  value: V[];
  /** Receives the full next selection (the chip's toggle is applied for you). */
  onChange: (next: V[]) => void;
  /**
   * Optional cap. At the cap, unselected chips are disabled (and announced
   * disabled) so the group can't exceed it; selected chips still deselect.
   */
  max?: number;
  /**
   * One horizontally-scrolling line instead of wrapping onto several.
   *
   * Same trade-off ChoiceChips documents: wrapping is right when the group is
   * short and vertical space is free, wrong when it is long. The search sheet's
   * 15 colours wrap to a five-row block that dominates the surface and makes
   * the sheet's height jump as sections expand; one scrolling line keeps every
   * row exactly one chip tall.
   *
   * The scroller is full-bleed and owns the screen gutter itself, so chips can
   * scroll out under the edge: the CALLER must not add horizontal padding.
   */
  scrollable?: boolean;
  /**
   * The CONTAINER's own horizontal padding, when `scrollable` sits inside a
   * padded parent (a card) rather than on a full-bleed screen.
   *
   * The scroller negates it (so chips reach the container's true edge and can
   * scroll out under it) and re-applies it to the content (so the first chip
   * still lines up with the label above). Without this the two paddings STACK:
   * a card padded by `lg` hosting the default `xl` content gutter indents its
   * chips ~40px from their own label, and the last chip stops short of the edge
   * so nothing hints there is more to the right.
   *
   * Omit on a full-bleed screen — the default gutter is correct there.
   */
  bleed?: number;
  /** Optional — the chip ROW takes this, the scroller takes `${testID}-scroller`. */
  testID?: string;
}

export function ChoiceChipsMulti<V extends string = string>({
  options,
  value,
  onChange,
  max,
  scrollable = false,
  bleed,
  testID,
}: ChoiceChipsMultiProps<V>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const atCap = max !== undefined && value.length >= max;

  const toggle = (option: V) => {
    onChange(
      value.includes(option)
        ? value.filter((v) => v !== option)
        : [...value, option],
    );
  };

  const chips = (
    <View style={[styles.row, scrollable && styles.rowScrollable]} testID={testID}>
      {options.map((option) => {
        const selected = value.includes(option.value);
        // Only unselected chips are blocked at the cap — you can always remove.
        const disabled = atCap && !selected;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => toggle(option.value)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              disabled && styles.chipDisabled,
              pressed &&
                !disabled &&
                (selected ? styles.chipSelectedPressed : styles.chipPressed),
            ]}
          >
            {option.swatch ? (
              // ALWAYS ringed, in both states. The chip fills with `primary`
              // (near-black) when selected, so an unringed dark swatch — Black
              // is #1A1A1A — would disappear into it; and a light swatch
              // (White, Silver) disappears into the resting `surfaceSubtle`.
              // One border that flips with the chip's state covers both, in
              // both palettes, which is why this isn't only applied to the
              // `light` colours the way ColourField's grid does it.
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: option.swatch },
                  selected && styles.swatchSelected,
                ]}
                importantForAccessibility="no"
                // Named so a test can assert THIS node is hidden from assistive
                // tech — the chip's own checked state doesn't prove it, and the
                // sibling icons carry the same prop.
                testID="choice-chip-swatch"
              />
            ) : null}
            {option.icon ? (
              <Feather
                name={option.icon}
                size={sizes.iconSm}
                color={selected ? palette.textOnPrimary : palette.textSecondary}
                importantForAccessibility="no"
              />
            ) : null}
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {option.label}
            </Text>
            {/* Trailing check: a selection cue that doesn't rely on colour
                alone. The slot is always present (fixed width) so toggling shows
                the tick WITHOUT resizing the chip and reflowing the wrapped row. */}
            <View style={styles.checkSlot}>
              {selected ? (
                <Feather
                  name="check"
                  size={sizes.iconSm}
                  color={palette.textOnPrimary}
                  importantForAccessibility="no"
                />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) {
    return chips;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The gutter lives on the CONTENT, not the scroller, so the first chip
      // starts on the screen margin while the last can scroll under the edge —
      // which is what tells the user there is more to the right.
      style={bleed === undefined ? undefined : { marginHorizontal: -bleed }}
      contentContainerStyle={
        bleed === undefined ? styles.scrollContent : { paddingHorizontal: bleed }
      }
      testID={testID ? `${testID}-scroller` : undefined}
    >
      {chips}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    rowScrollable: {
      flexWrap: 'nowrap',
    },
    scrollContent: {
      paddingHorizontal: spacing.xl,
    },
    // A circle, not a square: matches ColourField's swatches so the two colour
    // pickers in the app read as the same idea.
    swatch: {
      width: sizes.iconSm,
      height: sizes.iconSm,
      borderRadius: radii.full,
      borderWidth: 1,
      // textSecondary, NOT borderStrong. The ring is doing ALL the work on the
      // resting chip — White (#F4F5F7 on surfaceSubtle) and Black (#1A1A1A on
      // the dark fill) both vanish into it, so the outline IS the swatch there.
      // borderStrong measures 2.61:1 light / 2.82:1 dark against the chip,
      // under the 3:1 non-text minimum, and its shortfall is a known gap in
      // DESIGN_SYSTEM. textSecondary clears it: 4.66:1 / 5.69:1.
      borderColor: c.textSecondary,
    },
    swatchSelected: {
      borderColor: c.textOnPrimary,
    },
    chip: {
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    checkSlot: {
      width: sizes.iconSm,
      alignItems: 'center',
    },
    chipSelected: {
      backgroundColor: c.primary,
    },
    chipDisabled: {
      opacity: opacity.disabled,
    },
    chipPressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    chipSelectedPressed: {
      backgroundColor: c.primaryPressed,
    },
    label: {
      ...typography.label,
      color: c.textPrimary,
    },
    labelSelected: {
      color: c.textOnPrimary,
    },
  });
