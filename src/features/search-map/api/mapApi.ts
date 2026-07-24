/**
 * WHAT:  Supabase read for the search map — search_posts (results) and
 *        search_posts_count (the live "Show N cars" count), zod-validated and
 *        mapped to MapPost (PostSummary + exact pin coordinates). Results come
 *        back as { total, posts } for the sheet handle and the pins.
 * WHY:   Same client-side safety contract as the feed: only ACTIVE posts may
 *        carry exact coordinates, so the schema hard-rejects any other status —
 *        a server regression fails loudly here instead of rendering pins it
 *        shouldn't. Criteria are mapped through the pure toRpcCriteria (which
 *        drops empties and NEVER emits plate/distance), so the query the server
 *        sees is exactly what the user chose. Loads log [search-map] with bbox
 *        SPANS + which criteria KEYS were used, never precise coordinates or
 *        values.
 * LINKS: supabase/migrations/20260725100000_search_posts_rpc.sql (RPCs +
 *        SAFETY notes); src/features/search-map/lib/searchCriteria.ts (the
 *        client→server mapping); src/features/search-map/api/feedApi.ts (shared
 *        post schema); docs/LOGGING.md.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import type { MapPost, ViewportResult } from '../types';
import type { Bbox } from '../lib/regionMath';
import { type SearchCriteria, toRpcCriteria } from '../lib/searchCriteria';
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

const countSchema = z.number().int().nonnegative();

function toMapPost(row: z.infer<typeof rpcMapPostSchema>): MapPost {
  return {
    ...toPostSummary(row),
    latitude: row.lat,
    longitude: row.lng,
  };
}

/**
 * Fetch the active posts inside a viewport bbox that match the criteria,
 * newest first, capped. `criteria` is mapped through toRpcCriteria, so an
 * unfiltered search sends `{}` and behaves like the plain viewport query.
 */
export async function fetchSearchPosts(
  bbox: Bbox,
  criteria: SearchCriteria,
  limit: number = VIEWPORT_POST_LIMIT,
): Promise<ViewportResult> {
  const startedAt = Date.now();
  const rpcCriteria = toRpcCriteria(criteria);
  const { data, error } = await supabase.rpc('search_posts', {
    p_min_lat: bbox.minLat,
    p_min_lng: bbox.minLng,
    p_max_lat: bbox.maxLat,
    p_max_lng: bbox.maxLng,
    p_criteria: rpcCriteria,
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
    // KEY NAMES only — never the values (make/model aren't sensitive, but stay
    // conservative and log presence, not content).
    criteriaKeys: Object.keys(rpcCriteria),
    total: parsed.data.total,
    returned: posts.length,
    durationMs: Date.now() - startedAt,
  });
  return { total: parsed.data.total, posts };
}

/**
 * The cheap count for the live "Show N cars" button — the same predicate as
 * fetchSearchPosts but count-only (no rows serialised), so it can fire on every
 * debounced criteria change while the user assembles a search.
 */
export async function fetchSearchCount(bbox: Bbox, criteria: SearchCriteria): Promise<number> {
  const rpcCriteria = toRpcCriteria(criteria);
  const { data, error } = await supabase.rpc('search_posts_count', {
    p_min_lat: bbox.minLat,
    p_min_lng: bbox.minLng,
    p_max_lat: bbox.maxLat,
    p_max_lng: bbox.maxLng,
    p_criteria: rpcCriteria,
  });
  if (error) {
    log.error('map_search_count failed', { code: error.code });
    throw error;
  }
  const parsed = countSchema.safeParse(data);
  if (!parsed.success) {
    log.error('map_search_count parse failed', { firstIssue: parsed.error.issues[0]?.message });
    throw parsed.error;
  }
  return parsed.data;
}
