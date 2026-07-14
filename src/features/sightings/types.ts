/**
 * WHAT:  Types owned by the sightings feature — the wizard's answers shape,
 *        the context-flag vocabulary, the create_sighting RPC param/result
 *        shapes, the quota, and the owner-list payload.
 * WHY:   One place ties the wizard steps, the API layer, and the RPC contract
 *        together; the flag vocabulary mirrors the sightings.context_flags
 *        CHECK constraint so client and server agree by construction.
 * LINKS: src/features/sightings/api/sightingApi.ts;
 *        supabase/migrations/*_sightings.sql; src/shared/ui (EvidencePhoto).
 */

import type { EvidencePhoto } from '@/shared/ui';

/** Evidence bounds — mirrored by the create_sighting RPC. Live HERE (not the
 *  api module) so the flow config's module graph stays off the supabase
 *  client (jest-safe, mirroring postACarFlow's direct-import note). */
export const MIN_SIGHTING_PHOTOS = 1;
export const MAX_SIGHTING_PHOTOS = 3;
export const MAX_NOTE_LENGTH = 500;

/** Mirrors the sightings.context_flags whitelist in the migration. */
export const SIGHTING_CONTEXT_FLAGS = [
  'parked',
  'driving',
  'people_nearby',
  'plate_changed',
] as const;
export type SightingContextFlag = (typeof SIGHTING_CONTEXT_FLAGS)[number];

/** The wizard's single answers object. */
export interface ReportSightingAnswers {
  /** 1–3 in-app captures, each an atomic photo+GPS+timestamp bundle. */
  photos: EvidencePhoto[];
  contextFlags: SightingContextFlag[];
  note: string;
  /** Coarse human label for the captured point ("Camden High Street"),
   *  reverse-geocoded from the FIRST located photo; display + server copy. */
  areaLabel?: string;
}

/** create_sighting RPC arguments (p_photos is the jsonb evidence array). */
export interface CreateSightingParams {
  p_post_id: string;
  p_photos: {
    path: string;
    lat: number | null;
    lng: number | null;
    accuracy_m: number | null;
    captured_at: string;
  }[];
  p_context_flags: string[];
  p_note: string | null;
  p_area_label: string | null;
}

export interface CreateSightingResult {
  sightingId: string;
}

export interface SightingQuota {
  used: number;
  maxPerDay: number;
}

/** One sighting as the OWNER sees it (get_post_sightings). PRIVACY: the
 *  spotter is first name + reputation + member-since ONLY — never an id,
 *  surname, or contact path (SECURITY_AND_TRUST §1). */
export interface OwnerSighting {
  id: string;
  createdAt: string;
  status: 'unverified' | 'helpful' | 'credited';
  contextFlags: SightingContextFlag[];
  note: string | null;
  areaLabel: string | null;
  locationUnavailable: boolean;
  photos: {
    path: string;
    lat: number | null;
    lng: number | null;
    accuracyM: number | null;
    capturedAt: string;
  }[];
  spotter: {
    firstName: string;
    sightingsReported: number;
    sightingsHelpful: number;
    recoveriesCredited: number;
    memberSince: string;
  };
}
