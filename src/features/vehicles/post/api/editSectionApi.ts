/**
 * WHAT:  The per-section save path — one thin function per `update_post_*` RPC,
 *        so the detail screen can edit ONE section of a post at a time (car
 *        details, photos, last-seen, bounty, theft context, distinctive features,
 *        description). Uploads any newly-picked local photos first (keeping
 *        already-uploaded remote URLs), then calls the section's RPC and
 *        translates its raised codes into the same user-facing copy as create.
 * WHY:   The whole-post write path (create_post / the retired update_post) is
 *        wrong for per-section editing: each section has its OWN status gate
 *        (bounty/identity draft-only; theft context + marks also editable while
 *        pending_verification) enforced server-side. Keeping one small function
 *        per RPC mirrors the migration's one-section-per-function shape and reuses
 *        the create path's upload helpers + error map. Throws a PostSubmissionError
 *        (plain-English message) so each editor surfaces it and stays open.
 * LINKS: supabase/migrations/20260727130000_edit_post_sections.sql (the 7 RPCs);
 *        src/features/vehicles/post/api/postApi.ts (upload helpers, error map,
 *          PostSubmissionError);
 *        src/features/vehicles/components/editors/* (the consumers).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { PickedPhoto } from '@/shared/ui';

import type { DistinctiveFeature } from '../lib/distinctiveFeatures';
import type { KeysTaken, LastSeenLocation, StolenFrom } from '../types';
import {
  CREATE_POST_ERROR_MESSAGES,
  PostSubmissionError,
  uploadPostPhoto,
} from './postApi';

const log = createLogger('vehicles');

const SAVE_FALLBACK = 'We couldn’t save your changes. Please try again.';

/** Already-uploaded photos arrive as remote http(s) URLs (kept on edit); only
 *  newly-picked local files (file://, ph://) are re-uploaded. */
export function isRemotePhoto(uri: string): boolean {
  return /^https?:\/\//.test(uri);
}

/** Trim to null so an empty free-text box stores SQL NULL, not ''. */
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Resolve the signed-in user's id, or fail with the auth error message. */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new PostSubmissionError(CREATE_POST_ERROR_MESSAGES.NOT_AUTHENTICATED, 'NOT_AUTHENTICATED');
  }
  return data.user.id;
}

/** Upload each newly-picked local photo (keep remote URLs), in order. */
async function resolvePhotoUrls(
  userId: string,
  photos: PickedPhoto[],
  keyPrefix = '',
): Promise<string[]> {
  const urls: string[] = [];
  for (const [index, photo] of photos.entries()) {
    urls.push(
      isRemotePhoto(photo.uri) ? photo.uri : await uploadPostPhoto(userId, photo, index, keyPrefix),
    );
  }
  return urls;
}

/** Call a section RPC and translate its raised code (shared with create_post). */
async function callSectionRpc(fn: string, params: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, params);
  if (error) {
    const known = error.message in CREATE_POST_ERROR_MESSAGES;
    const message = known ? CREATE_POST_ERROR_MESSAGES[error.message] : SAVE_FALLBACK;
    log.warn(`${fn} rejected`, { code: error.code, reason: known ? error.message : undefined });
    throw new PostSubmissionError(message, known ? error.message : 'RPC_ERROR');
  }
  log.info(`${fn} ok`);
}

// --- Per-section saves -------------------------------------------------------

export interface CarDetailsInput {
  make: string;
  model: string;
  colour: string;
  colourNote: string;
  year: number | null;
  bodyType: string | null;
}

/** Car details (make/model/colour/colourNote→owner_note/year/bodyType). Draft only. */
export async function saveCarDetails(postId: string, input: CarDetailsInput): Promise<void> {
  await callSectionRpc('update_post_car_details', {
    p_post_id: postId,
    p_make: input.make,
    p_model: input.model,
    p_colour: input.colour,
    p_owner_note: emptyToNull(input.colourNote),
    p_year: input.year ?? null,
    p_body_type: input.bodyType ?? null,
  });
}

/** Hero photos (3–6). Keeps remote, uploads new. Draft only. */
export async function savePhotos(postId: string, photos: PickedPhoto[]): Promise<void> {
  const userId = await requireUserId();
  const photoUrls = await resolvePhotoUrls(userId, photos);
  await callSectionRpc('update_post_photos', { p_post_id: postId, p_photo_urls: photoUrls });
}

export interface LastSeenInput {
  lastSeenAt: string;
  location: LastSeenLocation;
  lastSeenArea: string;
  /** District grain for spotter alerts; omitted when the geocode failed. */
  lastSeenLocality?: string | null;
}

/** Last-seen when + where (+ coarse area). Draft only. */
export async function saveLastSeen(postId: string, input: LastSeenInput): Promise<void> {
  await callSectionRpc('update_post_last_seen', {
    p_post_id: postId,
    p_last_seen_at: input.lastSeenAt,
    p_last_seen_lat: input.location.latitude,
    p_last_seen_lng: input.location.longitude,
    p_last_seen_area: input.lastSeenArea,
    // This RPC FULL-REPLACES the section, so omitting the locality would blank
    // a previously-derived one on any unrelated edit to the same section.
    p_last_seen_locality: input.lastSeenLocality ?? null,
  });
}

/**
 * The listing's price. Draft only — frozen once the charge is taken. MONEY.
 *
 * `null` switches the draft to the NO-REWARD pricing mode (ADR-0014) and the
 * server stamps the fixed listing fee; a number sets a bounty and clears any
 * fee. update_post_bounty always writes BOTH price columns, so the pair cannot
 * drift apart — which is why this stays one function rather than gaining a
 * sibling for the fee.
 */
export async function saveBounty(
  postId: string,
  bountyAmountPence: number | null,
): Promise<void> {
  await callSectionRpc('update_post_bounty', {
    p_post_id: postId,
    p_bounty_amount_pence: bountyAmountPence,
  });
}

/** The "About this car" free-text description (desc_recognise). Money-neutral →
 *  editable on a draft AND a pending_verification post. */
export async function saveDescription(postId: string, description: string): Promise<void> {
  await callSectionRpc('update_post_description', {
    p_post_id: postId,
    p_desc_recognise: emptyToNull(description),
  });
}

export interface TheftContextInput {
  stolenFrom: StolenFrom | null;
  keysTaken: KeysTaken | null;
  descDrives: string;
}

/** Theft context (stolen_from/keys_taken/desc_drives). Money-neutral → editable
 *  on a draft AND a pending_verification post. */
export async function saveTheftContext(postId: string, input: TheftContextInput): Promise<void> {
  await callSectionRpc('update_post_theft_context', {
    p_post_id: postId,
    p_stolen_from: input.stolenFrom ?? null,
    p_keys_taken: input.keysTaken ?? null,
    p_desc_drives: emptyToNull(input.descDrives),
  });
}

/** Distinctive features (owner photo+description pairs). Keeps remote mark photos,
 *  uploads new. Money-neutral → editable on draft AND pending_verification. */
export async function saveDistinctiveFeatures(
  postId: string,
  features: DistinctiveFeature[],
): Promise<void> {
  const userId = await requireUserId();
  const rows: { photo_url: string; description: string }[] = [];
  for (const [index, feature] of features.entries()) {
    const url = isRemotePhoto(feature.photo.uri)
      ? feature.photo.uri
      : await uploadPostPhoto(userId, feature.photo, index, 'mark-');
    rows.push({ photo_url: url, description: feature.description.trim() });
  }
  await callSectionRpc('update_post_distinctive_features', {
    p_post_id: postId,
    p_distinctive_features: rows,
  });
}
