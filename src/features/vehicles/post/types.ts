/**
 * WHAT:  Types for the post-a-car wizard — the single serializable answers
 *        object the flow collects, the create_post RPC's argument shape, and
 *        the submit result. Kept apart from the data layer so the flow config
 *        and step components (next pass) can import the answer shape without
 *        pulling in the supabase client.
 * WHY:   The answers object is the wizard's whole state (framework rule: one
 *        serializable value), and it's also the seam draft-resume plugs into
 *        later. CreatePostParams mirrors the RPC's positional args 1:1 so the
 *        mapping from answers → server call is one auditable place.
 * LINKS: src/features/vehicles/post/README.md;
 *        src/features/vehicles/post/api/postApi.ts (the mapping + call);
 *        supabase/migrations/20260713190000_post_a_car.sql (create_post).
 */

import type { PickedPhoto } from '@/shared/ui';

import type { DistinctiveFeature } from './lib/distinctiveFeatures';

/** Where the car was taken from — mirrors the posts.stolen_from CHECK. */
export type StolenFrom = 'driveway' | 'street' | 'car_park' | 'other';
/** Whether the keys were taken — mirrors the posts.keys_taken CHECK. */
export type KeysTaken = 'yes' | 'no' | 'unknown';

/** A settled last-seen location, as emitted by LocationPicker (sans isSettled). */
export interface LastSeenLocation {
  latitude: number;
  longitude: number;
  addressLabel: string;
}

/**
 * The wizard's answers. Every step edits its own slice; the whole object is
 * serialized straight into the create_post call at submit. Fields are optional
 * on `Partial<PostACarAnswers>` while the wizard is mid-flow; the per-step zod
 * schemas gate that each is present before its step can advance.
 */
export interface PostACarAnswers {
  // --- Phase 1: the car -----------------------------------------------------
  // NOTE: plate capture is deferred — no `plate` field for now. make/model/
  // colour are the car's identity; buildCreatePostParams sends p_plate: null.
  make: string;
  model: string;
  /** Canonical colour NAME from the swatch grid (a clean enum, not a hex). */
  colour: string;
  /** Free-text specifics for an escape colour ("Multicolour / wrapped" / "Other"),
   *  e.g. "matte black wrap over silver". Empty for a plain colour. Stored to
   *  posts.owner_note so it never pollutes the colour enum. */
  colourNote: string;
  /** DVLA-enrichable; null on the manual path when unknown. */
  year: number | null;
  /** DVLA-enrichable body style (e.g. "Hatchback"); null when unknown. */
  bodyType: string | null;
  /** Owner-authored evidence pairs — one photo + a description of a specific
   *  mark (e.g. "Cracked nearside wing mirror"). Optional; 0–8. Replaced BOTH
   *  the old free-text `descRecognise` prompt and the `featureKeys` chip
   *  taxonomy step (a photographed mark identifies a car better than a chip). */
  distinctiveFeatures: DistinctiveFeature[];
  photos: PickedPhoto[];

  // --- Phase 2: when & where ------------------------------------------------
  /** ISO datetime; the step gates max = now. */
  lastSeenAt: string;
  location: LastSeenLocation | null;
  /** Coarse grouping label (the feed's bucket), derived at the location step. */
  lastSeenArea: string;
  stolenFrom: StolenFrom | null;
  keysTaken: KeysTaken | null;
  /** Guided prompt: "Anything about how it drives or sounds?" */
  descDrives: string;

  // --- Phase 3: bounty & verification --------------------------------------
  /** Integer GBP pence; £50–£5,000 (5000–500000). */
  bountyAmountPence: number;
  /** The V5C / proof-of-ownership image (private bucket). */
  verification: PickedPhoto | null;
}

/**
 * Positional arguments for the create_post RPC, named exactly as the SQL
 * parameters. Photos arrive as already-uploaded public URLs and the V5C as an
 * already-uploaded private storage path — the RPC stores, it does not upload.
 */
export interface CreatePostParams {
  /** Null when the car has no plate; the RPC skips the format + uniqueness gates. */
  p_plate: string | null;
  p_make: string;
  p_model: string;
  p_colour: string;
  p_year: number | null;
  p_body_type: string | null;
  p_distinguishing_features: string | null;
  p_owner_note: string | null;
  p_desc_recognise: string | null;
  p_desc_drives: string | null;
  p_stolen_from: StolenFrom | null;
  p_keys_taken: KeysTaken | null;
  p_last_seen_at: string;
  p_last_seen_lat: number;
  p_last_seen_lng: number;
  p_last_seen_area: string;
  p_bounty_amount_pence: number;
  p_photo_urls: string[];
  p_feature_keys: string[] | null;
  /** Owner evidence pairs as a jsonb array; [] when none. Each photo is an
   *  already-uploaded public URL (own-folder), paired with its description. */
  p_distinctive_features: { photo_url: string; description: string }[];
  p_verification_path: string | null;
}

/** What create_post returns on success. */
export interface CreatePostResult {
  postId: string;
  status: 'draft';
}
