/**
 * WHAT:  uploadOwnFolderPhoto — resize + JPEG-compress a picked photo and upload
 *        it to `post-photos/<userId>/<hash>-<index>.jpg`, returning its public
 *        URL.
 * WHY:   TWO features now need this identical upload: posting a stolen car and
 *        saving a car to the garage. ARCHITECTURE.md's bar for promoting to
 *        shared/ is "two features need the same thing", and the alternative was
 *        worse than duplication — the garage importing the vehicles barrel
 *        dragged PostDetailScreen, and through it the Stripe native module, into
 *        the garage's data layer.
 *
 *        The shared BUCKET is deliberate, not incidental: a garage photo lands
 *        at the same own-folder path a post photo does, so create_post's URL
 *        regex accepts it later with NO re-upload. That is most of the garage's
 *        "seconds not minutes" win.
 *
 *        SAFETY: re-encoding to a fresh JPEG drops the source EXIF (incl. any
 *        GPS that could pinpoint the owner's home). This is the current
 *        client-side control; server-side EXIF stripping before public serving
 *        (SECURITY_AND_TRUST §3) is a tracked cross-cutting gap for the
 *        media-hardening pass.
 * LINKS: src/features/vehicles/post/api/postApi.ts (posting caller);
 *        src/features/garage/api/garageApi.ts (garage caller);
 *        supabase/migrations/20260713190000_post_a_car.sql (the bucket + its
 *          own-folder storage policies).
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { createLogger } from '@/shared/lib/logger';
import type { PickedPhoto } from '@/shared/ui';

import { supabase } from './supabase';

const log = createLogger('storage');

/** The PUBLIC bucket both posts and garage vehicles store photos in. */
export const POST_PHOTOS_BUCKET = 'post-photos';
/** Long edge in px; keeps uploads small without losing recognisable detail. */
const PHOTO_MAX_EDGE = 1600;
const PHOTO_COMPRESS = 0.8;

/** Stable, non-cryptographic hash (djb2) → base36. Used only to name a storage
 *  object deterministically from its source uri, so a retry overwrites. */
function stableHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Resize (long edge → maxEdge, aspect preserved) + compress to JPEG bytes.
 *
 * EXPORTED for the bug-report screenshot uploader, which needs this exact
 * treatment against a DIFFERENT (private) bucket and wants the object PATH
 * rather than a public URL — so it cannot call `uploadOwnFolderPhoto`, but it
 * must not reimplement the re-encode.
 *
 * SAFETY: the re-encode is the EXIF strip. Everything that picks an image from
 * the library — including a bug screenshot, where the user may well pick a
 * photo rather than a capture — has to pass through here, or a source GPS tag
 * pinpointing someone's home travels with it.
 */
export async function toJpegBytes(
  photo: PickedPhoto,
  maxEdge: number,
  compress: number,
): Promise<ArrayBuffer> {
  const context = ImageManipulator.manipulate(photo.uri);
  if (photo.width >= photo.height) {
    if (photo.width > maxEdge) context.resize({ width: maxEdge });
  } else if (photo.height > maxEdge) {
    context.resize({ height: maxEdge });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress, format: SaveFormat.JPEG });
  const response = await fetch(saved.uri);
  return response.arrayBuffer();
}

/**
 * Upload one photo to the caller's OWN folder and return its public URL. The
 * index disambiguates the (vanishingly unlikely) case of two source uris hashing
 * equal; upsert:true so a retry of the same photo overwrites rather than
 * orphaning.
 *
 * @param keyPrefix namespaces the object key so distinctive-feature photos
 *   ('mark-') never collide with hero photos (default ''), each still
 *   retry-overwritable.
 */
export async function uploadOwnFolderPhoto(
  userId: string,
  photo: PickedPhoto,
  index = 0,
  keyPrefix = '',
): Promise<string> {
  const startedAt = Date.now();
  log.debug('Uploading photo', { userId, index });
  const body = await toJpegBytes(photo, PHOTO_MAX_EDGE, PHOTO_COMPRESS);
  const path = `${userId}/${keyPrefix}${stableHash(photo.uri)}-${index}.jpg`;
  const { error } = await supabase.storage
    .from(POST_PHOTOS_BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    log.error('Photo upload failed', { userId, index });
    throw error;
  }
  log.debug('Photo uploaded', { userId, index, durationMs: Date.now() - startedAt });
  return supabase.storage.from(POST_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Already-uploaded photos arrive as remote http(s) URLs and are kept as-is;
 *  only newly-picked local files (file://, ph://) need uploading. */
export function isRemotePhoto(uri: string): boolean {
  return /^https?:\/\//.test(uri);
}
