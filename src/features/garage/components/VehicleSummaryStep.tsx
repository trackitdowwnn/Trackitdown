/**
 * WHAT:  "Your car" — the step that stands in for the posting wizard's seven
 *        car questions when the report is for a SAVED car: every photo to
 *        swipe through, the make and model (the owner's nickname, if any,
 *        beneath), the plate, one line of details ("Blue · 2019 · Saloon")
 *        with "Edit details" right under it, then the distinctive features.
 *        The footer's primary is "Continue".
 * WHY:   It used to ask "Is this the car?" over one tall photo, with the rest
 *        reduced to a count ("4 photos · 2 distinctive features"). The owner
 *        had just CHOSEN this car, so the question was redundant, and the
 *        screen showed too little to be worth stopping on (2026-10-08). It now
 *        earns its place by showing the car as spotters will see it — no
 *        question to answer, just a last look before the report goes on.
 *
 *        ⚠️ MAKE AND MODEL LEAD, NEVER THE NICKNAME. Spotters never see a
 *        nickname; a sheet headed "Betsy" would show the owner everything
 *        except what the listing says (UI review of #144).
 *
 *        ⚠️ DISPLAY-ONLY PHOTOS. Swipe, never tap: under a "Continue", a
 *        tappable photo is a tap-to-affirm trap (MediaIdentityCard's rule,
 *        which PhotoPager keeps). The only other tap targets are the plate
 *        chip (it copies the plate) and "Edit details".
 *
 *        Unknowns are LEFT OUT, never printed: a missing year, the body
 *        type's "Not sure", or an escape colour ("Other") with no note to say
 *        what it is — the same rules as the review screen's preview.
 * LINKS: src/shared/ui/PhotoPager.tsx; src/shared/ui/DistinctiveFeatureList.tsx;
 *        src/features/garage/lib/prefilledPostFlow.tsx (builds the step and
 *          owns its question / CTA);
 *        src/features/vehicles/post/components/ReviewListingPreview.tsx (the
 *          same colour / detail rules, for the review screen).
 */

import { Car } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BODY_TYPE_UNKNOWN } from '@/features/vehicles';
import { swatchForName } from '@/shared/lib/carColours';
import {
  opacity,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
  radii,
} from '@/shared/theme';
import { DistinctiveFeatureList, PhotoPager, PlateChip } from '@/shared/ui';
import { WIZARD_GUTTER } from '@/shared/wizard';

import type { SavedVehicle } from '../types';
import { GARAGE_PHOTO_ASPECT_RATIO } from './GarageCard';

export interface VehicleSummaryStepProps {
  vehicle: SavedVehicle;
  /** Jump into the real vehicle steps to change something. */
  onEdit: () => void;
}

/** What the listing calls the car: make and model. */
function makeAndModel(vehicle: SavedVehicle): string {
  return [vehicle.make, vehicle.model].filter((part) => part?.trim()).join(' ');
}

/**
 * "Blue · 2019 · Saloon" — only what is KNOWN. An escape colour ("Other",
 * "Multicolour / wrapped") gives way to the owner's own note, which is what
 * actually describes it — and with no note it is left out, as the review
 * preview does ("Other" says nothing a spotter can use).
 */
export function vehicleDetailLine(vehicle: SavedVehicle): string {
  const colour = swatchForName(vehicle.colour)?.note
    ? vehicle.colourNote?.trim()
    : vehicle.colour?.trim();
  const bodyType = vehicle.bodyType?.trim();
  return [
    colour || null,
    vehicle.year ? String(vehicle.year) : null,
    bodyType && bodyType !== BODY_TYPE_UNKNOWN ? bodyType : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

export function VehicleSummaryStep({ vehicle, onEdit }: VehicleSummaryStepProps) {
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const name = makeAndModel(vehicle);
  const nickname = vehicle.nickname?.trim();
  const details = vehicleDetailLine(vehicle);
  const features = vehicle.distinctiveFeatures;

  return (
    <View testID="vehicle-summary">
      <PhotoPager
        photos={vehicle.photos.map((photo) => ({ uri: photo.url }))}
        aspectRatio={GARAGE_PHOTO_ASPECT_RATIO}
        // The wizard body's width, so the photos are there on the first frame.
        estimatedWidth={width - WIZARD_GUTTER * 2}
        alt={name}
        placeholderIcon={Car}
        style={styles.photos}
        testID="vehicle-summary-photos"
      />

      {/* The photo's own caption: close beneath it, so the two read as one
          object. Edit sits right under the details it would change. */}
      <View style={styles.identity}>
        <Text style={styles.name} accessibilityRole="header">
          {name}
        </Text>
        {nickname ? <Text style={styles.nickname}>{nickname}</Text> : null}
        {/* Its own line, as on the listing: beside a long name the chip
            wrapped anyway, inconsistently. A row wrapper, because the chip's
            own alignSelf would otherwise override the parent's alignment. */}
        {vehicle.plate ? (
          <View style={styles.plateRow}>
            <PlateChip plate={vehicle.plate} onPress={null} />
          </View>
        ) : null}
        {details ? <Text style={styles.details}>{details}</Text> : null}
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          style={({ pressed }) => [styles.edit, pressed && styles.editPressed]}
          testID="vehicle-summary-edit"
        >
          <Text style={styles.editLabel}>Edit details</Text>
        </Pressable>
      </View>

      {features.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Distinctive features
          </Text>
          {/* All of them: this is the owner's last look at their own car, and
              a full-width "Show all" would outweigh the step's one link. */}
          <DistinctiveFeatureList features={features} previewCount={features.length} />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    photos: {
      borderRadius: radii.lg,
    },
    identity: {
      marginTop: spacing.lg,
      gap: spacing.sm,
    },
    // sectionTitle (20), not title: the same size the review screen gives the
    // car's name, and a clear step down from the 32pt "Your car" above.
    name: {
      ...typography.sectionTitle,
      color: c.textPrimary,
      includeFontPadding: false,
    },
    nickname: {
      ...typography.caption,
      color: c.textSecondary,
    },
    plateRow: {
      flexDirection: 'row',
    },
    details: {
      ...typography.body,
      color: c.textSecondary,
    },
    // A real 44pt box, not hitSlop: slop outside the parent's bounds is not
    // reliably hit on Android (ReviewStep's Edit learned the same).
    edit: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
    },
    editPressed: {
      opacity: opacity.pressed,
    },
    editLabel: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
    // A new section: more air above than anywhere within the car's own block.
    section: {
      marginTop: spacing.xxl,
      gap: spacing.lg,
    },
    sectionTitle: {
      ...typography.heading,
      color: c.textPrimary,
    },
  });
