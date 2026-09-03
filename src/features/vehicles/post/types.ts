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

import type { VehicleAnswers } from './lib/vehicleSteps';

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
export interface PostACarAnswers extends VehicleAnswers {
  // --- Phase 1: the car -----------------------------------------------------
  // The vehicle-identity slice (make, model, colour, colourNote, year, bodyType,
  // distinctiveFeatures, photos) is INHERITED from VehicleAnswers — the same
  // fields the garage collects, so one shared step table serves both flows. See
  // post/lib/vehicleSteps.tsx. Plate capture is deferred here (the garage does
  // collect one); buildCreatePostParams sends p_plate: null.

  // --- Phase 2: when & where ------------------------------------------------
  /** ISO datetime; the step gates max = now. */
  lastSeenAt: string;
  location: LastSeenLocation | null;
  /** Coarse grouping label (the feed's bucket), derived at the location step.
   *  NOTE: this is the raw reverse-geocoded address label truncated to 80 —
   *  it CAN be street-grain. Public-facing copy must prefer lastSeenLocality. */
  lastSeenArea: string;
  /** District/city grain only — the one place name a spotter-alert push may
   *  name (posts.last_seen_locality). Nullable: geocoding is best-effort, and
   *  an explicit null records "we tried and got nothing" so the push falls
   *  back to "your area" rather than to the street-grain lastSeenArea. */
  lastSeenLocality?: string | null;
  stolenFrom: StolenFrom | null;
  keysTaken: KeysTaken | null;
  /** Guided prompt: "Anything about how it drives or sounds?" — no longer a
   *  wizard step (replaced by the description step); still edited post-hoc via
   *  the theft-context editor. */
  descDrives: string;
  /** Free-text "About this car" description → desc_recognise. Optional, ≤1000
   *  chars. Collected in the wizard's description step; shown in the post
   *  detail's About section. */
  descRecognise: string;

  // --- Phase 3: reward ------------------------------------------------------
  /**
   * How this listing is paid for (ADR-0014). 'bounty' escrows £10–£5,000 and
   * pays 95% of it to a credited spotter; 'fee' charges the fixed platform fee
   * once and offers no cash reward.
   */
  pricingMode: PricingMode;
  /**
   * Integer GBP pence, bounded by MIN/MAX_BOUNTY_PENCE (the ONE mirror).
   *
   * KEPT even while pricingMode is 'fee', and deliberately not nullable here.
   * The slider always holds a value, so an owner who tries "no reward" and
   * changes their mind gets their chosen amount back rather than a reset
   * control. `pricingMode` is the discriminator; buildCreatePostParams is the
   * one place that turns 'fee' into the null the server actually stores.
   */
  bountyAmountPence: number;
  /**
   * The garage vehicle this wizard was prefilled from, or undefined for a post
   * typed from scratch.
   *
   * NOT a question anyone is asked — no step reads or writes it. It rides the
   * answers because that is what survives the whole wizard, including the
   * expanded "edit everything" branch, and buildCreatePostParams is the one
   * place that turns it into the RPC's p_vehicle_id.
   */
  fromVehicleId?: string;
}

/** Which of the two pricing modes a listing uses (ADR-0014). */
export type PricingMode = 'bounty' | 'fee';

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
  /** District-grain place for spotter alerts; null when the geocode failed. */
  p_last_seen_locality: string | null;
  /**
   * Integer pence, or NULL for a no-reward listing (ADR-0014) — in which case
   * create_post stamps the fixed listing fee server-side. The client never
   * sends a fee: the price is not ours to name.
   */
  p_bounty_amount_pence: number | null;
  p_photo_urls: string[];
  p_feature_keys: string[] | null;
  /** Owner evidence pairs as a jsonb array; [] when none. Each photo is an
   *  already-uploaded public URL (own-folder), paired with its description. */
  p_distinctive_features: { photo_url: string; description: string }[];
  p_verification_path: string | null;
  /**
   * PROVENANCE: the garage vehicle this post was prefilled from, or null for a
   * post typed from scratch.
   *
   * Never displayed. It arms `delete_vehicle`'s active-post guard and
   * `list_my_vehicles.is_currently_posted`, both of which were dead code from
   * 2026-08-01 to 2026-09-02 because nothing ever wrote the column — so an
   * owner could delete a car that was currently reported stolen with money in
   * escrow. The server IGNORES an id the caller does not own.
   */
  p_vehicle_id: string | null;
}

/** What create_post returns on success. */
export interface CreatePostResult {
  postId: string;
  status: 'draft';
}
