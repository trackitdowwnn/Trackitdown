/**
 * WHAT:  CompassPicker — the driving-direction control: a 3×3 tap grid of the
 *        eight compass points around a decorative compass hub. One glance,
 *        one tap; tapping the selected direction clears it.
 * WHY:   Eight labelled chips ("North-East" …) wrap into a wall of reading —
 *        the spotter is standing in a car park watching a car drive away.
 *        A spatial grid IS the answer's shape: tap where it went. Abbreviated
 *        glyphs stay visible (N/NE/…); screen readers get the full word and
 *        radio semantics, in contextLabels' words ("Heading north-east", as
 *        the owner reads it). Skippable by construction — no selection is a
 *        valid state and the wizard never requires one.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (consumer);
 *        src/features/sightings/lib/contextLabels.ts (directionLabel);
 *        src/features/sightings/types.ts (DRIVING_DIRECTIONS);
 *        docs/DESIGN_SYSTEM.md (44pt targets, chip colours).
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  compassFontScaleCap,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

import { directionLabel } from '../lib/contextLabels';
import type { DrivingDirection } from '../types';

/** Grid rows, screen-order; null is the decorative hub cell. */
const GRID: (DrivingDirection | null)[][] = [
  ['NW', 'N', 'NE'],
  ['W', null, 'E'],
  ['SW', 'S', 'SE'],
];

export interface CompassPickerProps {
  value: DrivingDirection | undefined;
  /** Called with the tapped direction, or undefined when the selected one is
   *  tapped again (clear). */
  onChange: (value: DrivingDirection | undefined) => void;
  /** The group's name for screen readers: the question it answers. */
  accessibilityLabel?: string;
}

/** The 3×3 direction grid; tapping the chosen point again clears it. */
export function CompassPicker({ value, onChange, accessibilityLabel }: CompassPickerProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={styles.grid}
      testID="compass-picker"
    >
      {GRID.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((direction, cellIndex) => {
            if (!direction) {
              return (
                <View
                  key={`hub-${cellIndex}`}
                  style={[styles.cell, styles.hub]}
                  // Decorative on both platforms (importantForAccessibility is
                  // Android-only; VoiceOver needs elementsHidden too).
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                >
                  <Feather name="compass" size={sizes.iconSm} color={palette.textSecondary} />
                </View>
              );
            }
            const selected = direction === value;
            return (
              <Pressable
                key={direction}
                accessibilityRole="radio"
                accessibilityLabel={directionLabel(direction)}
                accessibilityHint={selected ? 'Double tap to clear' : undefined}
                accessibilityState={{ checked: selected }}
                onPress={() => onChange(selected ? undefined : direction)}
                style={({ pressed }) => [
                  styles.cell,
                  selected && styles.cellSelected,
                  pressed && (selected ? styles.cellSelectedPressed : styles.cellPressed),
                ]}
                testID={`compass-${direction}`}
              >
                <Text
                  maxFontSizeMultiplier={compassFontScaleCap}
                  style={[styles.label, selected && styles.labelSelected]}
                >
                  {direction}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // Centred in whatever holds it (2026-10-01): a compass reads as a compass
  // when it sits in the middle, where the rest of the step is left-aligned
  // text and chips.
  grid: {
    gap: spacing.sm,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cell: {
    width: sizes.control,
    height: sizes.control,
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hub: {
    backgroundColor: 'transparent',
  },
  cellSelected: {
    backgroundColor: c.primary,
  },
  cellPressed: {
    backgroundColor: c.surfaceSubtlePressed,
  },
  cellSelectedPressed: {
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
