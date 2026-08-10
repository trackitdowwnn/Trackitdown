/**
 * WHAT:  Supabase read for the search map — search_posts (results) and
 *        search_posts_count (the live "Show N cars" count), zod-validated and
 *        mapped to MapPost (PostSummary + exact pin coordinates). Results come
 *        back as { total, posts } for the sheet handle and the pins.
 * WHY:   Same client-side safety contract as the feed: only ACTIVE posts may
 *        carry exact coordinates, so the schema hard-rejects any other status —
 *        a server regression fails loudly here instead of rendering pins it
 *        shouldn't. Criteria are mapped through the pure toRpcCriteria (which
 *        drops empties and NEVER emits a plate key), so the query the server
 *        sees is exactly what the user chose. Loads log [search-map] with bbox
 *        SPANS + which criteria KEYS were used, never precise coordinates or
 *        values.
 *
 *        GEO (changed 2026-08-10): the distance filter is real now, so these
 *        calls also carry p_origin_lat/p_origin_lng/p_radius_m — see geoParams
 *        below for why the origin is the bbox centre and never a device fix.
 *        The radius travels as an RPC PARAMETER, never as a p_criteria key: the
 *        bag holds post attributes, and an origin is a frame of reference.
 * LINKS: supabase/migrations/20260810100000_search_filters_colours_body_year_
 *        distance.sql (the live RPCs + SAFETY notes);
 *        src/features/search-map/lib/searchCriteria.ts (the client→server
 *        mapping); src/features/search-map/api/feedApi.ts (shared post schema);
 *        docs/LOGGING.md.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { milesToMetres } from '@/shared/lib/distance';
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
 * The RPCs' geo parameters: the radius in metres, and the origin it is measured
 * from. ONE helper so the results query and the count query can never disagree
 * about the circle — a count that promises N while the map draws N-1 is worse
 * than either being wrong alone.
 *
 * The origin is the BBOX CENTRE — always derived from the very rectangle sent
 * alongside it, never passed in separately. That is deliberate on both counts:
 *   - PRIVACY: it is arithmetically REDUNDANT. The four corners already encode
 *     the centre, so this adds nothing the caller wasn't already sending. Note
 *     that on the feed path that centre IS the device fix (HomeFeedScreen
 *     frames the region around the device position) — the safety comes from the
 *     redundancy, not from the origin's provenance. Decoupling the origin from
 *     the bbox is what would make it a new disclosure.
 *   - CORRECTNESS: pinned to a stale device fix, panning to another city would
 *     exclude everything in view and the map would simply look broken.
 *
 * All three are null when no radius is set, so the server falls back to
 * bbox-only — exactly the behaviour before distance became a real filter.
 */
function geoParams(bbox: Bbox, criteria: SearchCriteria) {
  if (criteria.distanceMiles == null) {
    return { p_origin_lat: null, p_origin_lng: null, p_radius_m: null };
  }
  return {
    p_origin_lat: (bbox.minLat + bbox.maxLat) / 2,
    p_origin_lng: (bbox.minLng + bbox.maxLng) / 2,
    p_radius_m: Math.round(milesToMetres(criteria.distanceMiles)),
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
    ...geoParams(bbox, criteria),
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
    // PRESENCE and the user's own chosen band — never the origin coordinates.
    // The origin is a precise point and gets the same treatment as the bbox
    // corners above (docs/LOGGING.md).
    hasOrigin: criteria.distanceMiles != null,
    radiusMiles: criteria.distanceMiles,
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
    ...geoParams(bbox, criteria),
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
