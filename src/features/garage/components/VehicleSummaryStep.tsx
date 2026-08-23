/**
 * WHAT:  The hero confirmation that replaces the posting wizard's seven-step
 *        `car` phase when the report was started from a saved car: one tall
 *        (4:5) cover photo with the car's identity laid over its lower edge,
 *        the underlined "Edit" on the strip's right, and a quiet meta line
 *        beneath (photo + distinctive-feature counts). No helper subtext: the
 *        question and the photo carry the moment (product calls 2026-07-29).
 * WHY:   "Is this the car?" is answered by RECOGNISING it, so the photo is the
 *        screen (the reference's photography-first language at full strength —
 *        redesigned 2026-07-29, second pass, after the card treatment read as
 *        too quiet for the moment).
 *
 *        The layout itself now lives in `shared/ui/MediaIdentityCard`,
 *        extracted 2026-08-22 when the posting wizard's review step needed the
 *        same moment for the same reason. THE RULES MOVED WITH IT and are
 *        documented there: the hero is display-only (a tappable artifact under
 *        a yes/no question is a tap-to-affirm trap), and photo chrome uses
 *        `mediaScrim`/`textOnMedia` rather than `overlay`/`textOnPrimary`,
 *        which track the page and would flip with the scheme while the
 *        photograph does not. This file keeps only what is about a VEHICLE:
 *        which fields make up the identity, and how the counts read.
 * LINKS: src/shared/ui/MediaIdentityCard.tsx (the layout + its rules);
 *        src/features/garage/lib/prefilledPostFlow.tsx (builds the flow that
 *          uses this + owns the helper copy);
 *        src/features/garage/screens/ReportSavedCarScreen.tsx.
 */

import { Car } from 'lucide-react-native';

import { MediaIdentityCard, PlateChip } from '@/shared/ui';

import { vehicleDisplayName } from '../lib/vehicleAnswers';
import type { SavedVehicle } from '../types';

export interface VehicleSummaryStepProps {
  vehicle: SavedVehicle;
  /** Jump into the real vehicle steps to change something. */
  onEdit: () => void;
}

export function VehicleSummaryStep({ vehicle, onEdit }: VehicleSummaryStepProps) {
  // Hoisted: narrowing does not survive into the closure below, and a `!`
  // assertion is a worse way to say the same thing.
  const plate = vehicle.plate;
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
    <MediaIdentityCard
      uri={vehicle.photos[0]?.url}
      name={vehicleDisplayName(vehicle)}
      // Handed `onMedia` so the chip picks theme-INVARIANT tokens when it
      // lands on the photo strip: its default `surfaceSubtle` fill tracks the
      // page, so in dark mode it turned charcoal beside white text that did
      // not — a flip the photograph underneath never makes.
      metaLeading={
        plate ? (onMedia) => <PlateChip plate={plate} onPress={null} onMedia={onMedia} /> : undefined
      }
      metaText={vehicle.colour ?? undefined}
      caption={meta}
      onEdit={onEdit}
      editAccessibilityLabel="Edit your car's details"
      placeholderIcon={Car}
      testID="vehicle-summary"
      editTestID="vehicle-summary-edit"
    />
  );
}
