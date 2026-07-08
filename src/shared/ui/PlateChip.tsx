/**
 * WHAT:  PlateChip — a UK registration rendered in plate styling: bold,
 *        letter-spaced uppercase on a surfaceSubtle chip (the design
 *        system's one sanctioned ALL-CAPS moment).
 * WHY:   Plates are the app's core identifier and must be instantly
 *        recognisable everywhere they appear (cards, post detail, sightings,
 *        chat). Screen readers get the plate spelled character by character
 *        ("A B 1 2, C D E") — read as a word it's meaningless.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components: PlateChip; Typography);
 *        src/shared/theme (typography.plate).
 *
 * Usage:
 *   <PlateChip plate="AB12 CDE" />
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme';

export interface PlateChipProps {
  /** Registration as stored ("AB12 CDE" or "ab12cde" — rendered uppercase). */
  plate: string;
}

/** "AB12 CDE" → "A B 1 2, C D E" so screen readers spell, not pronounce. */
export function spellPlate(plate: string): string {
  return plate
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .map((group) => group.split('').join(' '))
    .join(', ');
}

/** UK registration in plate styling, spelled out for screen readers. */
export function PlateChip({ plate }: PlateChipProps) {
  return (
    <View
      accessible
      accessibilityLabel={`Plate ${spellPlate(plate)}`}
      style={styles.chip}
    >
      <Text style={styles.plate}>{plate.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  plate: {
    ...typography.plate,
    color: colors.textPrimary,
  },
});
