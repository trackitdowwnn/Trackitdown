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

import { notifySighting, notifySightingConfirmed } from '@/features/notifications';
import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { EvidencePhoto } from '@/shared/ui';

import type {
  CreateSightingParams,
  CreateSightingResult,
  OwnerSighting,
  PublicSightingEntries,
  ReportSightingAnswers,
  SightingQuota,
} from '../types';
import {
  DRIVING_DIRECTIONS,
  MAX_NOTE_LENGTH,
  MAX_SIGHTING_PHOTOS,
  MIN_SIGHTING_PHOTOS,
  PARKED_LIKELIHOOD,
  PEOPLE_PRESENCE,
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
 *  This is the client half of the evidence-atomicity rule (the RPC re-checks).
 *  ADR-0003: source defaults 'live'; a GALLERY photo may carry NO location
 *  (its EXIF is never read as evidence — payout blindness, made structural). */
const evidencePhotoSchema = z
  .object({
    uri: z.string().min(1),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    capturedAt: z.string().min(1),
    lat: z.number().optional(),
    lng: z.number().optional(),
    accuracyM: z.number().optional(),
    source: z.enum(['live', 'gallery']).default('live'),
  })
  .refine((photo) => (photo.lat === undefined) === (photo.lng === undefined), {
    message: 'A photo must carry both coordinates or neither',
  })
  .refine((photo) => photo.accuracyM === undefined || photo.lat !== undefined, {
    message: 'Accuracy without a fix is meaningless',
  })
  .refine((photo) => photo.source !== 'gallery' || photo.lat === undefined, {
    message: 'A gallery photo carries no location (ADR-0003)',
  });

const submitAnswersSchema = z.object({
  // ADR-0003 rule 1 (client half; the RPC re-enforces): ≥1 LIVE capture.
  photos: z
    .array(evidencePhotoSchema)
    .min(MIN_SIGHTING_PHOTOS)
    .max(MAX_SIGHTING_PHOTOS)
    .refine((photos) => photos.some((photo) => photo.source === 'live'), {
      message: 'At least one live in-app capture is required',
    }),
  contextFlags: z.array(z.enum(SIGHTING_CONTEXT_FLAGS)).default([]),
  note: z.string().max(MAX_NOTE_LENGTH).default(''),
  areaLabel: z.string().max(120).optional(),
  locality: z.string().max(80).optional(),
  parkedLikelihood: z.enum(PARKED_LIKELIHOOD).optional(),
  direction: z.enum(DRIVING_DIRECTIONS).optional(),
  peoplePresence: z.enum(PEOPLE_PRESENCE).optional(),
  // Mirrors the RPC's cap (≤ 8 marks per post); ids are validated server-side
  // against the post's registered marks. `confirmableFeatures` (the wizard's
  // read-only seed) is deliberately NOT here — unknown keys strip on parse.
  confirmedFeatureIds: z.array(z.guid()).max(8).default([]),
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
      source: photo.source,
    })),
    p_context_flags: answers.contextFlags,
    p_note: emptyToNull(answers.note),
    p_area_label: answers.areaLabel ? emptyToNull(answers.areaLabel) : null,
    p_locality: answers.locality ? emptyToNull(answers.locality) : null,
    p_parked_likelihood: answers.parkedLikelihood ?? null,
    p_direction: answers.direction ?? null,
    p_people_presence: answers.peoplePresence ?? null,
    p_confirmed_feature_ids:
      answers.confirmedFeatureIds.length > 0 ? answers.confirmedFeatureIds : null,
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
  // Tell the owner. Fire-and-forget by design: the report has landed, and a
  // push that fails must never turn a successful submit into an error the
  // spotter has to deal with. The server re-checks that this caller really is
  // the sighting's spotter, so a forged id notifies nobody.
  notifySighting(result.data.sighting_id);
  return { sightingId: result.data.sighting_id };
}

// --- Owner list --------------------------------------------------------------------

const ownerSightingSchema = z.object({
  id: z.guid(),
  created_at: z.string(),
  // 'not_mine' (20260814100000) is the owner saying "that isn't my car". It is
  // the ABSENCE of a confirmation, not a penalty: it bumps no counter and is
  // reversible, because mark_sighting_helpful accepts it as a source. Without
  // it here, one rejected sighting fails the parse for the whole list.
  status: z.enum(['unverified', 'helpful', 'not_mine', 'credited']),
  context_flags: z.array(z.enum(SIGHTING_CONTEXT_FLAGS)),
  note: z.string().nullable(),
  area_label: z.string().nullable(),
  location_unavailable: z.boolean(),
  parked_likelihood: z.enum(PARKED_LIKELIHOOD).nullable(),
  direction: z.enum(DRIVING_DIRECTIONS).nullable(),
  people_presence: z.enum(PEOPLE_PRESENCE).nullable(),
  confirmed_features: z.array(
    z.object({ id: z.guid(), description: z.string() }).strict(),
  ),
  photos: z.array(
    z.object({
      path: z.string(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      accuracy_m: z.number().nullable(),
      captured_at: z.string(),
      // ADR-0003 provenance; optional so pre-hybrid cached payloads parse.
      source: z.enum(['live', 'gallery']).optional().default('live'),
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
    parkedLikelihood: row.parked_likelihood,
    direction: row.direction,
    peoplePresence: row.people_presence,
    confirmedFeatures: row.confirmed_features,
    photos: row.photos.map((photo) => ({
      path: photo.path,
      lat: photo.lat,
      lng: photo.lng,
      accuracyM: photo.accuracy_m,
      capturedAt: photo.captured_at,
      source: photo.source,
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

// --- Public timeline entries (ADR-0008) ---------------------------------------------

// .strict() everywhere: the fence is the SHAPE. A widened RPC leaking a
// coordinate, photo path, or spotter field must fail loudly client-side —
// exactly the posture the owner payload takes above, pointed the other way.
const publicEntrySchema = z
  .object({
    sighted_at: z.string(),
    locality: z.string().nullable(),
    // ADR-0009: server-snapped ~1km grid points — the ONLY location grain
    // that may ever appear here. Still strict: any extra field fails loudly.
    snap_lat: z.number().nullable(),
    snap_lng: z.number().nullable(),
  })
  .strict();

const publicEntriesSchema = z
  .object({
    entries: z.array(publicEntrySchema),
    earlier_count: z.number().int().min(0),
  })
  .strict();

/**
 * The restrained PUBLIC face: five newest {time, locality} entries + a count
 * of the rest, active posts only (a closed or missing post returns the same
 * empty shape — no oracle). Callable by guests: this is the one public
 * sighting surface (SECURITY_AND_TRUST §6 carve-out, ADR-0008).
 */
export async function fetchPublicSightingEntries(postId: string): Promise<PublicSightingEntries> {
  const { data, error } = await supabase.rpc('get_public_sighting_entries', {
    p_post_id: postId,
  });
  if (error) {
    // Non-fatal to the caller's screen: the detail page simply renders no
    // timeline section, the same as a post with no sightings.
    log.warn('get_public_sighting_entries failed', { code: error.code });
    return { entries: [], earlierCount: 0 };
  }
  const parsed = publicEntriesSchema.parse(data);
  return {
    entries: parsed.entries.map((entry) => ({
      sightedAt: entry.sighted_at,
      locality: entry.locality,
      snapLat: entry.snap_lat,
      snapLng: entry.snap_lng,
    })),
    earlierCount: parsed.earlier_count,
  };
}

/**
 * Owner marks a sighting helpful (DOMAIN: unverified OR not_mine → helpful; a
 * credited sighting never re-labels; repeat marks are idempotent server-side
 * so the spotter's counter can only bump once). Returns the resulting status
 * so the timeline can settle without a refetch.
 *
 * ⚠️ THE SCHEMA IS `.strict()` ON PURPOSE AND THAT MADE THIS THROW. Between
 * 20260814140000 landing in the database and 2026-08-22, the RPC returned
 * `crossedThreshold` and `counted` while this listed two keys — so every tap
 * raised a ZodError AFTER the server had already recorded the verdict and
 * bumped the spotter's reputation. The owner saw "we couldn't mark that" for
 * something that had worked. Keep the strictness (a widened RPC should fail
 * loudly here); keep this list in step with the RPC when it changes.
 */
export async function markSightingHelpful(sightingId: string): Promise<{
  status: 'helpful' | 'credited';
  changed: boolean;
  /** The badge rung this tap crossed (1/5/25), or null. Badges are DERIVED
   *  from a counter, so the RPC holding both sides of the increment is the
   *  only thing that can know a rung was passed — it cannot be recomputed. */
  crossedThreshold: number | null;
  /** false when the verdict was recorded but the reputation point withheld.
   *  Two different causes produce it and they are DELIBERATELY
   *  indistinguishable — see the caller. */
  counted: boolean;
}> {
  const { data, error } = await supabase.rpc('mark_sighting_helpful', {
    p_sighting_id: sightingId,
  });
  if (error) {
    log.warn('mark_sighting_helpful failed', { code: error.code });
    throw new Error('We couldn’t mark that sighting. Please try again.');
  }
  const parsed = z
    .object({
      status: z.enum(['helpful', 'credited']),
      changed: z.boolean(),
      crossedThreshold: z.number().int().nullable(),
      counted: z.boolean(),
    })
    .strict()
    .parse(data);
  log.info('sighting_marked_helpful', {
    sightingId,
    changed: parsed.changed,
    counted: parsed.counted,
  });

  // Tell the spotter, but ONLY when this call actually changed something — a
  // re-mark is idempotent server-side and the claim RPC would refuse anyway
  // (confirmed_notified_at is already stamped), so dispatching on a no-op just
  // spends a round trip to be told no.
  //
  // Fired even when `counted` is false. The sighting genuinely WAS confirmed,
  // and staying silent on a capped or flagged pair would leak that something
  // about them had been judged. The badge line simply does not appear, because
  // the counter did not move.
  //
  // Fire-and-forget by design: whether the spotter's phone buzzes is not a
  // reason to fail the owner's action.
  if (parsed.changed && parsed.status === 'helpful') {
    notifySightingConfirmed(sightingId);
  }

  return parsed;
}

/**
 * ONE row of the spotter's OWN record. Deliberately narrow: this is what
 * my_sighting_record returns and nothing more.
 *
 * ⚠️ THE CAR IS ALL THERE IS OF THE POST. Make and colour, as the spotter
 * already saw them — no owner identity, no location, no plate, no bounty, and
 * no post id. A spotter's history is not a back door into listings they were
 * never shown.
 */
/**
 * The spotter's OWN standing on this report's dispute, and nothing about the
 * post beyond it.
 *
 * ⚠️ `available` MIRRORS `my_dispute_context`'s gate exactly: a refund hold
 * exists on the post AND names this sighting in `sighting_ids`. It is here so
 * `My reports` can show the door only where the door opens — without it the
 * screen would have to route every card at `/sighting-dispute` and let a
 * `DISPUTE_NOT_AVAILABLE` refusal do the filtering, which is a dead end dressed
 * up as a button.
 *
 * ⚠️ THIS DOES NOT WIDEN WHAT THE SPOTTER LEARNS ABOUT THE POST. No owner, no
 * location, no plate, no post id — the same wall the rest of this payload
 * keeps. A hold's existence is already told to this spotter by the
 * `closed_uncredited` push; all this does is stop that push being the ONLY way
 * to hear it.
 */
export interface MySightingDispute {
  /** Whether /sighting-dispute will load for this sighting. */
  available: boolean;
  /** Their own filing, if they have made one. */
  status: 'open' | 'upheld' | 'rejected' | null;
  /** When the 72-hour window closes, or null once it no longer matters. */
  windowEndsAt: string | null;
}

export interface MySightingRecordEntry {
  id: string;
  createdAt: string;
  status: 'unverified' | 'helpful' | 'not_mine' | 'credited';
  /** When the owner set the CURRENT verdict, or null if nobody has ruled.
   *  Overwritten by a correction, so it is not a history. */
  reviewedAt: string | null;
  /** The spotter's own coarse label for where they saw it. */
  areaLabel: string | null;
  /** Bounded to 32 chars server-side; either half may be '' on a sparse post. */
  car: { make: string; colour: string };
  /**
   * ⚠️ OPTIONAL BECAUSE THE SERVER MAY BE OLDER THAN THIS BUNDLE, and that is
   * a deployment fact rather than a modelling one. The row schema below is
   * `.strict()` on purpose, so a payload carrying a key this client does not
   * know FAILS — which means a widened `my_sighting_record` would break `My
   * reports` for every phone still on the previous bundle. Declaring the field
   * optional here first makes the client tolerate both servers, so the client
   * can ship AHEAD of the migration and the order is safe in one direction.
   * Undefined means "this server does not send it yet", which reads the same
   * as "no dispute" on the screen.
   */
  dispute?: MySightingDispute;
}

const mySightingRowSchema = z
  .object({
    id: z.guid(),
    created_at: z.string(),
    status: z.enum(['unverified', 'helpful', 'not_mine', 'credited']),
    reviewed_at: z.string().nullable(),
    area_label: z.string().nullable(),
    car: z.object({ make: z.string(), colour: z.string() }).strict(),
    // `.optional()` is what lets this bundle run against a server that predates
    // the dispute fields — see MySightingRecordEntry.dispute. `.nullable()` too
    // because jsonb_build_object emits SQL NULL as JSON null, not absence.
    dispute: z
      .object({
        available: z.boolean(),
        status: z.enum(['open', 'upheld', 'rejected']).nullable(),
        window_ends_at: z.string().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  // PRIVACY: strict, exactly as the owner payload is. This RPC is the one place
  // a spotter reads rows joined to somebody else's post, so a widened server
  // payload — a post id, a location, an owner name — must fail loudly here
  // rather than quietly reach a screen that was never reviewed for it.
  .strict();

/**
 * The signed-in spotter's OWN sighting record, newest first.
 *
 * ⚠️ THE ONLY SURFACE ON WHICH A not_mine VERDICT IS VISIBLE, and it is visible
 * to the spotter alone. No stranger-facing surface may show a rejection or
 * derive an accuracy figure from one: a spotter reports on a description, and
 * "the owner said no" is not the same as "they were wrong". my_sighting_record's
 * own comment says this; spotterTrust.ts said it too, before it was lost.
 */
export async function fetchMySightingRecord(): Promise<MySightingRecordEntry[]> {
  const { data, error } = await supabase.rpc('my_sighting_record');
  if (error) {
    log.warn('my_sighting_record failed', { code: error.code });
    throw new Error('We couldn’t load your reports. Please try again.');
  }
  const parsed = z
    .object({ sightings: z.array(mySightingRowSchema) })
    .strict()
    .parse(data);

  return parsed.sightings.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    reviewedAt: row.reviewed_at,
    areaLabel: row.area_label,
    car: row.car,
    // Absent (old server) and null (no hold) collapse to the same thing here:
    // the screen has no door to show. Only a present, `available` object is a
    // door, and the mapping keeps that decision in one place.
    ...(row.dispute
      ? {
          dispute: {
            available: row.dispute.available,
            status: row.dispute.status,
            windowEndsAt: row.dispute.window_ends_at,
          },
        }
      : {}),
  }));
}

/** Thrown when the owner tries to reject a sighting they already confirmed. */
export class SightingVerdictError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SightingVerdictError';
    this.code = code;
  }
}

/**
 * Owner marks a sighting "that isn't my car" (unverified → not_mine).
 *
 * ⚠️ THIS IS THE ABSENCE OF A CONFIRMATION, NOT A PENALTY. It bumps no counter
 * and is fully reversible — mark_sighting_helpful accepts not_mine as a source,
 * so an owner may correct a rejection at no cost to anyone. Copy built on it
 * must never read as a judgement of the spotter, who reported in good faith on
 * a car that looked like the one they were shown.
 *
 * ⚠️ helpful → not_mine IS REFUSED (ALREADY_COUNTED), and the reason is
 * structural rather than fussy: the confirmation has already moved
 * profiles.sightings_helpful, and this schema has NO decrement anywhere. Taking
 * a badge back off someone's profile with no explanation is worse than an owner
 * living with a mis-tap, so the undo window is client-side and this is the
 * backstop.
 */
export async function markSightingNotMine(
  sightingId: string,
): Promise<{ status: 'not_mine' | 'credited'; changed: boolean }> {
  const { data, error } = await supabase.rpc('mark_sighting_not_mine', {
    p_sighting_id: sightingId,
  });
  if (error) {
    log.warn('mark_sighting_not_mine failed', { code: error.code });
    if (error.message?.includes('ALREADY_COUNTED')) {
      throw new SightingVerdictError(
        'You’ve already marked this one helpful, and that credit can’t be taken back.',
        'ALREADY_COUNTED',
      );
    }
    throw new SightingVerdictError(
      'We couldn’t update that sighting. Please try again.',
      'UNKNOWN',
    );
  }
  const parsed = z
    .object({ status: z.enum(['not_mine', 'credited']), changed: z.boolean() })
    .strict()
    .parse(data);
  log.info('sighting_marked_not_mine', { sightingId, changed: parsed.changed });
  return parsed;
}
