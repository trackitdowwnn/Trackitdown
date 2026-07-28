/**
 * WHAT:  VehicleSummaryStep — the single screen that replaces the posting
 *        wizard's seven-step `car` phase when the report was started from a
 *        saved car. Shows the cover photo and one confirm line ("Blue BMW 320d ·
 *        AB12 CDE · 4 photos") with an Edit affordance.
 * WHY:   The payoff of the whole garage: a person whose car has just been stolen
 *        should confirm what we already know, not re-answer it. It is a
 *        CONFIRMATION, not a display — Edit jumps into the real steps, because a
 *        stolen car's details may need a last-minute correction (a new dent, the
 *        wrong colour saved months ago) and a prefill you cannot change would be
 *        worse than no prefill at all.
 *
 *        Deliberately NOT a read-only summary of the review screen: the review
 *        step already lists every answer. This one exists to make the phase
 *        pass in one tap.
 * LINKS: src/features/garage/lib/prefilledPostFlow.ts (builds the flow that
 *          uses this); src/features/garage/lib/vehicleAnswers.ts (the line);
 *        src/features/garage/screens/ReportSavedCarScreen.tsx.
 */

import { Car } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { AppImage, PlateChip } from '@/shared/ui';

import type { SavedVehicle } from '../types';

export interface VehicleSummaryStepProps {
  vehicle: SavedVehicle;
  /** Jump into the real vehicle steps to change something. */
  onEdit: () => void;
}

export function VehicleSummaryStep({ vehicle, onEdit }: VehicleSummaryStepProps) {
  const cover = vehicle.photos[0]?.url;
  const identity = [vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const photoCount = vehicle.photos.length;
  const photoCountLabel = photoCount === 1 ? '1 photo' : `${photoCount} photos`;

  return (
    <View style={styles.block} testID="vehicle-summary">
      <View style={styles.card}>
        {cover ? (
          // Decorative: the identity is read out below, so labelling the image
          // would make a screen reader announce the car twice.
          <AppImage uri={cover} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Car size={sizes.icon} color={colors.textSecondary} />
          </View>
        )}
        {/* The plate goes through PlateChip, never inline text: it renders as a
            plate AND spells itself out for screen readers, which would
            otherwise pronounce "AB12 CDE" as a word. */}
        <Text style={styles.line}>{identity}</Text>
        {vehicle.plate ? (
          <View style={styles.plateRow}>
            <PlateChip plate={vehicle.plate} />
          </View>
        ) : null}
        <Text style={styles.photoCount}>{photoCountLabel}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit your car's details"
        hitSlop={spacing.sm}
        onPress={onEdit}
        style={styles.editRow}
        testID="vehicle-summary-edit"
      >
        <Text style={styles.editLabel}>Edit these details</Text>
      </Pressable>

      <Text style={styles.helper}>
        From your garage. Anything here can still be changed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.lg,
  },
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  photo: {
    width: '100%',
    // 4:3 like every other car photo in the app, rather than borrowing the
    // map-preview height token (which a map tweak would then resize).
    aspectRatio: 4 / 3,
    borderRadius: radii.md,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  plateRow: {
    flexDirection: 'row',
  },
  photoCount: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  line: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  editRow: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: sizes.touchTarget,
  },
  editLabel: {
    ...typography.body,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  helper: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
