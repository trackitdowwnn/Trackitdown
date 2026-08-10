/**
 * WHAT:  VehicleSummaryStep — the hero confirmation that replaces the posting
 *        wizard's seven-step `car` phase when the report was started from a
 *        saved car: one tall (4:5) cover photo with the car's identity laid
 *        over its lower edge on an overlay strip — identity on the left,
 *        the underlined "Edit" on the strip's right — and a quiet meta line
 *        beneath (photo + distinctive-feature counts). No helper subtext:
 *        the question and the photo carry the moment (product calls
 *        2026-07-29).
 * WHY:   "Is this the car?" is answered by RECOGNISING it, so the photo is
 *        the screen (the reference's photography-first language at full
 *        strength — redesigned 2026-07-29, second pass, after the card
 *        treatment read as too quiet for the moment). The overlay strip uses
 *        `mediaScrim` + `textOnMedia` per its existing photo-chrome precedent
 *        (CameraCapture, PhotoGridPicker) — no gradient dependency invented.
 *        NOT `overlay`/`textOnPrimary`: those track the PAGE and flip with the
 *        scheme, and a photo is exactly as bright in dark mode as in light, so
 *        chrome sitting on one must not flip with it (see theme/c.ts).
 *
 *        The hero is DISPLAY-ONLY (no onPress) on purpose: under a yes/no
 *        question a tappable artifact is a tap-to-affirm trap — people tap
 *        the thing to say "yes", which would instead fire Edit and drop a
 *        distressed owner into the seven-step marathon. "Yes" is the
 *        footer's primary; changing anything is the explicit link.
 *
 *        A car saved without photos falls back to a calm placeholder frame
 *        with the identity BELOW it (there is nothing to protect text
 *        against, and white-on-grey would fail contrast).
 * LINKS: src/features/garage/lib/prefilledPostFlow.tsx (builds the flow that
 *          uses this + owns the helper copy);
 *        src/shared/ui/CameraCapture.tsx (the overlay-on-photo precedent);
 *        src/features/garage/screens/ReportSavedCarScreen.tsx.
 */

import { Car } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage, PlateChip } from '@/shared/ui';

import { vehicleDisplayName } from '../lib/vehicleAnswers';
import type { SavedVehicle } from '../types';

/** Tall hero ratio — the confirmation moment earns portrait presence, unlike
 *  the browsing card's landscape 4:3. Component-local by design. */
const HERO_ASPECT_RATIO = 4 / 5;

export interface VehicleSummaryStepProps {
  vehicle: SavedVehicle;
  /** Jump into the real vehicle steps to change something. */
  onEdit: () => void;
}

export function VehicleSummaryStep({ vehicle, onEdit }: VehicleSummaryStepProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const cover = vehicle.photos[0]?.url;
  const name = vehicleDisplayName(vehicle);
  const photoCount = vehicle.photos.length;
  const featureCount = vehicle.distinctiveFeatures.length;
  const meta = [
    photoCount === 1 ? '1 photo' : `${photoCount} photos`,
    featureCount > 0
      ? featureCount === 1
        ? '1 distinctive feature'
        : `${featureCount} distinctive features`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.block} testID="vehicle-summary">
      <View style={styles.hero}>
        {cover ? (
          <>
            {/* Decorative: the identity is real text on the strip below. */}
            <AppImage uri={cover} style={styles.heroPhoto} />
            {/* Identity left, Edit bottom-right — one strip carries both
                (product call 2026-07-29). White + underline keeps the
                "underline = tappable" rule legible on the overlay. */}
            <View style={styles.identityStrip}>
              <View style={styles.identityBlock}>
                <Text style={styles.heroName} numberOfLines={1}>
                  {name}
                </Text>
                <View style={styles.heroMetaRow}>
                  {vehicle.plate ? <PlateChip plate={vehicle.plate} onPress={null} /> : null}
                  {vehicle.colour ? (
                    <Text style={styles.heroColour} numberOfLines={1}>
                      {vehicle.plate ? `· ${vehicle.colour}` : vehicle.colour}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit your car's details"
                hitSlop={spacing.sm}
                onPress={onEdit}
                style={styles.editOnStrip}
                testID="vehicle-summary-edit"
              >
                <Text style={styles.editOnStripLabel}>Edit</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.heroPlaceholder}>
            <Car size={sizes.icon} color={palette.textSecondary} />
          </View>
        )}
      </View>

      {!cover ? (
        // No photo, no strip — the identity and the Edit affordance read
        // below the frame instead, in standard ink.
        <View style={styles.fallbackIdentity}>
          <Text style={styles.fallbackName} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.heroMetaRow}>
            {vehicle.plate ? <PlateChip plate={vehicle.plate} onPress={null} /> : null}
            {vehicle.colour ? (
              <Text style={styles.fallbackColour}>{vehicle.colour}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit your car's details"
            hitSlop={spacing.sm}
            onPress={onEdit}
            style={styles.fallbackEdit}
            testID="vehicle-summary-edit"
          >
            <Text style={styles.fallbackEditLabel}>Edit</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.meta}>{meta}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  block: {
    gap: spacing.lg,
  },
  hero: {
    width: '100%',
    aspectRatio: HERO_ASPECT_RATIO,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: c.surfaceSubtle,
  },
  heroPhoto: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The identity, protected by the app's one overlay tone (photo-chrome
  // precedent: CameraCapture, PhotoGridPicker). Full-width strip, not a
  // floating pill — the text needs a consistent backing on any photo.
  identityStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.mediaScrim,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  identityBlock: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  editOnStrip: {
    minHeight: sizes.touchTarget,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xs,
  },
  editOnStripLabel: {
    ...typography.label,
    color: c.textOnMedia,
    textDecorationLine: 'underline',
  },
  heroName: {
    ...typography.sectionTitle,
    color: c.textOnMedia,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroColour: {
    ...typography.label,
    color: c.textOnMedia,
  },
  fallbackIdentity: {
    gap: spacing.xs,
  },
  fallbackName: {
    ...typography.sectionTitle,
    color: c.textPrimary,
  },
  fallbackColour: {
    ...typography.label,
    color: c.textSecondary,
  },
  fallbackEdit: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: sizes.touchTarget,
  },
  fallbackEditLabel: {
    ...typography.body,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  meta: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
