/**
 * WHAT:  Supabase access for the garage — list / add / update / delete a saved
 *        vehicle. Zod-validates the list_my_vehicles payload and maps it to
 *        SavedVehicle; uploads any newly-picked photos before the save RPCs and
 *        translates their raised codes into plain-English copy.
 * WHY:   The RPCs apply the owner scope (auth.uid()) server-side, so this file
 *        only validates + renames — a shape drift fails loudly instead of
 *        rendering garbage (the myPostsApi contract). Photo uploads reuse the
 *        POSTING path deliberately: a garage photo lands in the post-photos
 *        bucket under the caller's own folder, so create_post's URL regex
 *        accepts it later with NO re-upload — that is most of this feature's
 *        "seconds not minutes" win.
 *        Logs are [garage], ids only — NEVER plates (docs/LOGGING.md): a plate
 *        is personal data and the garage holds them for cars never stolen.
 * LINKS: supabase/migrations/20260801100000_garage_vehicles.sql (the 4 RPCs);
 *        src/features/garage/hooks/useMyVehicles.ts (consumer);
 *        src/shared/api/photoUpload.ts (the upload both features share);
 *        src/features/garage/lib/vehicleSaveError.ts;
 *        src/features/vehicles/api/myPostsApi.ts (the mapping this mirrors).
 */

import { z } from 'zod';

import { isRemotePhoto, supabase, uploadOwnFolderPhoto } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { PickedPhoto } from '@/shared/ui';

import { invalidateSavedCarSignal } from '../lib/savedCarSignal';
import { VehicleSaveError } from '../lib/vehicleSaveError';
import type { AddVehicleAnswers, SavedVehicle, SaveVehicleParams } from '../types';

const log = createLogger('garage');

const SAVE_FALLBACK = 'We couldn’t save your car. Please try again.';

/**
 * Plain-English copy for every code the garage RPCs raise. Deliberately its OWN
 * map rather than an extension of create_post's: importing that would pull the
 * whole vehicles barrel — and through PostDetailScreen, the Stripe native
 * module — into the garage's data layer. The overlapping codes are the ones the
 * shared validation raises, so the wording is kept consistent by hand.
 */
const GARAGE_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Please sign in to save a car.',
  MISSING_REQUIRED: 'Please add the make, model and colour.',
  INVALID_PLATE: 'That number plate doesn’t look right.',
  PHOTO_COUNT: 'You can add up to 6 photos.',
  INVALID_PHOTO_URL: 'One of your photos didn’t upload properly. Please try again.',
  DISTINCTIVE_FEATURES_COUNT: 'You can add up to 8 distinctive features.',
  INVALID_DISTINCTIVE_FEATURE: 'Each distinctive feature needs a short description (3–80 characters).',
  INVALID_DISTINCTIVE_PHOTO_URL:
    'One of your feature photos didn’t upload properly. Please try again.',
  VEHICLE_LIMIT_REACHED: 'You can save up to 5 cars. Remove one to add another.',
  PLATE_ALREADY_SAVED: 'That car is already in your garage.',
  VEHICLE_NOT_FOUND: 'We couldn’t find that car.',
  VEHICLE_HAS_ACTIVE_POST:
    'This car is currently reported stolen. You can remove it once that listing is closed.',
};

const photoSchema = z.object({ url: z.string(), position: z.number().int() });
const featureSchema = z.object({
  photo_url: z.string(),
  description: z.string(),
  position: z.number().int(),
});

const vehicleRowSchema = z.object({
  id: z.guid(),
  plate: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  colour: z.string(),
  colour_note: z.string().nullable(),
  year: z.number().int().nullable(),
  body_type: z.string().nullable(),
  nickname: z.string().nullable(),
  verification_state: z.enum(['unverified', 'pending', 'verified', 'rejected']),
  photos: z.array(photoSchema),
  distinctive_features: z.array(featureSchema),
  is_currently_posted: z.boolean(),
  active_post_id: z.guid().nullable(),
  created_at: z.string(),
});

type VehicleRow = z.infer<typeof vehicleRowSchema>;

function toSavedVehicle(row: VehicleRow): SavedVehicle {
  return {
    id: row.id,
    plate: row.plate,
    make: row.make,
    model: row.model,
    colour: row.colour,
    colourNote: row.colour_note,
    year: row.year,
    bodyType: row.body_type,
    nickname: row.nickname,
    verificationState: row.verification_state,
    photos: row.photos.map((p) => ({ url: p.url, position: p.position })),
    distinctiveFeatures: row.distinctive_features.map((f) => ({
      photoUrl: f.photo_url,
      description: f.description,
      position: f.position,
    })),
    isCurrentlyPosted: row.is_currently_posted,
    activePostId: row.active_post_id,
    createdAt: row.created_at,
  };
}

/** The caller's saved vehicles, newest first (RPC-ordered). */
export async function listMyVehicles(): Promise<SavedVehicle[]> {
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('list_my_vehicles');
  if (error) {
    log.error('garage_load failed', { code: error.code });
    throw error;
  }
  const rows = z.array(vehicleRowSchema).parse(data ?? []);
  const vehicles = rows.map(toSavedVehicle);
  log.info('garage_load', { count: vehicles.length, durationMs: Date.now() - startedAt });
  return vehicles;
}

/** Call a garage RPC and translate its raised code into user-facing copy. */
async function callGarageRpc(fn: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) {
    // hasOwn, not `in`: `in` walks the prototype chain, so a Postgres message of
    // "toString" or "constructor" would look known and hand a FUNCTION to the
    // user as their error text.
    const known = Object.hasOwn(GARAGE_ERROR_MESSAGES, error.message);
    const message = known ? GARAGE_ERROR_MESSAGES[error.message] : SAVE_FALLBACK;
    log.warn(`${fn} rejected`, { code: error.code, reason: known ? error.message : undefined });
    throw new VehicleSaveError(message, known ? error.message : 'RPC_ERROR');
  }
  return data;
}

/** Resolve the signed-in user's id, or fail with the auth message. */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new VehicleSaveError(GARAGE_ERROR_MESSAGES.NOT_AUTHENTICATED, 'NOT_AUTHENTICATED');
  }
  return data.user.id;
}

/** Upload each newly-picked local photo (keeping remote URLs), in order. */
async function resolvePhotoUrls(
  userId: string,
  photos: PickedPhoto[],
  keyPrefix = '',
): Promise<string[]> {
  const urls: string[] = [];
  for (const [index, photo] of photos.entries()) {
    urls.push(
      isRemotePhoto(photo.uri) ? photo.uri : await uploadOwnFolderPhoto(userId, photo, index, keyPrefix),
    );
  }
  return urls;
}

/** Trim to null so an empty optional box stores SQL NULL, not ''. Tolerates
 *  undefined — a step the user never opened has no answer at all. */
function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fill in the answers the wizard legitimately leaves UNDEFINED.
 *
 * The framework only stores what a step wrote, and FOUR of the garage's steps
 * are optional — plate, distinctive features, photos and nickname — so skipping
 * them all is not an edge case, it is the fastest happy path ("save the car,
 * I'll add photos later"). Treating `Partial<AddVehicleAnswers>` as complete is
 * therefore a lie: it crashed on `answers.photos.entries()` before this existed.
 *
 * make/model/colour are absent from the defaults deliberately — their steps are
 * required and schema-gated, so if they were missing the flow could not have
 * completed, and the server re-checks them anyway (MISSING_REQUIRED).
 */
function withDefaults(answers: Partial<AddVehicleAnswers>): AddVehicleAnswers {
  return {
    plate: '',
    make: '',
    model: '',
    colour: '',
    colourNote: '',
    year: null,
    bodyType: null,
    distinctiveFeatures: [],
    photos: [],
    nickname: '',
    ...answers,
  };
}

/** Map wizard answers to the RPC's positional arguments, uploading new photos. */
async function buildSaveParams(
  partial: Partial<AddVehicleAnswers>,
): Promise<SaveVehicleParams> {
  const answers = withDefaults(partial);
  const userId = await requireUserId();
  const photoUrls = await resolvePhotoUrls(userId, answers.photos);
  const features: { photo_url: string; description: string }[] = [];
  for (const [index, feature] of answers.distinctiveFeatures.entries()) {
    features.push({
      photo_url: isRemotePhoto(feature.photo.uri)
        ? feature.photo.uri
        : await uploadOwnFolderPhoto(userId, feature.photo, index, 'mark-'),
      description: feature.description.trim(),
    });
  }
  return {
    // The plate is optional here exactly as it is on a post (DOMAIN.md).
    p_plate: emptyToNull(answers.plate),
    p_make: answers.make,
    p_model: answers.model,
    p_colour: answers.colour,
    // Only escape colours ("Multicolour / wrapped", "Other") carry a note.
    p_colour_note: emptyToNull(answers.colourNote ?? ''),
    p_year: answers.year ?? null,
    p_body_type: answers.bodyType ?? null,
    p_nickname: emptyToNull(answers.nickname),
    p_photo_urls: photoUrls,
    p_distinctive_features: features,
  };
}

/** Save a new car to the garage. Returns its id. */
export async function addVehicle(answers: Partial<AddVehicleAnswers>): Promise<string> {
  const params = await buildSaveParams(answers);
  const data = (await callGarageRpc('add_vehicle', { ...params })) as {
    vehicle_id: string;
  } | null;
  const vehicleId = data?.vehicle_id ?? '';
  // The add -> post conversion is this feature's proof of worth, so the add is
  // logged distinctly. Id only: a plate must never reach the logs.
  // The garage changed, so any cached "has a saved car?" answer is stale —
  // drop it before the nudges can read it again.
  invalidateSavedCarSignal();
  log.info('garage_vehicle_added', { vehicleId, photoCount: params.p_photo_urls.length });
  return vehicleId;
}

/** Full-replace edit of one saved car. */
export async function updateVehicle(
  vehicleId: string,
  answers: Partial<AddVehicleAnswers>,
): Promise<void> {
  const params = await buildSaveParams(answers);
  await callGarageRpc('update_vehicle', { p_vehicle_id: vehicleId, ...params });
  // The garage changed, so any cached "has a saved car?" answer is stale —
  // drop it before the nudges can read it again.
  invalidateSavedCarSignal();
  log.info('garage_vehicle_updated', { vehicleId });
}

/** Remove a saved car. Rejected server-side while it has a live post. */
export async function deleteVehicle(vehicleId: string): Promise<void> {
  await callGarageRpc('delete_vehicle', { p_vehicle_id: vehicleId });
  // The garage changed, so any cached "has a saved car?" answer is stale —
  // drop it before the nudges can read it again.
  invalidateSavedCarSignal();
  log.info('garage_vehicle_removed', { vehicleId });
}
