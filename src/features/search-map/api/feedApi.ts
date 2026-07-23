/**
 * WHAT:  Supabase reads for the home feed — the get_home_feed RPC (whole
 *        feed, one round trip) and get_nearby_posts (hero pagination), each
 *        zod-validated and mapped to the shared PostSummary shape.
 * WHY:   The feed is composed SERVER-side so the client never assembles
 *        safety-sensitive queries; this file only validates and renames.
 *        Responses are parsed with zod because the RPC returns raw jsonb —
 *        a shape drift should fail loudly here, not render garbage cards.
 *        Loads are logged with the [search-map] tag — coarse coords only
 *        (redactLocation), never plates.
 * LINKS: supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
 *        (RPC shapes + SAFETY notes); src/shared/types/posts.ts;
 *        docs/LOGGING.md.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { samplePhotos } from '@/shared/lib';
import { createLogger, redactLocation } from '@/shared/lib/logger';
import type { PostStatus, PostSummary } from '@/shared/types';

import type { FeedSection } from '../types';
import { milesToMetres } from '../lib/feedConfig';

const log = createLogger('search-map');

// Statuses the RPCs may legally return (SAFETY: the server enforces this —
// the enum here means an unexpected status fails validation instead of
// silently rendering).
const visibleStatusSchema = z.enum(['active', 'recovered', 'recovered_no_spotter']);

// Shared with mapApi (same post JSON shape from home_feed_post_json).
export const rpcPostSchema = z.object({
  // guid, NOT uuid: Postgres's uuid type doesn't enforce RFC-4122
  // version/variant nibbles (fixed dev/seed ids legitimately fail z.uuid()).
  id: z.guid(),
  // Null for a plate-less post (make/model are then the identity).
  plate: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  colour: z.string(),
  bounty_amount_pence: z.number().int(),
  status: visibleStatusSchema,
  last_seen_at: z.string().nullable(),
  last_seen_area: z.string().nullable(),
  distance_miles: z.number().nullable(),
  created_at: z.string(),
});

const rpcSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  layout: z.enum(['hero-vertical', 'carousel']),
  area: z.string().optional(),
  posts: z.array(rpcPostSchema),
});

const rpcFeedSchema = z.object({ sections: z.array(rpcSectionSchema) });

type RpcPost = z.infer<typeof rpcPostSchema>;

export function toPostSummary(row: RpcPost): PostSummary {
  return {
    id: row.id,
    // No photo schema in the feed RPC yet → cards render the placeholder in
    // production; DEV fills sample car images so the feed can be seen with
    // pictures (samplePhotos returns [] outside __DEV__).
    photos: samplePhotos(row.id),
    make: row.make,
    model: row.model,
    colour: row.colour,
    plate: row.plate,
    status: row.status as PostStatus,
    lastSeenAt: row.last_seen_at ?? row.created_at,
    lastSeenArea: row.last_seen_area ?? undefined,
    distanceMiles: row.distance_miles ?? undefined,
    bountyPence: row.bounty_amount_pence,
  };
}

function toFeedSection(section: z.infer<typeof rpcSectionSchema>): FeedSection {
  return {
    id: section.id,
    title: section.title,
    layout: section.layout,
    area: section.area,
    posts: section.posts.map(toPostSummary),
  };
}

/**
 * Fetch the whole composed feed. Pass null coordinates for national mode
 * (the RPC then returns only the recent_uk section).
 */
export async function fetchHomeFeed(params: {
  latitude: number | null;
  longitude: number | null;
  radiusMiles: number;
}): Promise<FeedSection[]> {
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('get_home_feed', {
    p_lat: params.latitude,
    p_lng: params.longitude,
    p_radius_m: milesToMetres(params.radiusMiles),
  });
  if (error) {
    log.error('feed_load failed', { code: error.code });
    throw error;
  }

  const parsed = rpcFeedSchema.safeParse(data);
  if (!parsed.success) {
    // A shape drift must fail loudly AND debuggably — the raw ZodError never
    // reaches a log otherwise (the screen just shows the error state).
    log.error('feed_load parse failed', {
      firstIssue: parsed.error.issues[0]?.message,
      path: parsed.error.issues[0]?.path.join('.'),
    });
    throw parsed.error;
  }
  const sections = parsed.data.sections.map(toFeedSection);
  log.info('feed_load', {
    origin:
      params.latitude != null && params.longitude != null
        ? redactLocation(params.latitude, params.longitude)
        : 'national',
    radiusMiles: params.radiusMiles,
    sectionIds: sections.map((s) => s.id),
    postCounts: sections.map((s) => s.posts.length),
    durationMs: Date.now() - startedAt,
  });
  return sections;
}

/** Fetch one page of the hero (near-you) list, nearest first. */
export async function fetchNearbyPosts(params: {
  latitude: number;
  longitude: number;
  radiusMiles: number;
  offset: number;
  limit: number;
}): Promise<PostSummary[]> {
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('get_nearby_posts', {
    p_lat: params.latitude,
    p_lng: params.longitude,
    p_radius_m: milesToMetres(params.radiusMiles),
    p_offset: params.offset,
    p_limit: params.limit,
  });
  if (error) {
    log.error('feed_page failed', { code: error.code, offset: params.offset });
    throw error;
  }
  const posts = z.array(rpcPostSchema).parse(data).map(toPostSummary);
  log.debug('feed_page', {
    offset: params.offset,
    count: posts.length,
    durationMs: Date.now() - startedAt,
  });
  return posts;
}
