/**
 * WHAT:  The search-map SearchCriteria model + pure helpers: the empty/default
 *        criteria, the map to the server's `p_criteria` jsonb (dropping empties
 *        and full-range so "any" means no filter), a short human summary for the
 *        active-search pill, and value equality.
 * WHY:   Criteria are assembled on the client, counted live, then applied to the
 *        map — so the SHAPE and its server mapping must live in one pure, tested
 *        place (precedent: regionMath.ts, selectOptions.ts).
 *
 *        ONE SAFETY RULE is encoded here rather than left to callers: there is
 *        NO plate criterion at all, and RPC_CRITERIA_KEYS makes that structural
 *        rather than a promise repeated in each test. A plate filter would let
 *        an anonymous caller confirm a specific plate is listed
 *        (SECURITY_AND_TRUST §1, identity minimisation).
 *
 *        ⚠️ CHANGED 2026-08-10: `distanceMiles` used to be documented here as
 *        "NEVER crosses the wire — it only frames the camera". It now DOES
 *        cross, as the RPC parameters p_origin_lat/p_origin_lng/p_radius_m
 *        (never as a p_criteria key — it is a frame of reference, not a post
 *        attribute). Both constraints apply: the bbox frames, the radius
 *        narrows. `colour` also became `colours`, a multi-select.
 * LINKS: src/features/search-map/api/mapApi.ts (sends toRpcCriteria output);
 *        supabase/migrations/20260810100000_search_filters_colours_body_year_
 *        distance.sql (the live RPC contract); src/shared/lib/money.ts.
 */

import { z } from 'zod';

import { formatDateLabelCompact } from '@/shared/lib/dateTimeLabel';
import { RADIUS_MAX_MILES, RADIUS_MIN_MILES } from '@/shared/lib/distance';
import { MAX_BOUNTY_PENCE, MIN_BOUNTY_PENCE } from '@/features/vehicles/post/lib/bountyBounds';
import { formatPounds } from '@/shared/lib/money';

/**
 * Bounty selectable universe — RE-EXPORTED from the one mirror rather than
 * restated. The floor doubles as the "any bounty" position, which only works
 * while it equals the post floor: at 5000 against a £10 post floor (which is
 * what this said until 2026-08-22) a search for "any" silently excluded every
 * £10–£49 listing, and the filter chip still read "Any".
 */
// Aliased consts rather than `export { X as Y } from …`: a re-export creates no
// LOCAL binding, and this module uses both names in its own body.
export const SEARCH_BOUNTY_MIN_PENCE = MIN_BOUNTY_PENCE;
export const SEARCH_BOUNTY_MAX_PENCE = MAX_BOUNTY_PENCE;

/** Year bounds MIRROR posts_year_range_chk (20260713140000_post_detail.sql), the
 *  same way the bounty bounds mirror their CHECK. This is only the "a crafted
 *  deep link can't seed nonsense" floor/ceiling — the PICKER's ceiling is the
 *  current year. Deliberately not derived from the clock: a schema built at
 *  module load would go stale on 1 January. */
export const SEARCH_YEAR_MIN = 1900;
export const SEARCH_YEAR_MAX = 2100;

/** Cap on a multi-select facet. The whole vocabulary is 15 colours / 9 body
 *  types, so anything longer is a crafted param rather than a user. Mirrored
 *  server-side in the migration. */
export const SEARCH_MAX_FACET_VALUES = 32;

/** The whole multi-criteria query the search surface assembles. */
export interface SearchCriteria {
  /** Free text matched against make/model — NEVER plate (see the file header). */
  text: string;
  make: string | null;
  model: string | null;
  /** MULTI-select canonical CAR_COLOURS names; [] = any. Renamed from `colour`
   *  deliberately: the rename turns every stale call site into a compile error
   *  rather than a silently single-valued filter. */
  colours: string[];
  /** MULTI-select canonical BODY_TYPE_OPTIONS values; [] = any. Never contains
   *  BODY_TYPE_UNKNOWN — filtering on "Not sure" would find only the owners who
   *  shrugged, which is not a body type. */
  bodyTypes: string[];
  /** Bounty range in integer pence; equal to the bounds means "any". */
  bountyMinPence: number;
  bountyMaxPence: number;
  /** Inclusive model-year bounds; null = open-ended on that side. */
  yearFrom: number | null;
  yearTo: number | null;
  /** Only posts last seen within this many days; null = any time.
   *  Mutually exclusive with seenFrom/seenTo — see setWhen in
   *  useSearchCriteria.ts, which owns that rule so no call site can forget it. */
  recencyDays: number | null;
  /**
   * An ABSOLUTE last-seen window, as the user picked it: each is the START of
   * the chosen LOCAL day, held as an ISO instant. null = unbounded that side.
   *
   * Stored as the picked day rather than as the wire value, so `formatDateLabel`
   * renders exactly the date the user chose. `toRpcCriteria` does the half-open
   * conversion on the way out (see exclusiveEndIso).
   *
   * ISO STRINGS, never Date objects: JSON.stringify turns a Date into an ISO
   * string but JSON.parse does not turn it back, so a Date-typed field would
   * arrive at the map screen as a string and every .getTime() on it would throw.
   * This also matches DateTimeField's existing `value` contract.
   */
  seenFrom: string | null;
  seenTo: string | null;
  /** Radius in miles from the MAP CENTRE; null = no radius (bbox only).
   *  Sizes the bbox AND is sent as p_radius_m — see the file header. */
  distanceMiles: number | null;
}

/**
 * The ONLY keys that may ever appear in `p_criteria`.
 *
 * Exported so the privacy guarantee is a STRUCTURE rather than an assertion
 * repeated per test: 'plate' is absent, and a test asserts every emitted key is
 * a member — so adding a criterion cannot quietly widen the surface.
 *
 * `distance_miles` is deliberately absent too: the radius travels as the RPC
 * parameter p_radius_m alongside its origin, never as a post attribute.
 */
export const RPC_CRITERIA_KEYS = [
  'text',
  'make',
  'model',
  'colours',
  'body_types',
  'bounty_min',
  'bounty_max',
  'year_min',
  'year_max',
  'recency_days',
  'seen_from',
  'seen_to',
] as const;

/** The server `p_criteria` shape — every key optional; absent = no filter. */
export interface RpcSearchCriteria {
  text?: string;
  make?: string;
  model?: string;
  colours?: string[];
  body_types?: string[];
  bounty_min?: number;
  bounty_max?: number;
  year_min?: number;
  year_max?: number;
  recency_days?: number;
  /** Inclusive lower bound (ISO instant). */
  seen_from?: string;
  /** EXCLUSIVE upper bound (ISO instant) — the start of the day AFTER the one
   *  the user picked. See exclusiveEndIso for why. */
  seen_to?: string;
}

/**
 * The start of the LOCAL day containing `date`, as an ISO instant.
 *
 * Local, not UTC: the user picks a calendar day on their phone, and the column
 * is timestamptz. Sending a bare date string (or a UTC midnight) would make
 * "10 May" mean a different window depending on where the phone is — and in
 * the UK, an hour of BST would fall on the wrong side of the boundary.
 */
export function startOfLocalDayIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

/**
 * The EXCLUSIVE upper bound for a picked end date: the start of the following
 * local day.
 *
 * This is the whole reason `seen_to` is half-open on the server. `last_seen_at`
 * is a TIMESTAMP and the user picks a DATE, so an inclusive `<= 10 May` really
 * means `<= 10 May 00:00` and silently drops a car last seen at 14:00 that day
 * — the filter quietly excludes the very day that was asked for, and the only
 * symptom is a few missing results nobody thinks to question.
 *
 * Day arithmetic via the Date constructor, NOT `+ 86_400_000`: across a DST
 * boundary a day is not always 24 hours, and the clocks change twice a year in
 * the UK.
 */
export function exclusiveEndIso(iso: string): string {
  const picked = new Date(iso);
  return new Date(picked.getFullYear(), picked.getMonth(), picked.getDate() + 1).toISOString();
}

/**
 * Tolerate shapes an OLDER bundle could have serialised into the route param.
 *
 * Only shapes we KNOW how to read are rescued; anything else still fails to
 * null and the caller falls back to unfiltered. Without this, a replayed param
 * (expo-router state restoration, a dev-client reload) would silently discard
 * the user's whole search rather than just the one field that moved.
 *   v1 (pre-2026-08-10): `colour: string | null`, no bodyTypes/year.
 * Zod strips unknown keys, so the stale `colour` needs no deletion.
 */
function migrateLegacyCriteria(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) {
    return raw;
  }
  const value = { ...(raw as Record<string, unknown>) };
  if (!('colours' in value) && 'colour' in value) {
    value.colours = typeof value.colour === 'string' ? [value.colour] : [];
  }
  return value;
}

/** Runtime shape of SearchCriteria — used to validate a persisted recent or a
 *  criteria passed across a route param (fail-soft: bad input → null/empty). */
export const searchCriteriaSchema = z.preprocess(
  migrateLegacyCriteria,
  z.object({
    text: z.string(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    // .default([]) so a param written before the field existed still parses;
    // .max(40) mirrors posts_body_type_len_chk.
    colours: z.array(z.string().min(1).max(40)).max(SEARCH_MAX_FACET_VALUES).default([]),
    bodyTypes: z.array(z.string().min(1).max(40)).max(SEARCH_MAX_FACET_VALUES).default([]),
    // Bounds so a crafted deep-link param can't seed out-of-range values
    // (parse fails soft → the caller falls back to empty/unfiltered).
    bountyMinPence: z.number().int().min(SEARCH_BOUNTY_MIN_PENCE).max(SEARCH_BOUNTY_MAX_PENCE),
    bountyMaxPence: z.number().int().min(SEARCH_BOUNTY_MIN_PENCE).max(SEARCH_BOUNTY_MAX_PENCE),
    yearFrom: z.number().int().min(SEARCH_YEAR_MIN).max(SEARCH_YEAR_MAX).nullable().default(null),
    yearTo: z.number().int().min(SEARCH_YEAR_MIN).max(SEARCH_YEAR_MAX).nullable().default(null),
    recencyDays: z.number().int().positive().nullable(),
    // .default(null) so a param written before the range existed still parses.
    // A malformed date fails the whole parse, which drops to emptyCriteria() —
    // the same fail-soft contract every other field here has.
    seenFrom: z.string().datetime().nullable().default(null),
    seenTo: z.string().datetime().nullable().default(null),
    // Bounded to the SAME 1–50 the server clamps and RadiusSlider offers.
    distanceMiles: z.number().min(RADIUS_MIN_MILES).max(RADIUS_MAX_MILES).nullable(),
  })
  // The relative/absolute exclusion belongs to the MODEL, not just to setWhen.
  // Every in-sheet path goes through that setter, but a route param does not:
  // parseCriteria accepts whatever was serialised, and a replayed or
  // hand-edited param carrying BOTH a recencyDays and a date range would be
  // searched with both ANDed server-side — while the chip row shows no preset
  // selected and the summary shows only the range. An active, invisible filter.
  // Dates win: they are the more specific answer to the same question.
  .transform((criteria) =>
    criteria.seenFrom !== null || criteria.seenTo !== null
      ? { ...criteria, recencyDays: null }
      : criteria,
  ),
);

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
    colours: [],
    bodyTypes: [],
    bountyMinPence: SEARCH_BOUNTY_MIN_PENCE,
    bountyMaxPence: SEARCH_BOUNTY_MAX_PENCE,
    yearFrom: null,
    yearTo: null,
    recencyDays: null,
    seenFrom: null,
    seenTo: null,
    distanceMiles: null,
  };
}

/** True when nothing is filtered — drives the pill's placeholder vs summary. */
export function isEmptyCriteria(criteria: SearchCriteria): boolean {
  return (
    criteria.text.trim() === '' &&
    criteria.make === null &&
    criteria.model === null &&
    criteria.colours.length === 0 &&
    criteria.bodyTypes.length === 0 &&
    criteria.bountyMinPence <= SEARCH_BOUNTY_MIN_PENCE &&
    criteria.bountyMaxPence >= SEARCH_BOUNTY_MAX_PENCE &&
    criteria.yearFrom === null &&
    criteria.yearTo === null &&
    criteria.recencyDays === null &&
    criteria.seenFrom === null &&
    criteria.seenTo === null &&
    // ⚠️ CHANGED 2026-08-10: distance USED to be excluded here, because back
    // then it only framed the camera and filtered nothing. It now narrows the
    // result set, so a search with only a radius set is NOT an empty search —
    // the pill must show it and offer the × to undo it.
    criteria.distanceMiles === null
  );
}

/**
 * Map criteria to the server's `p_criteria`, OMITTING anything at its default
 * (a blank term, an unset facet, a full-range bound) so the RPC only ever
 * filters on what the user actually chose — and never emitting a key outside
 * RPC_CRITERIA_KEYS.
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
  // An empty array means "any", so it is OMITTED rather than sent as []. The
  // server reads [] as "any" too, but sending it would put a meaningless key in
  // the criteriaKeys log line and in the live-count cache key.
  if (criteria.colours.length > 0) {
    rpc.colours = criteria.colours;
  }
  if (criteria.bodyTypes.length > 0) {
    rpc.body_types = criteria.bodyTypes;
  }
  // Only send a bound when it actually narrows the range.
  if (criteria.bountyMinPence > SEARCH_BOUNTY_MIN_PENCE) {
    rpc.bounty_min = criteria.bountyMinPence;
  }
  if (criteria.bountyMaxPence < SEARCH_BOUNTY_MAX_PENCE) {
    rpc.bounty_max = criteria.bountyMaxPence;
  }
  if (criteria.yearFrom !== null) {
    rpc.year_min = criteria.yearFrom;
  }
  if (criteria.yearTo !== null) {
    rpc.year_max = criteria.yearTo;
  }
  if (criteria.recencyDays !== null) {
    rpc.recency_days = criteria.recencyDays;
  }
  if (criteria.seenFrom !== null) {
    rpc.seen_from = criteria.seenFrom;
  }
  if (criteria.seenTo !== null) {
    // HALF-OPEN on the wire: the model holds the day the user picked, the
    // server gets the start of the day after it. See exclusiveEndIso.
    rpc.seen_to = exclusiveEndIso(criteria.seenTo);
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

/** 1–2 values verbatim, 3+ collapsed to a count — the pill is one line. */
function listSummary(values: string[], noun: string): string | null {
  if (values.length === 0) {
    return null;
  }
  if (values.length <= 2) {
    return values.join(', ');
  }
  return `${values.length} ${noun}`;
}

/**
 * "1 May 2026 – 10 May 2026" / "from 1 May 2026" / "until 10 May 2026", or null
 * when no absolute window is set. Same shape as yearSummary below.
 *
 * Through formatDateLabel, never hand-rolled — and it only ever sees values that
 * came through searchCriteriaSchema, because it THROWS on unparseable input.
 */
export function seenRangeSummary(criteria: SearchCriteria, now: Date = new Date()): string | null {
  // Drops the YEAR for dates in the current year: "11 Jul – 2 Aug" rather than
  // "11 Jul 2026 – 2 Aug 2026". The map pill is one line beside a back button
  // and a locate button, and the full form truncated to "…2 Au…" there.
  // Shared with DateTimeField's date mode, which had the same problem in a
  // half-width field — one rule, so the sheet and the pill cannot disagree.
  const compact = (iso: string) => formatDateLabelCompact(iso, now);

  const { seenFrom, seenTo } = criteria;
  if (seenFrom !== null && seenTo !== null) {
    return seenFrom === seenTo ? compact(seenFrom) : `${compact(seenFrom)} – ${compact(seenTo)}`;
  }
  if (seenFrom !== null) {
    return `from ${compact(seenFrom)}`;
  }
  if (seenTo !== null) {
    return `until ${compact(seenTo)}`;
  }
  return null;
}

/** "2018–2022" / "2018+" / "up to 2022", or null when unbounded. */
function yearSummary(criteria: SearchCriteria): string | null {
  const { yearFrom, yearTo } = criteria;
  if (yearFrom !== null && yearTo !== null) {
    return yearFrom === yearTo ? `${yearFrom}` : `${yearFrom}–${yearTo}`;
  }
  if (yearFrom !== null) {
    return `${yearFrom}+`;
  }
  if (yearTo !== null) {
    return `up to ${yearTo}`;
  }
  return null;
}

/**
 * "within 10 miles of this area."
 *
 * ALWAYS "this area", never "of you" — the radius is measured from the BBOX
 * CENTRE (mapApi.geoParams), and on the map that centre follows every pan. An
 * earlier version said "of you" whenever the app held a device fix, but holding
 * a fix does not mean the map is still centred on it: after panning to another
 * city the sheet claimed a proximity to the user while the server filtered
 * around somewhere else entirely. Describing the frame of reference honestly
 * beats a warmer sentence that is sometimes false.
 */
export function distanceLabel(miles: number): string {
  const unit = miles === 1 ? 'mile' : 'miles';
  return `within ${miles} ${unit} of this area`;
}

/**
 * A short, human summary for the active-search pill, e.g.
 * "Blue BMW · £500+ · 10mi". Empty criteria summarise to '' (the pill then
 * shows its placeholder).
 */
export function summarise(criteria: SearchCriteria): string {
  const segments: string[] = [];

  // One "vehicle" descriptor: colours make model, falling back to the free text
  // when no facet was picked.
  const vehicle = [listSummary(criteria.colours, 'colours'), criteria.make, criteria.model]
    .filter(Boolean)
    .join(' ');
  if (vehicle) {
    segments.push(vehicle);
  } else if (criteria.text.trim()) {
    segments.push(criteria.text.trim());
  }

  const bodies = listSummary(criteria.bodyTypes, 'body types');
  if (bodies) {
    segments.push(bodies);
  }
  const years = yearSummary(criteria);
  if (years) {
    segments.push(years);
  }
  const bounty = bountySummary(criteria);
  if (bounty) {
    segments.push(bounty);
  }
  if (criteria.recencyDays !== null) {
    segments.push(`${criteria.recencyDays}d`);
  }
  const seen = seenRangeSummary(criteria);
  if (seen) {
    segments.push(seen);
  }
  if (criteria.distanceMiles !== null) {
    segments.push(`${criteria.distanceMiles}mi`);
  }

  return segments.join(' · ');
}
