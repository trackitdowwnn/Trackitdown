/**
 * WHAT:  CompassPicker — the driving-direction control: a 3×3 tap grid of the
 *        eight compass points around a decorative compass hub. One glance,
 *        one tap; tapping the selected direction clears it.
 * WHY:   Eight labelled chips ("North-East" …) wrap into a wall of reading —
 *        the spotter is standing in a car park watching a car drive away.
 *        A spatial grid IS the answer's shape: tap where it went. Abbreviated
 *        glyphs stay visible (N/NE/…); screen readers get the full word and
 *        radio semantics. Skippable by construction — no selection is a valid
 *        state and the wizard never requires one.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (consumer);
 *        src/features/sightings/types.ts (DRIVING_DIRECTIONS);
 *        docs/DESIGN_SYSTEM.md (44pt targets, chip colours).
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';

import type { DrivingDirection } from '../types';

const DIRECTION_WORDS: Record<DrivingDirection, string> = {
  N: 'North',
  NE: 'North-East',
  E: 'East',
  SE: 'South-East',
  S: 'South',
  SW: 'South-West',
  W: 'West',
  NW: 'North-West',
};

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
}

export function CompassPicker({ value, onChange }: CompassPickerProps) {
  return (
    <View accessibilityRole="radiogroup" style={styles.grid} testID="compass-picker">
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
                  <Feather name="compass" size={sizes.iconSm} color={colors.textSecondary} />
                </View>
              );
            }
            const selected = direction === value;
            return (
              <Pressable
                key={direction}
                accessibilityRole="radio"
                accessibilityLabel={`Heading ${DIRECTION_WORDS[direction]}`}
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
                <Text style={[styles.label, selected && styles.labelSelected]}>{direction}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cell: {
    width: sizes.control,
    height: sizes.control,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hub: {
    backgroundColor: 'transparent',
  },
  cellSelected: {
    backgroundColor: colors.primary,
  },
  cellPressed: {
    backgroundColor: colors.surfaceSubtlePressed,
  },
  cellSelectedPressed: {
    backgroundColor: colors.primaryPressed,
  },
  label: {
    ...typography.label,
    color: colors.textPrimary,
  },
  labelSelected: {
    color: colors.textOnPrimary,
  },
});
