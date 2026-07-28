/**
 * WHAT:  GarageCard — one saved car: cover photo (or a calm placeholder), the
 *        owner's name for it, a PlateChip, and the primary "Report this car
 *        stolen" action. A car with a live post swaps that action for a
 *        "Currently reported stolen" link through to the listing. An overflow
 *        opens Edit / Remove.
 * WHY:   The report action is the whole point of the garage, so it is the card's
 *        primary control rather than something behind a menu — this is the tap
 *        that has to be findable by someone whose car has just gone. Feature-
 *        local (not shared/ui) because it is not a post card: no bounty, no
 *        distance, no watch toggle. If a second feature ever needs it, promote
 *        then (ARCHITECTURE.md: premature sharing is worse than duplication).
 *
 *        NO verification badge. verification_state is dormant — every row reads
 *        'unverified' — and a badge that always says the same thing is noise
 *        that would also imply a check we do not perform.
 * LINKS: src/features/garage/screens/MyCarsScreen.tsx (the list);
 *        src/features/garage/lib/vehicleAnswers.ts (display name);
 *        src/shared/ui (AppImage, PlateChip, Button).
 */

import { Car, MoreHorizontal } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { AppImage, Button, PlateChip } from '@/shared/ui';

import { vehicleDisplayName } from '../lib/vehicleAnswers';
import type { SavedVehicle } from '../types';

export interface GarageCardProps {
  vehicle: SavedVehicle;
  /** Start a prefilled stolen-car report from this car. */
  onReportStolen: () => void;
  /** Open the live post this car is already reported on. */
  onOpenPost: () => void;
  /**
   * Open the overflow (Edit / Remove). Omit to hide it: on the "which car?"
   * chooser, tidying the garage is the wrong offer to someone who has just had
   * a car stolen, and the card should present exactly one thing to do.
   */
  onOpenActions?: () => void;
}

export function GarageCard({
  vehicle,
  onReportStolen,
  onOpenPost,
  onOpenActions,
}: GarageCardProps) {
  const cover = vehicle.photos[0]?.url;
  const name = vehicleDisplayName(vehicle);
  // The make/model line is redundant when the nickname IS the make/model.
  const subtitle = [vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  return (
    <View style={styles.card} testID={`garage-card-${vehicle.id}`}>
      <View style={styles.topRow}>
        {cover ? (
          <AppImage uri={cover} style={styles.photo} accessibilityLabel={`Photo of ${name}`} />
        ) : (
          // A saved car needs no photos, so the empty state is calm and normal,
          // never an error or a nag.
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Car size={sizes.icon} color={colors.textSecondary} />
          </View>
        )}

        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {subtitle !== name ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {vehicle.plate ? (
            <View style={styles.plateRow}>
              <PlateChip plate={vehicle.plate} />
            </View>
          ) : null}
        </View>

        {onOpenActions ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More options for ${name}`}
            hitSlop={spacing.sm}
            onPress={onOpenActions}
            style={styles.overflow}
            testID={`garage-card-actions-${vehicle.id}`}
          >
            <MoreHorizontal size={sizes.iconSm} color={colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>

      {vehicle.isCurrentlyPosted ? (
        // Already reported: never offer a second report (create_post would
        // refuse it as PLATE_IN_USE anyway) — send them to the live listing.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name} is currently reported stolen — open the listing`}
          onPress={onOpenPost}
          style={styles.postedRow}
          testID={`garage-card-posted-${vehicle.id}`}
        >
          <Text style={styles.postedLabel}>Currently reported stolen</Text>
          <Text style={styles.postedLink}>View listing</Text>
        </Pressable>
      ) : (
        <View testID={`garage-card-report-${vehicle.id}`}>
          <Button label="Report this car stolen" variant="secondary" onPress={onReportStolen} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  photo: {
    width: 72,
    height: 54, // 4:3, matching the photo grid aspect
    borderRadius: radii.md,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  identity: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  plateRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  overflow: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -(sizes.touchTarget - sizes.iconSm) / 2,
  },
  postedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    // This is the one control someone taps mid-theft — it gets a full target.
    minHeight: sizes.touchTarget,
  },
  postedLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  postedLink: {
    ...typography.body,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
