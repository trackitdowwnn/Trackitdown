/**
 * WHAT:  The sightings write/read path — resize+upload the evidence photos to
 *        the PRIVATE sighting-photos bucket, map the wizard answers onto the
 *        create_sighting RPC, translate its machine-token errors to calm
 *        copy, plus the quota pre-check and the owner's list read.
 * WHY:   create_sighting is the single SECURITY DEFINER write boundary and
 *        this file its only caller, so the evidence mapping and error→copy
 *        translation stay in one auditable place. Photos upload on submit to
 *        paths that are stable per source capture, so a retry after a
 *        mid-submit failure overwrites rather than orphaning — the wizard is
 *        never lost to a blip. SAFETY: the evidence array sent to the RPC is
 *        built ONLY from each photo's own capture bundle — a photo without
 *        its own fix is sent un-located (lat/lng/accuracy all null), never
 *        borrowing another photo's location.
 * LINKS: src/features/sightings/types.ts; supabase/migrations/*_sightings.sql;
 *        src/features/vehicles/post/api/postApi.ts (the pipeline this
 *        mirrors); docs/LOGGING.md ([sightings] tag — ids, never locations).
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { EvidencePhoto } from '@/shared/ui';

import type {
  CreateSightingParams,
  CreateSightingResult,
  OwnerSighting,
  ReportSightingAnswers,
  SightingQuota,
} from '../types';
import {
  MAX_NOTE_LENGTH,
  MAX_SIGHTING_PHOTOS,
  MIN_SIGHTING_PHOTOS,
  SIGHTING_CONTEXT_FLAGS,
} from '../types';

const log = createLogger('sightings');

const SIGHTING_BUCKET = 'sighting-photos';
/** Evidence must stay legible (plates, marks) but upload fast on mobile data. */
const PHOTO_MAX_EDGE = 1600;
const PHOTO_COMPRESS = 0.8;

// --- Error translation -------------------------------------------------------

/** The RPC raises machine tokens as the exception message; map to calm copy.
 *  RATE_LIMITED copy is time-honest: the budget is per rolling day. */
export const CREATE_SIGHTING_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'You need to be signed in to report a sighting.',
  POST_NOT_ACTIVE: 'This post is no longer active, so it can’t take new reports.',
  OWN_POST: 'You can’t report a sighting of your own car.',
  RATE_LIMITED: 'You’ve sent 3 reports for this car today — the owner has them.',
  INVALID_PHOTOS: 'Something went wrong with your photos. Please retake and try again.',
  INVALID_INPUT: 'Some details didn’t look right. Please check and try again.',
};

const CREATE_SIGHTING_FALLBACK = 'We couldn’t send your report. Please try again.';

/** Error whose `message` is already user-facing; `code` is for logging/tests. */
export class SightingSubmissionError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SightingSubmissionError';
    this.code = code;
  }
}

// --- Submit-ready validation ---------------------------------------------------

/** A located capture carries its OWN full fix; an un-located one carries none.
 *  This is the client half of the evidence-atomicity rule (the RPC re-checks). */
const evidencePhotoSchema = z
  .object({
    uri: z.string().min(1),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    capturedAt: z.string().min(1),
    lat: z.number().optional(),
    lng: z.number().optional(),
    accuracyM: z.number().optional(),
  })
  .refine((photo) => (photo.lat === undefined) === (photo.lng === undefined), {
    message: 'A photo must carry both coordinates or neither',
  })
  .refine((photo) => photo.accuracyM === undefined || photo.lat !== undefined, {
    message: 'Accuracy without a fix is meaningless',
  });

const submitAnswersSchema = z.object({
  photos: z.array(evidencePhotoSchema).min(MIN_SIGHTING_PHOTOS).max(MAX_SIGHTING_PHOTOS),
  contextFlags: z.array(z.enum(SIGHTING_CONTEXT_FLAGS)).default([]),
  note: z.string().max(MAX_NOTE_LENGTH).default(''),
  areaLabel: z.string().max(120).optional(),
});

const createSightingResultSchema = z.object({ sighting_id: z.guid() });

// --- Pure mapping --------------------------------------------------------------

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Map validated answers + uploaded paths onto the RPC arguments. Pure so the
 *  evidence-atomicity mapping is unit-tested without mocks. */
export function buildCreateSightingParams(
  postId: string,
  answers: z.infer<typeof submitAnswersSchema>,
  uploadedPaths: string[],
): CreateSightingParams {
  return {
    p_post_id: postId,
    p_photos: answers.photos.map((photo, index) => ({
      path: uploadedPaths[index],
      lat: photo.lat ?? null,
      lng: photo.lng ?? null,
      accuracy_m: photo.accuracyM ?? null,
      captured_at: photo.capturedAt,
    })),
    p_context_flags: answers.contextFlags,
    p_note: emptyToNull(answers.note),
    p_area_label: answers.areaLabel ? emptyToNull(answers.areaLabel) : null,
  };
}

// --- Storage upload -------------------------------------------------------------

/** Stable djb2 hash → base36; names objects deterministically per source uri
 *  so a retry overwrites (mirrors postApi). */
function stableHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Resize (long edge bound) + re-encode to JPEG bytes. SAFETY: the fresh
 *  encode drops source EXIF; our GPS travels ONLY in the structured evidence
 *  fields the server stores, never in the image file. */
async function toJpegBytes(photo: EvidencePhoto): Promise<ArrayBuffer> {
  const context = ImageManipulator.manipulate(photo.uri);
  const { width, height } = photo;
  if (width && height) {
    if (width >= height) {
      if (width > PHOTO_MAX_EDGE) context.resize({ width: PHOTO_MAX_EDGE });
    } else if (height > PHOTO_MAX_EDGE) {
      context.resize({ height: PHOTO_MAX_EDGE });
    }
  } else {
    // Camera captures always exceed the bound; missing dims → bound the width.
    context.resize({ width: PHOTO_MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: PHOTO_COMPRESS, format: SaveFormat.JPEG });
  const response = await fetch(saved.uri);
  return response.arrayBuffer();
}

/** Upload one evidence photo to sighting-photos/<postId>/<userId>/… and
 *  return its storage PATH (private bucket — never a public URL). */
export async function uploadSightingPhoto(
  postId: string,
  userId: string,
  photo: EvidencePhoto,
  index = 0,
): Promise<string> {
  const startedAt = Date.now();
  const body = await toJpegBytes(photo);
  const path = `${postId}/${userId}/${stableHash(photo.uri)}-${index}.jpg`;
  const { error } = await supabase.storage
    .from(SIGHTING_BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (error) {
    log.error('Sighting photo upload failed', { index });
    throw error;
  }
  log.debug('Sighting photo uploaded', { index, durationMs: Date.now() - startedAt });
  return path;
}

// --- Quota pre-check -------------------------------------------------------------

const quotaSchema = z.object({ used: z.number().int(), max_per_day: z.number().int() });

/** How many reports the caller has left for this post (rolling 24 h). */
export async function fetchSightingQuota(postId: string): Promise<SightingQuota> {
  const { data, error } = await supabase.rpc('my_sighting_quota', { p_post_id: postId });
  if (error) {
    log.warn('my_sighting_quota failed', { code: error.code });
    throw new SightingSubmissionError(CREATE_SIGHTING_FALLBACK, 'QUOTA_CHECK');
  }
  const parsed = quotaSchema.parse(data);
  return { used: parsed.used, maxPerDay: parsed.max_per_day };
}

// --- Submit orchestrator ----------------------------------------------------------

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new SightingSubmissionError(
      CREATE_SIGHTING_ERROR_MESSAGES.NOT_AUTHENTICATED,
      'NOT_AUTHENTICATED',
    );
  }
  return data.user.id;
}

/**
 * The whole submit: validate → upload each photo (stable paths) → RPC.
 * Throws SightingSubmissionError with user-facing copy; the wizard stays
 * intact for retry on every failure path.
 */
export async function submitSighting(
  postId: string,
  answers: Partial<ReportSightingAnswers>,
): Promise<CreateSightingResult> {
  const parsed = submitAnswersSchema.safeParse(answers);
  if (!parsed.success) {
    // Per-step schemas make this unreachable; it's a backstop.
    throw new SightingSubmissionError(CREATE_SIGHTING_ERROR_MESSAGES.INVALID_PHOTOS, 'INCOMPLETE');
  }
  const ready = parsed.data;
  const userId = await requireUserId();

  const paths: string[] = [];
  for (const [index, photo] of ready.photos.entries()) {
    try {
      paths.push(await uploadSightingPhoto(postId, userId, photo, index));
    } catch {
      throw new SightingSubmissionError(
        'One of your photos didn’t upload. Check your connection and try again.',
        'PHOTO_UPLOAD',
      );
    }
  }

  const params = buildCreateSightingParams(postId, ready, paths);
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('create_sighting', params);
  if (error) {
    // The RPC's message STARTS with the machine token; validation tokens
    // carry a ': detail' suffix (e.g. 'INVALID_PHOTOS: …') — match the prefix.
    const token = error.message.split(':')[0].trim();
    const known = token in CREATE_SIGHTING_ERROR_MESSAGES;
    const message = known ? CREATE_SIGHTING_ERROR_MESSAGES[token] : CREATE_SIGHTING_FALLBACK;
    // Unknown Postgres messages can echo input — logged only when known.
    log.warn('create_sighting rejected', { code: error.code, reason: known ? token : undefined });
    throw new SightingSubmissionError(message, known ? token : 'RPC_ERROR');
  }
  const result = createSightingResultSchema.safeParse(data);
  if (!result.success) {
    log.error('create_sighting returned an unexpected shape');
    throw new SightingSubmissionError(CREATE_SIGHTING_FALLBACK, 'BAD_SHAPE');
  }
  log.info('submitted', {
    sightingId: result.data.sighting_id,
    photoCount: ready.photos.length,
    located: ready.photos.some((photo) => photo.lat !== undefined),
    durationMs: Date.now() - startedAt,
  });
  return { sightingId: result.data.sighting_id };
}

// --- Owner list --------------------------------------------------------------------

const ownerSightingSchema = z.object({
  id: z.guid(),
  created_at: z.string(),
  status: z.enum(['unverified', 'helpful', 'credited']),
  context_flags: z.array(z.enum(SIGHTING_CONTEXT_FLAGS)),
  note: z.string().nullable(),
  area_label: z.string().nullable(),
  location_unavailable: z.boolean(),
  photos: z.array(
    z.object({
      path: z.string(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      accuracy_m: z.number().nullable(),
      captured_at: z.string(),
    }),
  ),
  // PRIVACY: strict() — any EXTRA field on the spotter payload (a widened
  // RPC leaking spotter_id / display_name) fails the parse loudly instead of
  // silently reaching the UI (SECURITY_AND_TRUST §1).
  spotter: z
    .object({
      first_name: z.string(),
      sightings_reported: z.number().int(),
      sightings_helpful: z.number().int(),
      recoveries_credited: z.number().int(),
      member_since: z.string(),
    })
    .strict(),
});

/** The owner's sightings on their post (server-enforced NOT_OWNER otherwise).
 *  PRIVACY: the payload's spotter block is first name + reputation only —
 *  hard-validated here so an accidentally widened RPC fails loudly client-side. */
export async function fetchPostSightings(postId: string): Promise<OwnerSighting[]> {
  const { data, error } = await supabase.rpc('get_post_sightings', { p_post_id: postId });
  if (error) {
    log.warn('get_post_sightings failed', { code: error.code });
    throw new Error('We couldn’t load the sightings. Please try again.');
  }
  const rows = z.array(ownerSightingSchema).parse(data ?? []);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    contextFlags: row.context_flags,
    note: row.note,
    areaLabel: row.area_label,
    locationUnavailable: row.location_unavailable,
    photos: row.photos.map((photo) => ({
      path: photo.path,
      lat: photo.lat,
      lng: photo.lng,
      accuracyM: photo.accuracy_m,
      capturedAt: photo.captured_at,
    })),
    spotter: {
      firstName: row.spotter.first_name,
      sightingsReported: row.spotter.sightings_reported,
      sightingsHelpful: row.spotter.sightings_helpful,
      recoveriesCredited: row.spotter.recoveries_credited,
      memberSince: row.spotter.member_since,
    },
  }));
}

/** Short-lived signed URLs for private evidence photos (owner or spotter —
 *  storage RLS enforces which). Keyed by path; failures yield no entry. */
export async function signSightingPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(SIGHTING_BUCKET)
    .createSignedUrls(paths, 60 * 60);
  if (error || !data) {
    log.warn('signing sighting photos failed');
    return {};
  }
  const urls: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && entry.path) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}
