/**
 * WHAT:  fetchAreaInsights — the one read behind the area-insights screen.
 *        Calls get_area_insights and validates its payload.
 * WHY:   Every figure is aggregated SERVER-SIDE and arrives as a number, so this
 *        file receives COUNTS and never rows: no listing, no coordinate, no
 *        owner. That is the RPC's whole security posture — it was rewritten
 *        three times to get there — and this schema is where it is held on our
 *        side.
 *
 *        ⚠️ `enough_data: false` IS A REAL ANSWER, NOT AN ERROR. Below the floor
 *        of five non-owned listings the RPC returns no breakdown at all — not
 *        even zeroed buckets, because a zeroed row still tells a prober which
 *        buckets exist. The client must render "not enough nearby" and never a
 *        page of zeros. A handful of listings in a small radius is exactly where
 *        a bucket stops being a statistic and starts describing one car.
 * LINKS: supabase/migrations/20260811160000_area_insights_bucket_floor_owner.sql
 *          (the live version — read its header before touching this);
 *        supabase/migrations/20260811150000_area_insights_quantised.sql (the
 *          anti-trilateration corrections, and the known residual);
 *        src/features/vehicles/api/postStatsApi.ts (the counts-only pattern).
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('search-map');

const count = z.number().int().nonnegative();

const insufficientSchema = z.object({
  enough_data: z.literal(false),
  radius_m: count,
  total: count,
});

const fullSchema = z.object({
  enough_data: z.literal(true),
  radius_m: count,
  total: count,
  total_7d: count,
  total_30d: count,
  total_90d: count,
  total_365d: count,
  monthly: z.array(z.object({ month: z.string(), count })),
  top_makes: z.array(z.object({ make: z.string(), count })),
  top_models: z.array(z.object({ make: z.string(), model: z.string(), count })),
  recovered: count,
  closed_total: count,
  taken_from: z.object({
    driveway: count,
    street: count,
    car_park: count,
    other: count,
    recorded: count,
  }),
  keys_taken: z.object({ yes: count, no: count, unknown: count, recorded: count }),
});

const payloadSchema = z.union([fullSchema, insufficientSchema]);

export interface AreaInsightsBucket {
  key: string;
  label: string;
  count: number;
}

export type AreaInsights =
  | { enoughData: false; radiusM: number }
  | {
      enoughData: true;
      radiusM: number;
      total: number;
      total7d: number;
      total30d: number;
      total90d: number;
      total365d: number;
      /** Dense: every month present, zeros included. Oldest first. */
      monthly: { month: string; count: number }[];
      topMakes: { make: string; count: number }[];
      topModels: { make: string; model: string; count: number }[];
      recovered: number;
      closedTotal: number;
      /** ⚠️ `recorded` is the DENOMINATOR and must be rendered with the buckets:
       *  it is the number of listings actually represented below, not the count
       *  that filled the field in. Never show a bucket without it. */
      takenFrom: { buckets: AreaInsightsBucket[]; recorded: number };
      keysTaken: { buckets: AreaInsightsBucket[]; recorded: number };
    };

const TAKEN_FROM_LABELS: Record<string, string> = {
  driveway: 'From a driveway',
  street: 'From the street',
  car_park: 'From a car park',
  other: 'Somewhere else',
};

const KEYS_TAKEN_LABELS: Record<string, string> = {
  yes: 'Keys taken',
  no: 'Keys not taken',
  unknown: 'Not sure',
};

/**
 * Thefts reported near a point. Returns `enoughData: false` on any failure as
 * well as on a genuinely quiet area — the screen renders the same calm state
 * either way, which is the right answer for a supporting page that cannot be
 * computed.
 */
export async function fetchAreaInsights(
  latitude: number,
  longitude: number,
  radiusM: number,
): Promise<AreaInsights> {
  const { data, error } = await supabase.rpc('get_area_insights', {
    p_lat: latitude,
    p_lng: longitude,
    p_radius_m: radiusM,
  });

  if (error) {
    log.warn('area_insights_failed', { code: error.code });
    return { enoughData: false, radiusM };
  }

  const parsed = payloadSchema.safeParse(data);
  if (!parsed.success) {
    log.warn('area_insights_parse_failed');
    return { enoughData: false, radiusM };
  }
  if (!parsed.data.enough_data) {
    return { enoughData: false, radiusM: parsed.data.radius_m };
  }

  const row = parsed.data;
  const bucketsFrom = (
    source: Record<string, number>,
    labels: Record<string, string>,
  ): AreaInsightsBucket[] =>
    Object.entries(labels)
      // A bucket the server suppressed comes back as 0 — dropping it here is
      // right: a zeroed row still says the bucket exists, which is what the
      // floor was applied to hide.
      .filter(([key]) => (source[key] ?? 0) > 0)
      .map(([key, label]) => ({ key, label, count: source[key] ?? 0 }))
      .sort((a, b) => b.count - a.count);

  return {
    enoughData: true,
    radiusM: row.radius_m,
    total: row.total,
    total7d: row.total_7d,
    total30d: row.total_30d,
    total90d: row.total_90d,
    total365d: row.total_365d,
    monthly: row.monthly,
    topMakes: row.top_makes,
    topModels: row.top_models,
    recovered: row.recovered,
    closedTotal: row.closed_total,
    takenFrom: {
      buckets: bucketsFrom(row.taken_from, TAKEN_FROM_LABELS),
      recorded: row.taken_from.recorded,
    },
    keysTaken: {
      buckets: bucketsFrom(row.keys_taken, KEYS_TAKEN_LABELS),
      recorded: row.keys_taken.recorded,
    },
  };
}
