/**
 * WHAT:  Types owned by the notifications feature — a spotter's named alerts,
 *        the criteria that narrow them, the draft shape the wizard submits,
 *        and the bounds constants.
 * WHY:   One place ties the wizard, screens, hooks and API layer to the RPC
 *        contract; the bounds mirror the migration's CHECK constraints so
 *        client and server agree by construction (house pattern:
 *        chat/types.ts, sightings/types.ts).
 * LINKS: src/features/notifications/api/alertsApi.ts;
 *        supabase/migrations/20260802150000_multi_alert.sql;
 *        docs/DOMAIN.md (Notifications).
 */

/** Bounds — mirrored by `alert_zones_radius_chk` in the migration. DOMAIN.md
 *  fixes 1–50 miles for BOTH this and the Explore feed radius, so the numbers
 *  live in shared/lib/distance.ts and are re-exported here under the names
 *  this feature reads in. The metre values are the authoritative stored form. */
export { RADIUS_MIN_MILES as MIN_RADIUS_MILES, RADIUS_MAX_MILES as MAX_RADIUS_MILES } from '@/shared/lib/distance';

/**
 * The radius a new alert starts on. Near enough that a spotter could plausibly
 * walk or drive past the car, and tight enough that the 3-per-day budget is
 * spent on their own neighbourhood.
 *
 * DELIBERATELY SMALLER than the Explore feed's 20-mile default
 * (`FEED_RADIUS_DEFAULT_MILES`) — browsing a wide area is free, being
 * interrupted is not. The alert map also opens framed on this radius now, so a
 * large default would open on a view too coarse to recognise anywhere in.
 *
 * Lives here rather than in lib/alertFlow so alertSteps can read it: alertFlow
 * imports alertSteps, so the reverse would be a cycle.
 */
export const DEFAULT_ALERT_RADIUS_MILES = 5;

/** Max alert pushes per user per ROLLING 24 hours (not a midnight reset —
 *  same window semantics as the sighting rate limit). Overflow is dropped
 *  silently: the post stays visible in Explore and on the map regardless, so
 *  a dropped push loses nothing permanent. See README § "Volume".
 *
 *  PER USER, not per alert. Someone with five alerts that all match one post
 *  still gets exactly one push — `match_alert_zones` dedups on
 *  `push_sends(user_id, kind, subject_id)` and selects DISTINCT user_id. */
export const MAX_ALERTS_PER_DAY = 3;

/** How many alerts one account may hold. Mirrors `ALERT_LIMIT_REACHED` in the
 *  migration, and deliberately equals the garage's 5-vehicle cap so the app's
 *  limits read consistently. */
export const MAX_ALERTS_PER_USER = 5;

/** Longest an alert name may be — mirrors the column CHECK. */
export const MAX_ALERT_NAME_LENGTH = 80;

/**
 * What narrows an alert. EVERY field is optional and independent: null means
 * "any", so an all-null criteria object is "any car". Matched case-insensitively
 * server-side (`lower(btrim(...))`) because posts store whatever the owner
 * typed — see the 20260802160000 migration.
 */
export interface AlertCriteria {
  make: string | null;
  model: string | null;
  colour: string | null;
  bodyType: string | null;
  /** Only alert me when the bounty is at least this (integer pence). */
  minBountyPence: number | null;
  /** Only alert me when the car was last seen within this many days. NOTE this
   *  is `posts.last_seen_at`, not the post's age — a car last seen three weeks
   *  ago but posted today is genuinely less actionable. */
  recencyDays: number | null;
}

/** "Any car" — the default every new alert starts from. */
export const EMPTY_CRITERIA: AlertCriteria = {
  make: null,
  model: null,
  colour: null,
  bodyType: null,
  minBountyPence: null,
  recencyDays: null,
};

/**
 * What a spotter chose to narrow this alert by, picked on the wizard's first
 * screen. This is WIZARD SHAPE, not stored data — the server has no such
 * column; it only sees the resulting criteria. Deriving it back from an alert
 * (`matchersForCriteria`) is what lets editing re-open the same questions.
 *
 * `area` is always present and cannot be turned off: `alert_zones.point` and
 * `radius_m` are NOT NULL, because an alert a spotter cannot act on is noise.
 * It is shown as a locked card rather than hidden, so the list reads as the
 * complete set of things an alert can match.
 */
export type AlertMatcher = 'area' | 'car' | 'bounty';

/** The matcher every alert carries, whatever else is ticked. */
export const REQUIRED_MATCHERS: readonly AlertMatcher[] = ['area'];

/** One of the caller's alerts, as returned by `list_my_alerts`. */
export interface Alert {
  id: string;
  /** Owner-facing free text ("Home", "Blue BMWs near work"). Required. */
  name: string;
  /** The STORED centre — already snapped to the ~1km grid when `approximate`
   *  is true, so this is what the map should pin, not what the user tapped. */
  latitude: number;
  longitude: number;
  radiusMiles: number;
  /** Per-alert switch. A disabled alert is kept, not deleted — pausing must
   *  never cost someone the area they took the trouble to set. */
  enabled: boolean;
  /** SAFETY: when true the stored point was coarsened to the 0.01° (~1km)
   *  grid BEFORE insert, so the database never held the exact point. */
  approximate: boolean;
  criteria: AlertCriteria;
  updatedAt: string;
}

/**
 * The wizard's answers — flat, because every step edits its own slice and the
 * whole object is serialised into one RPC call at submit (house pattern:
 * PostACarAnswers). Assembled into an AlertDraft by the screen.
 */
export interface AlertAnswers {
  /** The point the user settled on. Required — every alert has a location. */
  location: { latitude: number; longitude: number } | null;
  /** SAFETY: default true. Collected on the location step, not its own. */
  approximate: boolean;
  radiusMiles: number;
  make: string | null;
  model: string | null;
  colour: string | null;
  bodyType: string | null;
  minBountyPence: number | null;
  recencyDays: number | null;
  name: string;
  /** Human place from the location step's geocode, used ONLY to seed the name
   *  suggestion. Never sent to the server — the alert stores a point. */
  placeLabel: string | null;
}

/** What the wizard submits to `create_my_alert` / `update_my_alert`. */
export interface AlertDraft {
  name: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  enabled: boolean;
  approximate: boolean;
  criteria: AlertCriteria;
}
