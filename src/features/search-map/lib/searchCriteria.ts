/**
 * WHAT:  The search-map SearchCriteria model + pure helpers: the empty/default
 *        criteria, the map to the server's `p_criteria` jsonb (dropping empties
 *        and full-range so "any" means no filter), a short human summary for the
 *        active-search pill, and value equality.
 * WHY:   Criteria are assembled on the client, counted live, then applied to the
 *        map — so the SHAPE and its server mapping must live in one pure, tested
 *        place (precedent: regionMath.ts, selectOptions.ts). Two safety rules are
 *        encoded here, not left to callers: `distanceMiles` NEVER crosses the
 *        wire (it only frames the initial bbox), and there is NO plate criterion
 *        at all (plate search is deferred; suggestions never enumerate plates).
 * LINKS: src/features/search-map/api/mapApi.ts (sends toRpcCriteria output);
 *        supabase/migrations/20260725100000_search_posts_rpc.sql (the RPC
 *        contract); src/shared/lib/money.ts (formatPounds).
 */

import { z } from 'zod';

import { formatPounds } from '@/shared/lib/money';

/** Bounty selectable universe (mirrors the posts.bounty_amount_pence CHECK). */
export const SEARCH_BOUNTY_MIN_PENCE = 5000;
export const SEARCH_BOUNTY_MAX_PENCE = 500000;

/** The whole multi-criteria query the search surface assembles. */
export interface SearchCriteria {
  /** Free text matched against make/model (never plate). RESERVED: the search
   *  RPC supports it, but the current UI has no text input, so it stays '' —
   *  make/model come from the pickers. Kept for when text search returns. */
  text: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  /** Bounty range in integer pence; equal to the bounds means "any". */
  bountyMinPence: number;
  bountyMaxPence: number;
  /** Only posts last seen within this many days; null = any time. */
  recencyDays: number | null;
  /** Initial map framing radius; null = "Any" (national). NEVER sent to the
   *  server — the bbox is the geo filter, this only frames the camera. */
  distanceMiles: number | null;
}

/** The server `p_criteria` shape — every key optional; absent = no filter. */
export interface RpcSearchCriteria {
  text?: string;
  make?: string;
  model?: string;
  colour?: string;
  bounty_min?: number;
  bounty_max?: number;
  recency_days?: number;
}

/** Runtime shape of SearchCriteria — used to validate a persisted recent or a
 *  criteria passed across a route param (fail-soft: bad input → null/empty). */
export const searchCriteriaSchema = z.object({
  text: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  colour: z.string().nullable(),
  // Bounds so a crafted deep-link param can't seed out-of-range values
  // (parse fails soft → the caller falls back to empty/unfiltered).
  bountyMinPence: z.number().int().min(SEARCH_BOUNTY_MIN_PENCE).max(SEARCH_BOUNTY_MAX_PENCE),
  bountyMaxPence: z.number().int().min(SEARCH_BOUNTY_MIN_PENCE).max(SEARCH_BOUNTY_MAX_PENCE),
  recencyDays: z.number().int().positive().nullable(),
  distanceMiles: z.number().positive().nullable(),
});

/** Parse a JSON criteria route param → SearchCriteria, or null when
 *  absent/corrupt (the caller then falls back to empty/unfiltered). */
export function parseCriteria(raw: string | undefined | null): SearchCriteria | null {
  if (!raw) {
    return null;
  }
  try {
    return searchCriteriaSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A fresh, all-defaults criteria object (nothing filtered). */
export function emptyCriteria(): SearchCriteria {
  return {
    text: '',
    make: null,
    model: null,
    colour: null,
    bountyMinPence: SEARCH_BOUNTY_MIN_PENCE,
    bountyMaxPence: SEARCH_BOUNTY_MAX_PENCE,
    recencyDays: null,
    distanceMiles: null,
  };
}

/** True when nothing is filtered — drives the pill's placeholder vs summary. */
export function isEmptyCriteria(criteria: SearchCriteria): boolean {
  return (
    criteria.text.trim() === '' &&
    criteria.make === null &&
    criteria.model === null &&
    criteria.colour === null &&
    criteria.bountyMinPence <= SEARCH_BOUNTY_MIN_PENCE &&
    criteria.bountyMaxPence >= SEARCH_BOUNTY_MAX_PENCE &&
    criteria.recencyDays === null
  );
}

/**
 * Map criteria to the server's `p_criteria`, OMITTING anything at its default
 * (a blank term, an unset facet, a full-range bound) so the RPC only ever
 * filters on what the user actually chose — and NEVER emitting `plate` or
 * `distanceMiles`.
 */
export function toRpcCriteria(criteria: SearchCriteria): RpcSearchCriteria {
  const rpc: RpcSearchCriteria = {};
  const text = criteria.text.trim();
  if (text) {
    rpc.text = text;
  }
  if (criteria.make) {
    rpc.make = criteria.make;
  }
  if (criteria.model) {
    rpc.model = criteria.model;
  }
  if (criteria.colour) {
    rpc.colour = criteria.colour;
  }
  // Only send a bound when it actually narrows the range.
  if (criteria.bountyMinPence > SEARCH_BOUNTY_MIN_PENCE) {
    rpc.bounty_min = criteria.bountyMinPence;
  }
  if (criteria.bountyMaxPence < SEARCH_BOUNTY_MAX_PENCE) {
    rpc.bounty_max = criteria.bountyMaxPence;
  }
  if (criteria.recencyDays !== null) {
    rpc.recency_days = criteria.recencyDays;
  }
  return rpc;
}

/** Whole-pounds bounty fragment for the summary ("£500+", "up to £1,000",
 *  "£500–£1,000"), or null when the range is unfiltered. */
function bountySummary(criteria: SearchCriteria): string | null {
  const min = criteria.bountyMinPence > SEARCH_BOUNTY_MIN_PENCE ? criteria.bountyMinPence : null;
  const max = criteria.bountyMaxPence < SEARCH_BOUNTY_MAX_PENCE ? criteria.bountyMaxPence : null;
  if (min !== null && max !== null) {
    return `${formatPounds(min)}–${formatPounds(max)}`;
  }
  if (min !== null) {
    return `${formatPounds(min)}+`;
  }
  if (max !== null) {
    return `up to ${formatPounds(max)}`;
  }
  return null;
}

/**
 * A short, human summary for the active-search pill, e.g.
 * "Blue BMW · £500+ · 10mi". Empty criteria summarise to '' (the pill then
 * shows its placeholder).
 */
export function summarise(criteria: SearchCriteria): string {
  const segments: string[] = [];

  // One "vehicle" descriptor: colour make model, falling back to the free text
  // when no facet was picked.
  const vehicle = [criteria.colour, criteria.make, criteria.model].filter(Boolean).join(' ');
  if (vehicle) {
    segments.push(vehicle);
  } else if (criteria.text.trim()) {
    segments.push(criteria.text.trim());
  }

  const bounty = bountySummary(criteria);
  if (bounty) {
    segments.push(bounty);
  }
  if (criteria.recencyDays !== null) {
    segments.push(`${criteria.recencyDays}d`);
  }
  if (criteria.distanceMiles !== null) {
    segments.push(`${criteria.distanceMiles}mi`);
  }

  return segments.join(' · ');
}
