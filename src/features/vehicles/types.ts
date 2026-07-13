/**
 * WHAT:  Types owned by the vehicles feature — the post-detail payload and the
 *        three-way result of loading it (visible / hidden / not-found).
 * WHY:   get_post_detail returns a discriminated shape: a full detail for a
 *        visible post, a minimal {closedReason} for a non-active post a viewer
 *        can't see, or not-found. Modelling that union here keeps the screen's
 *        branching honest and the SAFETY boundary (hidden posts leak nothing)
 *        in the type system.
 * LINKS: src/features/vehicles/api/vehicleApi.ts (parse);
 *        supabase/migrations/20260713140000_post_detail.sql (RPC shape);
 *        src/shared/types/posts.ts (PostStatus).
 */

import type { PostStatus } from '@/shared/types';

/** One hero photo. The upload/EXIF pipeline is the posting feature's; here we
 *  only read a URL (thumbhash arrives when that pipeline lands). */
export interface PostDetailPhoto {
  uri: string;
}

/** The post owner's identity block. first name is present ONLY for signed-in
 *  viewers (SAFETY: a theft victim isn't exposed to anon browsers); member-since
 *  (coarse account age) is always present. No avatar/photo — a uid-bearing
 *  avatar path would leak owner_id (see the 20260713170000 migration) — and
 *  never a surname. */
export interface OwnerSummary {
  memberSince: string;
  firstName?: string;
}

/** One checkable distinguishing feature (the "amenities" taxonomy). `icon` is
 *  a Feather icon name from the vehicle_feature reference table. */
export interface VehicleFeature {
  key: string;
  label: string;
  icon: string;
}

/** Where the car was stolen from (coarse category, never an address). */
export type StolenFrom = 'driveway' | 'street' | 'car_park' | 'other';
/** Whether the keys were taken with the car. */
export type KeysTaken = 'yes' | 'no' | 'unknown';

/** A visible post, fully resolved for the detail screen (camelCase). */
export interface PostDetail {
  id: string;
  /** Server-computed (owner_id === auth.uid()) — the owner's id is never sent. */
  isOwner: boolean;
  status: PostStatus;
  make: string;
  model: string;
  colour: string;
  plate: string;
  year?: number;
  bodyType?: string;
  distinguishingFeatures?: string;
  ownerNote?: string;
  bountyPence: number;
  lastSeenAt: string | null;
  lastSeenArea?: string;
  createdAt: string;
  /** When the post expires (owner can renew). Drives "Active until <date>". */
  expiresAt?: string;
  owner: OwnerSummary;
  /** Exact last-seen point (visible ⇒ active-and-public, or the owner's own). */
  lat?: number;
  lng?: number;
  photos: PostDetailPhoto[];
  /** Checkable distinguishing features (Part 2 taxonomy); [] on old posts. */
  features: VehicleFeature[];
  /** Theft context (Part 2) — all optional; absent on posts predating them. */
  stolenFrom?: StolenFrom;
  keysTaken?: KeysTaken;
  /** Guided-description prompts (Part 2); `ownerNote` remains for old posts. */
  descRecognise?: string;
  descDrives?: string;
  /** Dormant until the sightings feature ships — 0 today, section hides. */
  sightingCount: number;
  latestSightingAt?: string;
}

/** Why a post isn't shown: recovered (say so warmly) vs anything else. */
export type ClosedReason = 'recovered' | 'unavailable';

/** The three outcomes of loading a post detail. */
export type PostDetailResult =
  | { kind: 'visible'; post: PostDetail }
  | { kind: 'hidden'; closedReason: ClosedReason }
  | { kind: 'notFound' };
