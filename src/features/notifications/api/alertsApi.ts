/**
 * WHAT:  Read/write the caller's own alerts through the five SECURITY DEFINER
 *        RPCs — list, create, update, delete, set-enabled.
 * WHY:   One file owns every query so the RLS surface is auditable (house
 *        pattern: sightingApi, watchlistApi). There is deliberately NO table
 *        write grant on alert_zones — the ~1km snap has to be a server
 *        guarantee, so writes can only happen through these RPCs.
 *        // SAFETY: create/update return the STORED point, not the submitted
 *        one. Callers must render what came back: with `approximate` on it can
 *        be up to ~700m from where the user tapped, and showing them their
 *        real alert area is the honest version of the privacy promise.
 * LINKS: supabase/migrations/20260802150000_multi_alert.sql;
 *        ../hooks/useMyAlerts.ts (consumer); ../types.ts.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { metresToMiles, milesToMetres } from '@/shared/lib/distance';
import { createLogger, redactLocation } from '@/shared/lib/logger';

import type { Alert, AlertDraft } from '../types';

const log = createLogger('notifications');

/** The element shape every alert RPC returns. `.strict()` so a widened RPC
 *  fails loudly here — in one place — rather than leaking a new column into
 *  the UI unnoticed. */
const alertRowSchema = z
  .object({
    id: z.guid(),
    name: z.string(),
    lat: z.number(),
    lng: z.number(),
    radius_m: z.number().int(),
    enabled: z.boolean(),
    approximate: z.boolean(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    colour: z.string().nullable(),
    body_type: z.string().nullable(),
    min_bounty_pence: z.number().int().nullable(),
    recency_days: z.number().int().nullable(),
    updated_at: z.string(),
  })
  .strict();

type AlertRow = z.infer<typeof alertRowSchema>;

function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    name: row.name,
    latitude: row.lat,
    longitude: row.lng,
    // Stored in metres (the RPC's unit); the UI thinks in whole miles.
    radiusMiles: Math.round(metresToMiles(row.radius_m)),
    enabled: row.enabled,
    approximate: row.approximate,
    criteria: {
      make: row.make,
      model: row.model,
      colour: row.colour,
      bodyType: row.body_type,
      minBountyPence: row.min_bounty_pence,
      recencyDays: row.recency_days,
    },
    updatedAt: row.updated_at,
  };
}

/** The 12 criteria/location params shared by create and update. */
function toRpcParams(draft: AlertDraft) {
  return {
    p_name: draft.name.trim(),
    p_lat: draft.latitude,
    p_lng: draft.longitude,
    p_radius_m: milesToMetres(draft.radiusMiles),
    p_approximate: draft.approximate,
    p_enabled: draft.enabled,
    // null = "any". The RPCs also normalise '' → null, but sending null keeps
    // the intent obvious in the network log.
    p_make: draft.criteria.make,
    p_model: draft.criteria.model,
    p_colour: draft.criteria.colour,
    p_body_type: draft.criteria.bodyType,
    p_min_bounty_pence: draft.criteria.minBountyPence,
    p_recency_days: draft.criteria.recencyDays,
  };
}

/** Coarse origin only (2dp, ~1km) — the same redaction the feed uses. Criteria
 *  are owner-authored free text and are NOT logged. */
function logZoneWrite(event: string, alert: Alert): void {
  log.info(event, {
    radiusMiles: alert.radiusMiles,
    approximate: alert.approximate,
    enabled: alert.enabled,
    narrowed: Object.values(alert.criteria).some((value) => value !== null),
    origin: redactLocation(alert.latitude, alert.longitude),
  });
}

/** Every alert the caller owns, oldest first. Empty for a guest — not an error. */
export async function fetchMyAlerts(): Promise<Alert[]> {
  const { data, error } = await supabase.rpc('list_my_alerts');
  if (error) {
    log.warn('alerts_load_failed', { code: error.code });
    throw new Error(error.message);
  }
  return z.array(alertRowSchema).parse(data).map(toAlert);
}

/** Create one. Throws ALERT_LIMIT_REACHED past the cap — see MAX_ALERTS_PER_USER. */
export async function createAlert(draft: AlertDraft): Promise<Alert> {
  const { data, error } = await supabase.rpc('create_my_alert', toRpcParams(draft));
  if (error) {
    log.warn('alert_create_failed', { code: error.code });
    throw new Error(error.message);
  }
  const alert = toAlert(alertRowSchema.parse(data));
  logZoneWrite('alert_created', alert);
  return alert;
}

/** Replace one. Returns the STORED alert — see the header. */
export async function updateAlert(alertId: string, draft: AlertDraft): Promise<Alert> {
  const { data, error } = await supabase.rpc('update_my_alert', {
    p_alert_id: alertId,
    ...toRpcParams(draft),
  });
  if (error) {
    log.warn('alert_update_failed', { code: error.code });
    throw new Error(error.message);
  }
  const alert = toAlert(alertRowSchema.parse(data));
  logZoneWrite('alert_updated', alert);
  return alert;
}

export async function deleteAlert(alertId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_my_alert', { p_alert_id: alertId });
  if (error) {
    log.warn('alert_delete_failed', { code: error.code });
    throw new Error(error.message);
  }
  log.info('alert_deleted');
}

/** Pause or resume ONE alert. Takes no coordinates, so pausing never
 *  round-trips a location or risks re-storing it at a different precision. */
export async function setAlertEnabled(alertId: string, enabled: boolean): Promise<Alert> {
  const { data, error } = await supabase.rpc('set_my_alert_enabled', {
    p_alert_id: alertId,
    p_enabled: enabled,
  });
  if (error) {
    log.warn('alert_toggle_failed', { code: error.code });
    throw new Error(error.message);
  }
  log.info('alert_toggled', { enabled });
  return toAlert(alertRowSchema.parse(data));
}

/**
 * How many OTHER spotters an alert at this point and bounty would reach today.
 *
 * Drives the bounty slider's "reaches N spotters" line — the one honest
 * argument for a higher bounty, since a spotter's `min_bounty_pence` decides
 * whether a post reaches them at all.
 *
 * Returns 0 both for "nobody" and for "too few to report" — the RPC floors
 * small counts deliberately (they are the identifying ones, and it is also the
 * answer we would least want to hand a thief). Callers must treat 0 as RENDER
 * NOTHING, never as "0 spotters are watching".
 *
 * SAFETY: coordinates are the caller's own last-seen point, and the RPC snaps
 * them to the ~1km grid before use. Never logged here — the surrounding
 * wizard step already holds them and the network log should not.
 */
export async function fetchAlertReach(
  latitude: number,
  longitude: number,
  bountyPence: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('get_alert_reach', {
    p_lat: latitude,
    p_lng: longitude,
    p_bounty_pence: bountyPence,
  });
  if (error) {
    // Non-fatal by design: this is a supporting line under a slider, so a
    // failure hides it rather than interrupting someone posting a stolen car.
    log.warn('alert_reach_failed', { code: error.code });
    return 0;
  }
  return z.number().int().nonnegative().catch(0).parse(data);
}
