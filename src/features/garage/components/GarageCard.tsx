/**
 * WHAT:  GarageCard — one saved car, photography-first: full-width 3:2 cover
 *        photo (no border, no shadow — the photo IS the card), a quiet
 *        "Reported stolen" pill overlaid when the car has a live listing,
 *        then name, meta line, and the owner's PlateChip below. The whole
 *        card is one tap; it renders as a plain display block when no
 *        handler is given (the wizard's "Is this the car?" confirm reuses it
 *        as a genuine preview).
 * WHY:   Redesigned 2026-07-29 against Airbnb's host Listings-tab card: photo
 *        full-width with text below and status ON the photo, actions behind
 *        the tap rather than buttons on the card. The old row-card (72×54
 *        thumbnail inside a bordered box with an inline button and an
 *        overflow) was the one card in the app that didn't speak the feed's
 *        photography-first language. Buttons live in the actions sheet the
 *        tap opens (MyCarsScreen) — a card stays a noun.
 *
 *        The pill is the card's ONLY overlay, and it appears only in the
 *        exceptional state: a safe car's photo carries nothing, because for
 *        this app "nothing to report" IS the good news. (Note: driven by
 *        isCurrentlyPosted, which is dormant until README gap 1 is wired.)
 * LINKS: src/features/garage/screens/MyCarsScreen.tsx (tap → actions sheet);
 *        src/features/garage/components/VehicleSummaryStep.tsx (display use);
 *        src/shared/ui/VehicleCard.tsx (the press-scale pattern mirrored
 *        here); docs/DESIGN_SYSTEM.md.
 */

import { Car } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';

import {
  motion,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { AppImage, PlateChip, spellPlate } from '@/shared/ui';

import { vehicleDisplayName } from '../lib/vehicleAnswers';
import type { SavedVehicle } from '../types';

/** The card photo's ratio — VehicleCard's PHOTO_ASPECT_RATIO, so a car reads
 *  the same in the garage as on a listing. Exported for the skeleton. */
export const GARAGE_PHOTO_ASPECT_RATIO = 4 / 3;

export interface GarageCardProps {
  vehicle: SavedVehicle;
  /**
   * The card's single tap (MyCarsScreen opens the actions sheet). Omit for a
   * pure display render — the wizard's confirm step shows the card as an
   * artifact, not a control.
   */
  onPress?: () => void;
  testID?: string;
}

export function GarageCard({ vehicle, onPress, testID }: GarageCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const cover = vehicle.photos[0]?.url;
  const name = vehicleDisplayName(vehicle);
  const identity = [vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const photoCount = vehicle.photos.length;
  // Max three text levels on a card (the reference's rule): title, one meta
  // line, plate. When there's no nickname the title already IS make + model,
  // so the meta carries only what's NEW (colour, count) — never a repeat of
  // the title with one extra word (ui review #7).
  const photoCountLabel = photoCount === 1 ? '1 photo' : `${photoCount} photos`;
  const meta =
    name === `${vehicle.make} ${vehicle.model}`.trim()
      ? [vehicle.colour, photoCountLabel]
      : [identity, photoCountLabel];
  const metaLine = meta.filter(Boolean).join(' · ');

  // Press feedback: the design system's 0.98 scale, ANIMATED (the VehicleCard
  // pattern) — cards move like objects, not like buttons.
  const [pressed, setPressed] = useState(false);
  const pressScale = useAnimatedValue(1);
  useEffect(() => {
    Animated.timing(pressScale, {
      toValue: pressed ? motion.pressScale : 1,
      duration: motion.fast,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
  }, [pressed, pressScale]);
  useEffect(() => () => pressScale.stopAnimation(), [pressScale]);

  const body = (
    <Animated.View style={onPress ? { transform: [{ scale: pressScale }] } : undefined}>
      <View style={styles.photoFrame}>
        {cover ? (
          // Decorative — the text below carries the identity for readers.
          <AppImage uri={cover} recyclingKey={vehicle.id} style={styles.photo} />
        ) : (
          // A saved car needs no photos, so the empty frame stays calm and
          // normal — never an error or a nag.
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Car size={sizes.icon} color={palette.textSecondary} />
          </View>
        )}
        {vehicle.isCurrentlyPosted ? (
          // The only thing that may sit on the photo: the exceptional state.
          <View style={styles.statusPill} testID={`garage-card-posted-${vehicle.id}`}>
            <View style={styles.statusDot} />
            <Text style={styles.statusLabel}>Reported stolen</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {metaLine ? (
        <Text style={styles.meta} numberOfLines={1}>
          {metaLine}
        </Text>
      ) : null}
      {vehicle.plate ? (
        <View style={styles.plateRow}>
          {/* onPress forwarded: the chip's long-press-to-copy makes it the
              touch responder, which would otherwise eat the card's own tap.
              `null` when this card is a display-only render (no handler) —
              nothing encloses the chip then, so there is no tap to eat. */}
          <PlateChip plate={vehicle.plate} onPress={onPress ?? null} />
        </View>
      ) : null}
    </Animated.View>
  );

  if (!onPress) {
    return (
      <View testID={testID ?? `garage-card-${vehicle.id}`}>{body}</View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={
        // spellPlate: a reader must never attempt "AB12 CDE" as a word.
        `${name}${vehicle.plate ? `, plate ${spellPlate(vehicle.plate)}` : ''}` +
        (vehicle.isCurrentlyPosted ? ', currently reported stolen' : '') +
        '. Opens actions.'
      }
      testID={testID ?? `garage-card-${vehicle.id}`}
    >
      {body}
    </Pressable>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  photoFrame: {
    // Room for the pill; the photo itself clips to the radius.
    position: 'relative',
  },
  photo: {
    width: '100%',
    // VehicleCard's exact ratio (4:3) — the file's whole premise is that a
    // car reads the same in the garage as on a listing, so the ratio is the
    // feed's, not the reference's 3:2 (ui review #6).
    aspectRatio: GARAGE_PHOTO_ASPECT_RATIO,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceSubtle,
  },
  // StatusBadge's pill anatomy, token-for-token (ui review #2) — one photo-
  // overlay pill vocabulary across the app. Not StatusBadge itself only
  // because that component is PostStatus-keyed and this is a vehicle state.
  statusPill: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: c.surface,
    // The one sanctioned soft shadow: keeps the pill's EDGE legible on a
    // white car or bright sky (text contrast is already 14.9:1).
    ...shadows.soft,
  },
  statusDot: {
    width: sizes.progressDot,
    height: sizes.progressDot,
    borderRadius: radii.sm,
    // Neutral status mark, NOT danger: danger red is destructive/error UI
    // only, never decoration on "stolen" content (DESIGN_SYSTEM; ui review
    // critical #1). The words carry the meaning.
    backgroundColor: c.textPrimary,
  },
  statusLabel: {
    ...typography.label,
    color: c.textPrimary,
  },
  name: {
    ...typography.cardTitle,
    color: c.textPrimary,
    paddingTop: spacing.md,
  },
  meta: {
    ...typography.caption,
    color: c.textSecondary,
    paddingTop: spacing.xs,
  },
  plateRow: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
  },
});
