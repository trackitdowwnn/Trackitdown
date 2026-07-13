/**
 * WHAT:  The post-a-car write path — resize+upload the hero photos (public
 *        post-photos bucket) and the V5C (private verification-documents
 *        bucket), map the wizard answers onto the create_post RPC arguments,
 *        call the RPC, and orchestrate all three as one submit that either
 *        fully succeeds or throws a user-facing error with the wizard left
 *        intact.
 * WHY:   create_post is the single SECURITY DEFINER write boundary; this file
 *        is its ONLY client caller, so the answers→args mapping and the RPC
 *        error→message translation live in one auditable place. Photos upload
 *        on SUBMIT (not per step) to own-folder paths that are stable per
 *        source image, so a retry after a mid-submit failure overwrites rather
 *        than orphaning. The orchestrator throws a PostSubmissionError whose
 *        message is already plain-English, which the wizard's async onComplete
 *        surfaces verbatim while keeping every answer in place for retry.
 * LINKS: src/features/vehicles/post/types.ts (answers + params shapes);
 *        supabase/migrations/20260713190000_post_a_car.sql (create_post,
 *          buckets, error strings) + …191000 (deny-anon);
 *        src/features/profile/api/profileApi.ts (uploadAvatar — the pipeline
 *          this mirrors); docs/LOGGING.md ([vehicles] tag, ids not PII).
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { PhotoTileStatus, PickedPhoto } from '@/shared/ui';

import type { CreatePostParams, CreatePostResult, PostACarAnswers } from '../types';

const log = createLogger('vehicles');

const POST_PHOTOS_BUCKET = 'post-photos';
const VERIFICATION_BUCKET = 'verification-documents';

/** Public photos: bound the long edge but keep them sharp for the carousel. */
const PHOTO_MAX_EDGE = 1600;
const PHOTO_COMPRESS = 0.8;
/** The V5C must stay legible for the moderator, so a larger edge / less squash. */
const V5C_MAX_EDGE = 2000;
const V5C_COMPRESS = 0.85;

// --- Error translation -------------------------------------------------------

/**
 * The RPC raises `raise exception '<CODE>'`; supabase surfaces the CODE as
 * error.message. Map each to plain-English copy for the wizard's error line.
 * Any unmapped failure (network, unknown code) falls back to the generic line.
 */
export const CREATE_POST_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in to post a car.',
  INVALID_PLATE: 'That number plate doesn’t look right. Check it and try again.',
  PLATE_IN_USE: 'There’s already an active post for this number plate.',
  MISSING_REQUIRED: 'Some required details are missing. Go back and check each step.',
  BOUNTY_OUT_OF_RANGE: 'The bounty must be between £50 and £5,000.',
  PHOTO_COUNT: 'Add between 3 and 6 photos of your car.',
  INVALID_STOLEN_FROM: 'Where it was taken from wasn’t recognised. Please reselect it.',
  INVALID_KEYS_TAKEN: 'The “keys taken” answer wasn’t recognised. Please reselect it.',
  // These indicate a client/upload bug (postApi always sends own-folder refs),
  // not something the user typed — keep the copy generic and retryable.
  INVALID_PHOTO_URL: 'We couldn’t attach one of your photos. Please try again.',
  INVALID_VERIFICATION_PATH: 'We couldn’t attach your proof of ownership. Please try again.',
};

const CREATE_POST_FALLBACK = 'We couldn’t create your post. Please try again.';

/** Error carrying a plain-English `message` (shown to the user) plus a `code`
 *  for logging/tests. Thrown by the whole submit path. */
export class PostSubmissionError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PostSubmissionError';
    this.code = code;
  }
}

// --- Answer completeness -----------------------------------------------------

/** The submit-ready shape: everything create_post needs, present and in range.
 *  A defense-in-depth re-check of what the per-step wizard schemas already gate;
 *  also the seam the orchestrator narrows `location` to non-null through. */
const photoShape = z.object({
  uri: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

// Genuinely-required fields use .min/.max; the rest use .nullish() (accepts the
// `undefined` the controller leaves for steps a user never edits) or .default()
// so an untouched optional field never blanket-fails as INCOMPLETE.
const submitAnswersSchema = z.object({
  // Optional — blank/absent means a plate-less post (make/model/colour identify it).
  plate: z.string().optional(),
  make: z.string().min(1),
  model: z.string().min(1),
  colour: z.string().min(1),
  // Mirrors the posts.year CHECK (1900–2100) — defense in depth with the step.
  year: z.number().int().min(1900).max(2100).nullish(),
  bodyType: z.string().nullish(),
  featureKeys: z.array(z.string()).default([]),
  descRecognise: z.string().default(''),
  photos: z.array(photoShape).min(3).max(6),
  lastSeenAt: z.string().min(1),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    addressLabel: z.string(),
  }),
  lastSeenArea: z.string().default(''),
  stolenFrom: z.enum(['driveway', 'street', 'car_park', 'other']).nullish(),
  keysTaken: z.enum(['yes', 'no', 'unknown']).nullish(),
  descDrives: z.string().default(''),
  bountyAmountPence: z.number().int().min(5000).max(500000),
  verification: photoShape.nullish(),
});

export type SubmitReadyAnswers = z.infer<typeof submitAnswersSchema>;

const createPostResultSchema = z.object({
  post_id: z.guid(),
  status: z.literal('draft'),
});

// --- Pure mapping ------------------------------------------------------------

/** Trim to null so empty guided-prompt boxes store SQL NULL, not ''. */
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Alphanumeric-only upper canon of a plate — mirrors create_post's server canon.
 * An empty canon (blank, punctuation-only like "--", or non-ASCII homoglyphs)
 * means "no plate", so the client agrees with the server that it's plate-less
 * (avoids the review screen showing junk the server will store as NULL).
 */
export function plateCanon(plate: string | null | undefined): string {
  return (plate ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Map validated answers + upload results onto the create_post RPC arguments.
 * Pure and mock-free so the mapping is unit-tested directly. NOTE: the legacy
 * `distinguishing_features`/`owner_note` free-text columns are intentionally
 * null — this flow collects the taxonomy (feature_keys) + guided prompts
 * (desc_recognise/desc_drives) instead.
 */
export function buildCreatePostParams(
  answers: SubmitReadyAnswers,
  uploads: { photoUrls: string[]; verificationPath: string | null },
): CreatePostParams {
  return {
    // Null when the canon is empty (blank / punctuation-only) → plate-less.
    p_plate: plateCanon(answers.plate).length > 0 ? (answers.plate ?? '').trim() : null,
    p_make: answers.make,
    p_model: answers.model,
    p_colour: answers.colour,
    // Optional fields can arrive undefined (untouched steps) — coerce to null.
    p_year: answers.year ?? null,
    p_body_type: answers.bodyType ?? null,
    p_distinguishing_features: null,
    p_owner_note: null,
    p_desc_recognise: emptyToNull(answers.descRecognise),
    p_desc_drives: emptyToNull(answers.descDrives),
    p_stolen_from: answers.stolenFrom ?? null,
    p_keys_taken: answers.keysTaken ?? null,
    p_last_seen_at: answers.lastSeenAt,
    // SAFETY: only the coarse lat/lng + area grouping cross the wire. The
    // precise addressLabel is deliberately NOT sent — for a driveway theft it
    // is the victim's exact home address (SECURITY_AND_TRUST home-coarsening).
    p_last_seen_lat: answers.location.latitude,
    p_last_seen_lng: answers.location.longitude,
    p_last_seen_area: answers.lastSeenArea,
    p_bounty_amount_pence: answers.bountyAmountPence,
    p_photo_urls: uploads.photoUrls,
    p_feature_keys: answers.featureKeys.length > 0 ? answers.featureKeys : null,
    p_verification_path: uploads.verificationPath,
  };
}

// --- Storage uploads ---------------------------------------------------------

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
 * SAFETY: re-encoding to a fresh JPEG drops the source EXIF (incl. any GPS that
 * could pinpoint the owner's home). This is the current client-side control;
 * server-side EXIF stripping before public serving (SECURITY_AND_TRUST §3) is a
 * tracked cross-cutting gap for the media-hardening pass (avatars too).
 */
async function toJpegBytes(
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
 * Upload one hero photo to post-photos/<userId>/<hash>-<index>.jpg (own-folder
 * RLS) and return its public URL. The index disambiguates the (vanishingly
 * unlikely) case of two source uris hashing equal, so all 3–6 photos always get
 * distinct object names; upsert:true so a retry of the same photo overwrites.
 */
export async function uploadPostPhoto(
  userId: string,
  photo: PickedPhoto,
  index = 0,
): Promise<string> {
  const startedAt = Date.now();
  log.debug('Uploading post photo', { userId, index });
  const body = await toJpegBytes(photo, PHOTO_MAX_EDGE, PHOTO_COMPRESS);
  const path = `${userId}/${stableHash(photo.uri)}-${index}.jpg`;
  const { error } = await supabase.storage
    .from(POST_PHOTOS_BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    log.error('Post photo upload failed', { userId, index });
    throw error;
  }
  log.debug('Post photo uploaded', { userId, index, durationMs: Date.now() - startedAt });
  return supabase.storage.from(POST_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Upload the V5C to the PRIVATE verification-documents/<userId>/v5c-<hash>.jpg
 * (own-folder RLS) and return its storage PATH (never a public URL — the bucket
 * has no public delivery). The RPC stores this path on the verification_documents
 * row; a moderator later reads it via a signed URL (service role).
 */
export async function uploadVerificationDocument(
  userId: string,
  document: PickedPhoto,
): Promise<string> {
  const startedAt = Date.now();
  log.debug('Uploading verification document', { userId });
  const body = await toJpegBytes(document, V5C_MAX_EDGE, V5C_COMPRESS);
  const path = `${userId}/v5c-${stableHash(document.uri)}.jpg`;
  const { error } = await supabase.storage
    .from(VERIFICATION_BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    log.error('Verification document upload failed', { userId });
    throw error;
  }
  log.debug('Verification document uploaded', { userId, durationMs: Date.now() - startedAt });
  return path;
}

// --- Plate availability (early check for the plate step) ---------------------

/**
 * Throw a user-facing error if the plate already has a live/in-flight post.
 * Used by the wizard's plate-step onContinue for early feedback; create_post
 * re-checks at submit (the real enforcement). A check failure (network) is
 * surfaced too so the step doesn't advance on an unverified plate.
 */
export async function checkPlateAvailable(plate: string): Promise<void> {
  const { data, error } = await supabase.rpc('plate_available', { p_plate: plate });
  if (error) {
    log.warn('plate_available check failed', { code: error.code });
    throw new PostSubmissionError(
      'We couldn’t check that number plate just now. Please try again.',
      'PLATE_CHECK',
    );
  }
  if (data === false) {
    throw new PostSubmissionError(
      CREATE_POST_ERROR_MESSAGES.PLATE_IN_USE,
      'PLATE_IN_USE',
    );
  }
}

// --- RPC call ----------------------------------------------------------------

/** Call create_post and translate its raised codes into user-facing errors. */
export async function createPost(params: CreatePostParams): Promise<CreatePostResult> {
  const startedAt = Date.now();
  log.debug('create_post start');
  const { data, error } = await supabase.rpc('create_post', params);
  if (error) {
    const known = error.message in CREATE_POST_ERROR_MESSAGES;
    const message = known ? CREATE_POST_ERROR_MESSAGES[error.message] : CREATE_POST_FALLBACK;
    // Log the code always; the RPC message only when it's a known enum. An
    // unmapped Postgres message can echo input (a CHECK embedding the bounty/
    // plate), so it's deliberately dropped from the log on the fallback path.
    log.warn('create_post rejected', { code: error.code, reason: known ? error.message : undefined });
    throw new PostSubmissionError(message, known ? error.message : 'RPC_ERROR');
  }
  const parsed = createPostResultSchema.safeParse(data);
  if (!parsed.success) {
    log.error('create_post returned an unexpected shape');
    throw new PostSubmissionError(CREATE_POST_FALLBACK, 'BAD_SHAPE');
  }
  log.info('Post draft created', { postId: parsed.data.post_id, durationMs: Date.now() - startedAt });
  return { postId: parsed.data.post_id, status: 'draft' };
}

// --- Orchestrator ------------------------------------------------------------

export interface SubmitPostOptions {
  /** Per-photo overlay updates keyed by the photo's uri. null clears the tile. */
  onPhotoStatus?: (uri: string, status: PhotoTileStatus | null) => void;
}

/** Resolve the signed-in user's id, or fail with the auth error message. */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new PostSubmissionError(
      CREATE_POST_ERROR_MESSAGES.NOT_AUTHENTICATED,
      'NOT_AUTHENTICATED',
    );
  }
  return data.user.id;
}

/**
 * The whole submit: validate completeness → upload photos (in cover order) →
 * upload the V5C → create the draft. Any failure throws a PostSubmissionError
 * and leaves nothing half-built that a retry can't safely overwrite. This is
 * what the wizard's async onComplete awaits; on success it returns the new
 * post's id for the flow to route to.
 *
 * PAYMENT STUB: this creates the draft only — no escrow charge is taken. When
 * the payments feature lands it wraps this call (charge → server-side
 * draft→pending_verification). See the README handoff contract.
 */
export async function submitPost(
  answers: Partial<PostACarAnswers>,
  options: SubmitPostOptions = {},
): Promise<CreatePostResult> {
  const { onPhotoStatus } = options;

  const parsed = submitAnswersSchema.safeParse(answers);
  if (!parsed.success) {
    // The per-step schemas should make this unreachable; it's a backstop.
    throw new PostSubmissionError(
      CREATE_POST_ERROR_MESSAGES.MISSING_REQUIRED,
      'INCOMPLETE',
    );
  }
  const ready = parsed.data;

  const userId = await requireUserId();

  const photoUrls: string[] = [];
  for (const [index, photo] of ready.photos.entries()) {
    onPhotoStatus?.(photo.uri, { kind: 'uploading' });
    try {
      photoUrls.push(await uploadPostPhoto(userId, photo, index));
      onPhotoStatus?.(photo.uri, null); // clear the overlay on success
    } catch {
      onPhotoStatus?.(photo.uri, { kind: 'error' });
      throw new PostSubmissionError(
        'One of your photos didn’t upload. Check your connection and try again.',
        'PHOTO_UPLOAD',
      );
    }
  }

  let verificationPath: string | null = null;
  if (ready.verification) {
    try {
      verificationPath = await uploadVerificationDocument(userId, ready.verification);
    } catch {
      throw new PostSubmissionError(
        'Your proof of ownership didn’t upload. Check your connection and try again.',
        'V5C_UPLOAD',
      );
    }
  }

  return createPost(buildCreatePostParams(ready, { photoUrls, verificationPath }));
}
