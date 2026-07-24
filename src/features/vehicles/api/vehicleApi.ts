/**
 * WHAT:  vehicleApi — fetches + validates one post's detail via the
 *        get_post_detail RPC, returning the visible / hidden / not-found union.
 * WHY:   The RPC is SECURITY DEFINER and gates visibility itself (SAFETY:
 *        active-or-owner only); the client still hard-validates the payload
 *        with zod so a shape drift fails loudly rather than rendering a
 *        half-empty screen. The hidden branch is asserted to carry ONLY a
 *        closedReason — never make/model/plate/location — matching the RPC's
 *        no-leak contract.
 * LINKS: src/features/vehicles/hooks/usePostDetail.ts (consumer);
 *        supabase/migrations/20260713140000_post_detail.sql (RPC);
 *        src/shared/api (supabase client).
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { samplePhotos } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import type { PostStatus } from '@/shared/types';

import type { PostDetail, PostDetailResult } from '../types';

const log = createLogger('vehicles');

/** Full lifecycle enum — the OWNER may view their post in any status, so this
 *  is wider than the feed's active-only visible set. */
const postStatusSchema = z.enum([
  'draft',
  'pending_verification',
  'active',
  'recovery_claimed',
  'recovered',
  'recovered_no_spotter',
  'cancelled',
  'expired',
  'rejected',
]) satisfies z.ZodType<PostStatus>;

const photoSchema = z.object({ url: z.string(), position: z.number().int() });

const notFoundSchema = z.object({ found: z.literal(false) });

const hiddenSchema = z.object({
  found: z.literal(true),
  visible: z.literal(false),
  closedReason: z.enum(['recovered', 'unavailable']),
});

const visibleSchema = z.object({
  found: z.literal(true),
  visible: z.literal(true),
  id: z.guid(),
  is_owner: z.boolean(),
  // Null for a plate-less post (make/model are then the identity).
  plate: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  colour: z.string(),
  bounty_amount_pence: z.number().int(),
  status: postStatusSchema,
  last_seen_at: z.string().nullable(),
  last_seen_area: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  year: z.number().int().nullable(),
  body_type: z.string().nullable(),
  distinguishing_features: z.string().nullable(),
  owner_note: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  photos: z.array(photoSchema),
  owner: z.object({
    member_since: z.string(),
    // Present only for signed-in viewers (null for anon).
    first_name: z.string().nullable(),
  }),
  features: z.array(z.object({ key: z.string(), label: z.string(), icon: z.string() })),
  // Deferred: get_post_detail does not return these yet, so this defaults to []
  // on every post today. Kept in the schema so the detail render can consume it
  // the moment the RPC starts sending it (graceful absence until then).
  distinctive_features: z
    .array(z.object({ photo_url: z.string(), description: z.string() }))
    .optional()
    .default([]),
  stolen_from: z.enum(['driveway', 'street', 'car_park', 'other']).nullable(),
  keys_taken: z.enum(['yes', 'no', 'unknown']).nullable(),
  desc_recognise: z.string().nullable(),
  desc_drives: z.string().nullable(),
  sighting_stats: z.object({ count: z.number().int(), latest_at: z.string().nullable() }),
  // Whether THIS caller has a sighting on the post (gates "Message the owner").
  viewer_has_sighting: z.boolean(),
});

type VisibleRow = z.infer<typeof visibleSchema>;

/** snake_case RPC row → camelCase domain shape (nullable → optional). */
function toPostDetail(row: VisibleRow): PostDetail {
  return {
    id: row.id,
    isOwner: row.is_owner,
    status: row.status,
    make: row.make,
    model: row.model,
    colour: row.colour,
    plate: row.plate,
    year: row.year ?? undefined,
    bodyType: row.body_type ?? undefined,
    distinguishingFeatures: row.distinguishing_features ?? undefined,
    ownerNote: row.owner_note ?? undefined,
    bountyPence: row.bounty_amount_pence,
    lastSeenAt: row.last_seen_at,
    lastSeenArea: row.last_seen_area ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    // Photo order is the RPC's (by position); map url → uri for AppImage.
    // No real photos yet (upload pipeline unbuilt) → DEV shows sample car
    // images so the hero can be seen (samplePhotos is [] in production).
    photos:
      row.photos.length > 0
        ? row.photos.map((photo) => ({ uri: photo.url }))
        : samplePhotos(row.id),
    owner: {
      memberSince: row.owner.member_since,
      firstName: row.owner.first_name ?? undefined,
    },
    features: row.features,
    distinctiveFeatures: row.distinctive_features.map((feature) => ({
      photoUrl: feature.photo_url,
      description: feature.description,
    })),
    stolenFrom: row.stolen_from ?? undefined,
    keysTaken: row.keys_taken ?? undefined,
    descRecognise: row.desc_recognise ?? undefined,
    descDrives: row.desc_drives ?? undefined,
    sightingCount: row.sighting_stats.count,
    latestSightingAt: row.sighting_stats.latest_at ?? undefined,
    viewerHasSighting: row.viewer_has_sighting,
  };
}

export async function fetchPostDetail(postId: string): Promise<PostDetailResult> {
  const { data, error } = await supabase.rpc('get_post_detail', { p_post_id: postId });
  if (error) {
    log.error('post_detail_rpc_error', { code: error.code });
    throw new Error(error.message);
  }

  // Dispatch on the discriminator before the heavy parse.
  if (notFoundSchema.safeParse(data).success) {
    return { kind: 'notFound' };
  }
  const hidden = hiddenSchema.safeParse(data);
  if (hidden.success) {
    return { kind: 'hidden', closedReason: hidden.data.closedReason };
  }
  const visible = visibleSchema.safeParse(data);
  if (!visible.success) {
    const issue = visible.error.issues[0];
    log.error('post_detail_parse_error', { path: issue?.path.join('.'), message: issue?.message });
    throw new Error('Malformed post detail');
  }
  return { kind: 'visible', post: toPostDetail(visible.data) };
}
