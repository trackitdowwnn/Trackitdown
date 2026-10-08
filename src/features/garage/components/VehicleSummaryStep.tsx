/**
 * WHAT:  "Your car" — the step that stands in for the posting wizard's seven
 *        car questions when the report is for a SAVED car: every photo to
 *        swipe through, the name and plate, one line of details ("Blue · 2019
 *        · Saloon"), the distinctive features, and "Edit details" (which opens
 *        the full questions, seeded). The footer's primary is "Continue".
 * WHY:   It used to ask "Is this the car?" over one tall photo, with the rest
 *        reduced to a count ("4 photos · 2 distinctive features"). The owner
 *        had just CHOSEN this car, so the question was redundant, and the
 *        screen showed too little to be worth stopping on (2026-10-08). It now
 *        earns its place by showing the car as spotters will see it — no
 *        question to answer, just a last look before the report goes on.
 *
 *        ⚠️ DISPLAY-ONLY PHOTOS. Swipe, never tap: under a "Continue", a
 *        tappable photo is a tap-to-affirm trap (MediaIdentityCard's rule,
 *        which PhotoPager keeps). Changing anything is the explicit link.
 *
 *        Unknowns are LEFT OUT, never printed: a missing year, or the body
 *        type's "Not sure" escape, is not a fact about the car (the same rule
 *        as the listing's detail rows and the review preview).
 * LINKS: src/shared/ui/PhotoPager.tsx; src/shared/ui/DistinctiveFeatureList.tsx;
 *        src/features/garage/lib/prefilledPostFlow.tsx (builds the step and
 *          owns its question / CTA);
 *        src/features/vehicles/post/components/ReviewListingPreview.tsx (the
 *          same colour / detail rules, for the review screen).
 */

import { Car } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BODY_TYPE_UNKNOWN } from '@/features/vehicles';
import { swatchForName } from '@/shared/lib/carColours';
import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { DistinctiveFeatureList, PhotoPager, PlateChip } from '@/shared/ui';

import { vehicleDisplayName } from '../lib/vehicleAnswers';
import type { SavedVehicle } from '../types';
import { GARAGE_PHOTO_ASPECT_RATIO } from './GarageCard';

export interface VehicleSummaryStepProps {
  vehicle: SavedVehicle;
  /** Jump into the real vehicle steps to change something. */
  onEdit: () => void;
}

/**
 * "Blue · 2019 · Saloon" — only what is KNOWN. An escape colour ("Other",
 * "Multicolour / wrapped") gives way to the owner's own note, which is what
 * actually describes it; with no note, the escape name stays.
 */
export function vehicleDetailLine(vehicle: SavedVehicle): string {
  const note = vehicle.colourNote?.trim();
  const colour = swatchForName(vehicle.colour)?.note && note ? note : vehicle.colour;
  const bodyType = vehicle.bodyType?.trim();
  return [
    colour?.trim() || null,
    vehicle.year ? String(vehicle.year) : null,
    bodyType && bodyType !== BODY_TYPE_UNKNOWN ? bodyType : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

export function VehicleSummaryStep({ vehicle, onEdit }: VehicleSummaryStepProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const name = vehicleDisplayName(vehicle);
  const details = vehicleDetailLine(vehicle);
  const features = vehicle.distinctiveFeatures;

  return (
    <View style={styles.root} testID="vehicle-summary">
      <PhotoPager
        photos={vehicle.photos.map((photo) => ({ uri: photo.url }))}
        aspectRatio={GARAGE_PHOTO_ASPECT_RATIO}
        alt={name}
        placeholder={<Car size={sizes.icon} color={palette.textSecondary} />}
        style={styles.photos}
        testID="vehicle-summary-photos"
      />

      <View style={styles.identity}>
        <View style={styles.nameRow}>
          <Text style={styles.name} accessibilityRole="header">
            {name}
          </Text>
          {vehicle.plate ? <PlateChip plate={vehicle.plate} onPress={null} /> : null}
        </View>
        {details ? <Text style={styles.details}>{details}</Text> : null}
      </View>

      {features.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Distinctive features
          </Text>
          <DistinctiveFeatureList features={features} />
        </View>
      ) : null}

      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel="Edit your car's details"
        hitSlop={spacing.sm}
        style={({ pressed }) => [styles.edit, pressed && styles.editPressed]}
        testID="vehicle-summary-edit"
      >
        <Text style={styles.editLabel}>Edit details</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: spacing.xl,
    },
    photos: {
      borderRadius: radii.lg,
    },
    identity: {
      gap: spacing.xs,
    },
    // Wraps, so a long nickname at large text pushes the plate onto its own
    // line instead of squeezing either.
    nameRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: spacing.md,
      rowGap: spacing.sm,
    },
    name: {
      ...typography.title,
      color: c.textPrimary,
      flexShrink: 1,
    },
    details: {
      ...typography.body,
      color: c.textSecondary,
    },
    section: {
      gap: spacing.md,
    },
    sectionTitle: {
      ...typography.label,
      color: c.textPrimary,
    },
    // A text link, left-aligned with everything above it, with a full-height
    // target (hitSlop brings the 20pt line up to the 44pt minimum).
    edit: {
      alignSelf: 'flex-start',
      minHeight: sizes.touchTarget - spacing.sm * 2,
      justifyContent: 'center',
    },
    editPressed: {
      opacity: opacity.pressed,
    },
    editLabel: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
  });
