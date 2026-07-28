/**
 * WHAT:  Types owned by the garage — a saved vehicle as `list_my_vehicles`
 *        returns it, the add/edit RPC argument shapes, and the wizard answers
 *        for the add-a-car flow.
 * WHY:   Kept apart from the data layer so the flow config and screens can
 *        import the shapes without pulling in the supabase client (the same
 *        split features/vehicles/post/types.ts makes).
 *
 *        DEPENDENCY DIRECTION: the garage imports the shared vehicle-identity
 *        step list and its answer shape FROM features/vehicles, never the other
 *        way round. features/vehicles must not import the garage, or the two
 *        features would form a cycle (ARCHITECTURE.md rule 1). That is why the
 *        prefilled posting flow takes a plain VehicleAnswers value rather than a
 *        SavedVehicle: mapping SavedVehicle -> VehicleAnswers happens HERE.
 * LINKS: src/features/garage/README.md;
 *        src/features/vehicles/post/types.ts (VehicleAnswers, the shared slice);
 *        supabase/migrations/20260801100000_garage_vehicles.sql.
 */

import type { DistinctiveFeature } from '@/features/vehicles';
import type { PickedPhoto } from '@/shared/ui';

/** Reserved lifecycle for a future ownership check. NOTHING writes anything but
 *  'unverified' today — V5C/pre-verification was deliberately excluded from the
 *  garage (it buys no time under live-on-payment and needs the unbuilt moderator
 *  queue). The column exists so re-introduction needs no table rewrite. */
export type VehicleVerificationState = 'unverified' | 'pending' | 'verified' | 'rejected';

/** A photo already stored in the post-photos bucket, as the server returns it. */
export interface SavedVehiclePhoto {
  url: string;
  position: number;
}

/** An owner-authored evidence pair on a saved car (photo + what to look for). */
export interface SavedVehicleFeature {
  photoUrl: string;
  description: string;
  position: number;
}

/** One car in the user's garage, as `list_my_vehicles` returns it. */
export interface SavedVehicle {
  id: string;
  /** Optional throughout — plates are optional on posts too (DOMAIN.md). */
  plate: string | null;
  make: string;
  model: string;
  colour: string;
  /** Free-text specifics for an escape colour ("matte black wrap over silver").
   *  Kept so a wrapped car doesn't lose the detail that identifies it — and so a
   *  post prefilled from it doesn't either. */
  colourNote: string | null;
  year: number | null;
  bodyType: string | null;
  /** Friendly label, e.g. "Mum's Golf". Falls back to make + model in the UI. */
  nickname: string | null;
  verificationState: VehicleVerificationState;
  photos: SavedVehiclePhoto[];
  distinctiveFeatures: SavedVehicleFeature[];
  /** True while a post created from this car is live (active /
   *  pending_verification / recovery_claimed). Drives the "Currently reported
   *  stolen" card state and blocks removal. */
  isCurrentlyPosted: boolean;
  /** The live post's id when isCurrentlyPosted — the card links to it. */
  activePostId: string | null;
  createdAt: string;
}

/**
 * The add/edit wizard's answers. This is the shared vehicle-identity slice
 * (imported from features/vehicles so the posting wizard and the garage collect
 * IDENTICAL data) plus the garage-only fields.
 */
export interface AddVehicleAnswers {
  /** Garage-only: posting dropped plate capture on 2026-07-24, but a saved car
   *  wants one — it is the natural garage key and it re-arms create_post's
   *  one-active-post-per-plate guard. Optional; validated against UK formats. */
  plate: string;
  make: string;
  model: string;
  colour: string;
  colourNote: string;
  year: number | null;
  bodyType: string | null;
  distinctiveFeatures: DistinctiveFeature[];
  /** 0–6 here. The garage does NOT require posting's 3–6 minimum: adding a car
   *  must stay a 60-second job or nobody does it. A car with <3 photos simply
   *  keeps the real photos step when it is used to start a post. */
  photos: PickedPhoto[];
  /** Garage-only, optional. */
  nickname: string;
}

/** Positional arguments for add_vehicle / update_vehicle, named as the SQL. */
export interface SaveVehicleParams {
  p_plate: string | null;
  p_make: string;
  p_model: string;
  p_colour: string;
  p_colour_note: string | null;
  p_year: number | null;
  p_body_type: string | null;
  p_nickname: string | null;
  p_photo_urls: string[];
  p_distinctive_features: { photo_url: string; description: string }[];
}

/** The most vehicles one account may save. Beyond this the CTA explains kindly
 *  rather than failing on submit; the server re-enforces it. */
export const MAX_VEHICLES = 5;
