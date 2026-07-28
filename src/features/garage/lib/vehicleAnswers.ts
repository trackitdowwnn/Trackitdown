/**
 * WHAT:  Pure mapping between a SavedVehicle and the wizard answers — `toAnswers`
 *        (garage row → editable answers, also the posting prefill), plus the two
 *        derived facts the UI needs: the one-line summary and whether the car
 *        has enough photos to post as-is.
 * WHY:   This is the seam that makes "report this car stolen" fast AND keeps the
 *        features acyclic: the garage maps its own row into the plain
 *        VehicleAnswers shape, so features/vehicles never has to know a garage
 *        exists (ARCHITECTURE.md rule 1). Pure and dependency-free so it is
 *        cheaply testable — and it is worth testing, because a field silently
 *        dropped here becomes a detail missing from a real stolen-car listing.
 *
 *        PHOTOS ARE NOT RE-UPLOADED. Saved photos are already public post-photos
 *        URLs in the owner's own folder, so they map to answers as remote URIs
 *        and the save path passes them through untouched (isRemotePhoto). That
 *        is most of the "seconds not minutes" win.
 * LINKS: src/features/garage/screens/AddVehicleScreen.tsx (edit prefill);
 *        src/features/garage/screens/ReportSavedCarScreen.tsx (post prefill);
 *        src/features/garage/api/garageApi.ts (the save path).
 */

import type { AddVehicleAnswers, SavedVehicle } from '../types';

/** Minimum photos create_post demands (PHOTO_COUNT). A saved car below this is
 *  still worth having — the posting flow simply keeps its real photos step. */
export const MIN_PHOTOS_TO_POST = 3;

/** Placeholder dimensions for an already-uploaded photo. It is never re-encoded
 *  or resized, so only their positivity matters (the photo schema). */
const KEPT_PHOTO_DIMS = { width: 1600, height: 1200 };

/** A saved car as editable wizard answers. */
export function toAnswers(vehicle: SavedVehicle): AddVehicleAnswers {
  return {
    plate: vehicle.plate ?? '',
    make: vehicle.make,
    model: vehicle.model,
    colour: vehicle.colour,
    colourNote: vehicle.colourNote ?? '',
    year: vehicle.year,
    bodyType: vehicle.bodyType,
    distinctiveFeatures: vehicle.distinctiveFeatures.map((feature) => ({
      photo: { uri: feature.photoUrl, ...KEPT_PHOTO_DIMS },
      description: feature.description,
    })),
    photos: vehicle.photos.map((photo) => ({ uri: photo.url, ...KEPT_PHOTO_DIMS })),
    nickname: vehicle.nickname ?? '',
  };
}

/** True when the car can satisfy the posting wizard's photo step as-is. */
export function hasEnoughPhotosToPost(vehicle: SavedVehicle): boolean {
  return vehicle.photos.length >= MIN_PHOTOS_TO_POST;
}

/**
 * The confirm line on the prefilled posting wizard —
 * "Blue BMW 320d · AB12 CDE · 4 photos". Omits parts the car doesn't have
 * rather than printing empty separators or "Not provided": this is a summary the
 * owner is confirming under stress, not an inventory.
 */
export function vehicleSummaryLine(vehicle: SavedVehicle): string {
  const parts: string[] = [
    [vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(' '),
  ];
  if (vehicle.plate?.trim()) {
    parts.push(vehicle.plate.trim());
  }
  const photoCount = vehicle.photos.length;
  parts.push(photoCount === 1 ? '1 photo' : `${photoCount} photos`);
  return parts.join(' · ');
}

/** The card's display name: the owner's nickname, else make + model. */
export function vehicleDisplayName(vehicle: SavedVehicle): string {
  const nickname = vehicle.nickname?.trim();
  return nickname || `${vehicle.make} ${vehicle.model}`;
}
