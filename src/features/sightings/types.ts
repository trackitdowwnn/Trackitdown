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
  'being_loaded',
  'people_nearby',
  'plate_changed',
  'damage_visible',
  'being_stripped',
  'looks_intact',
] as const;
export type SightingContextFlag = (typeof SIGHTING_CONTEXT_FLAGS)[number];

/** The three vehicle-state flags are mutually exclusive FACTS — the context
 *  step offers them as a single-select group (the storage stays the shared
 *  context_flags array, so old multi-flag rows still parse). */
export const VEHICLE_STATE_FLAGS = ['parked', 'driving', 'being_loaded'] as const;
export type VehicleStateFlag = (typeof VEHICLE_STATE_FLAGS)[number];

/** Condition-at-a-glance chips (multi-select; plate_changed predates the
 *  group but belongs to it). */
export const CONDITION_FLAGS = [
  'plate_changed',
  'damage_visible',
  'being_stripped',
  'looks_intact',
] as const;
export type ConditionFlag = (typeof CONDITION_FLAGS)[number];

/** 3-way people observation — supersedes the people_nearby flag for NEW
 *  reports ('in_vehicle' is the urgency case; the inline safety register
 *  reinforces "don't approach" on nearby/in_vehicle). Old rows carry the
 *  flag instead; renderers handle both. */
export const PEOPLE_PRESENCE = ['nobody', 'nearby', 'in_vehicle'] as const;
export type PeoplePresence = (typeof PEOPLE_PRESENCE)[number];

export const PARKED_LIKELIHOOD = ['settled', 'street', 'moving'] as const;
export type ParkedLikelihood = (typeof PARKED_LIKELIHOOD)[number];

export const DRIVING_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type DrivingDirection = (typeof DRIVING_DIRECTIONS)[number];

/** One registered distinctive mark on the post, as the wizard offers it for
 *  confirmation ("Could you see the cracked wing mirror?"). */
export interface ConfirmableFeature {
  id: string;
  description: string;
}

/** The wizard's single answers object. */
export interface ReportSightingAnswers {
  /** 1–3 in-app captures, each an atomic photo+GPS+timestamp bundle. */
  photos: EvidencePhoto[];
  contextFlags: SightingContextFlag[];
  note: string;
  /** Coarse human label for the captured point ("Camden High Street"),
   *  reverse-geocoded from the FIRST located photo; display + server copy. */
  areaLabel?: string;
  /** District/city grain from the same geocode — the PUBLIC place grain
   *  (ADR-0008). Never street-level. */
  locality?: string;
  /** If parked is selected: likelihood that the vehicle will remain there. */
  parkedLikelihood?: ParkedLikelihood;
  /** If driving is selected: compass direction the vehicle was heading. */
  direction?: DrivingDirection;
  /** 3-way people observation; undefined = skipped. */
  peoplePresence?: PeoplePresence;
  /** Ids of the post's registered marks the spotter confirmed seeing. */
  confirmedFeatureIds?: string[];
  /** READ-ONLY seed (not submitted): the post's registered marks, fetched by
   *  the screen before the wizard mounts so the context step can offer them
   *  as checkmarks. Empty/absent = no marks section. */
  confirmableFeatures?: ConfirmableFeature[];
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
  p_locality: string | null;
  p_parked_likelihood: string | null;
  p_direction: string | null;
  p_people_presence: string | null;
  p_confirmed_feature_ids: string[] | null;
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
    /** ADR-0003 provenance — 'gallery' photos are labelled to the owner. */
    source: 'live' | 'gallery';
  }[];
  parkedLikelihood: ParkedLikelihood | null;
  direction: DrivingDirection | null;
  peoplePresence: PeoplePresence | null;
  /** The registered marks this spotter confirmed seeing, resolved to their
   *  descriptions server-side (empty for older sightings). */
  confirmedFeatures: ConfirmableFeature[];
  spotter: {
    firstName: string;
    sightingsReported: number;
    sightingsHelpful: number;
    recoveriesCredited: number;
    memberSince: string;
  };
}

/**
 * One PUBLIC timeline entry (get_public_sighting_entries — ADR-0008). This
 * shape IS the privacy fence: time and coarse locality, nothing else. No id,
 * no coordinates, no photos, no spotter, no note. Widening it is a
 * SECURITY_AND_TRUST §6 decision, not a convenience.
 */
export interface PublicSightingEntry {
  sightedAt: string;
  /** District/city grain, captured at report time; null on older sightings
   *  (the entry renders time-only). Never the street-level areaLabel. */
  locality: string | null;
  /** ~1km grid-snapped point (ADR-0009) — rounded SERVER-side; the public
   *  map draws the trail's shape from these. Null = un-located sighting.
   *  Never a real capture coordinate. */
  snapLat: number | null;
  snapLng: number | null;
}

/** The capped public payload: five newest entries + how many were cut. */
export interface PublicSightingEntries {
  entries: PublicSightingEntry[];
  earlierCount: number;
}
