/**
 * WHAT:  Supabase read for the search map — get_posts_in_viewport, zod-
 *        validated and mapped to MapPost (PostSummary + exact pin
 *        coordinates). Returns { total, posts } for the sheet handle and
 *        the pins.
 * WHY:   Same client-side safety contract as the feed: only ACTIVE posts
 *        may carry exact coordinates, so the schema hard-rejects any other
 *        status — a server regression fails loudly here instead of
 *        rendering pins it shouldn't. Loads log [search-map] with bbox
 *        spans, never precise coordinates.
 * LINKS: supabase/migrations/20260711190000_map_viewport_rpc.sql (RPC +
 *        SAFETY notes); src/features/search-map/api/feedApi.ts (shared
 *        post schema); docs/LOGGING.md.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import type { MapPost, ViewportResult } from '../types';
import type { Bbox } from '../lib/regionMath';
import { rpcPostSchema, toPostSummary } from './feedApi';

const log = createLogger('search-map');

/** Server cap mirrored client-side (the RPC clamps to 100 regardless). */
export const VIEWPORT_POST_LIMIT = 100;

// SAFETY: the map schema is STRICTER than the feed's — pins carry exact
// coordinates, which is only acceptable for active posts (their locations
// are public under RLS). Any other status fails validation outright.
const rpcMapPostSchema = rpcPostSchema.extend({
  status: z.literal('active'),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

const viewportSchema = z.object({
  total: z.number().int().nonnegative(),
  posts: z.array(rpcMapPostSchema),
});

function toMapPost(row: z.infer<typeof rpcMapPostSchema>): MapPost {
  return {
    ...toPostSummary(row),
    latitude: row.lat,
    longitude: row.lng,
  };
}

/** Fetch the active posts inside a viewport bbox, newest first. */
export async function fetchViewportPosts(
  bbox: Bbox,
  limit: number = VIEWPORT_POST_LIMIT,
): Promise<ViewportResult> {
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('get_posts_in_viewport', {
    p_min_lat: bbox.minLat,
    p_min_lng: bbox.minLng,
    p_max_lat: bbox.maxLat,
    p_max_lng: bbox.maxLng,
    p_limit: limit,
  });
  if (error) {
    log.error('map_search failed', { code: error.code });
    throw error;
  }

  const parsed = viewportSchema.safeParse(data);
  if (!parsed.success) {
    log.error('map_search parse failed', {
      firstIssue: parsed.error.issues[0]?.message,
      path: parsed.error.issues[0]?.path.join('.'),
    });
    throw parsed.error;
  }

  const posts = parsed.data.posts.map(toMapPost);
  log.info('map_search_area', {
    // Spans only — bbox corners would be precise location data.
    latSpan: Number((bbox.maxLat - bbox.minLat).toFixed(3)),
    lngSpan: Number((bbox.maxLng - bbox.minLng).toFixed(3)),
    total: parsed.data.total,
    returned: posts.length,
    durationMs: Date.now() - startedAt,
  });
  return { total: parsed.data.total, posts };
}
