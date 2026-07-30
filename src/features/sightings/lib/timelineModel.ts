/**
 * WHAT:  Pure timeline maths — day-grouping of sightings into newest-first
 *        timeline items (both faces share it), the anchor nodes that fix the
 *        arc's ends (origin = the theft, terminal = recovered/expired/closed),
 *        the "and N earlier sightings" copy for the capped public view, and
 *        the owner-only movement hint ("Most recent sighting is 2.1 mi
 *        north-east of the first").
 * WHY:   NEWEST-FIRST, deliberately inverting story order: an owner acting
 *        on a live theft needs the most recent evidence first — history is
 *        context, not the point — and a would-be spotter reading the public
 *        face is judging whether the trail is still warm. Pure and
 *        hammerable without rendering (house precedent: messageGroups,
 *        collectionsModel). The movement hint is client-side arithmetic
 *        over coordinates the OWNER already holds — it must never be
 *        computed for, or shown to, any other face (the public payload
 *        carries no coordinates by construction, so it cannot be).
 * LINKS: src/features/sightings/components/SightingTimeline.tsx (renderer);
 *        src/features/sightings/types.ts (OwnerSighting, PublicSightingEntry);
 *        docs/decisions/ADR-0008-public-sighting-entries.md.
 */

import type { PostStatus } from '@/shared/types';

import type { OwnerSighting } from '../types';

/** One renderable timeline item: a day header or an entry of either face. */
export type TimelineItem<TEntry> =
  | { kind: 'day'; id: string; label: string }
  | { kind: 'entry'; entry: TEntry; newest: boolean };

// --- Anchor nodes (the arc's fixed ends) --------------------------------------

/** The slice of post data the anchors render from. PRIVACY: everything here
 *  is already IN the viewer's post-detail payload for their face (the server
 *  coarsens lastSeenArea for non-owners before it ever arrives) — anchors add
 *  NOTHING to any payload, they re-present what the page already shows. */
export interface TimelineAnchorSource {
  status: PostStatus;
  /** When the car was last seen (the theft moment); null on older posts. */
  lastSeenAt: string | null;
  /** Coarse area label, face-appropriate by construction. */
  lastSeenArea?: string;
  /** Fallback origin timestamp when lastSeenAt is unknown. */
  createdAt: string;
}

export interface TimelineOriginAnchor {
  label: string;
  /** "near Camden · Tue 03:00" — parts joined with the timeline's separator. */
  sublabel: string;
}

export interface TimelineTerminalAnchor {
  label: string;
  /** celebrate = the sanctioned sage payoff moment; quiet = archival end. */
  tone: 'celebrate' | 'quiet';
}

/** "Tue 03:00" / "Today · 03:00" grain for the origin sublabel. */
function anchorTime(iso: string, now: Date = new Date()): string {
  const clock = new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${timelineDayLabel(iso, now)} ${clock}`;
}

/** The fixed ORIGIN node — every post has one (the theft is why the timeline
 *  exists). lastSeenAt is the theft moment; absent, the report time stands in
 *  honestly (same "Reported stolen" label — it is when the report was made). */
export function originAnchor(
  source: TimelineAnchorSource,
  now: Date = new Date(),
): TimelineOriginAnchor {
  const parts: string[] = [];
  if (source.lastSeenArea) parts.push(`near ${source.lastSeenArea}`);
  parts.push(anchorTime(source.lastSeenAt ?? source.createdAt, now));
  return { label: 'Reported stolen', sublabel: parts.join(' · ') };
}

/** The TERMINAL node — only once the arc has actually ended. recovery_claimed
 *  is deliberately NOT terminal (the claim is still in flight); active and
 *  pre-active statuses return null. */
export function terminalAnchor(status: PostStatus): TimelineTerminalAnchor | null {
  switch (status) {
    case 'recovered':
    case 'recovered_no_spotter':
      return { label: 'Recovered 🎉', tone: 'celebrate' };
    case 'expired':
      return { label: 'Post expired', tone: 'quiet' };
    case 'cancelled':
      return { label: 'Post closed', tone: 'quiet' };
    default:
      return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today" / "Yesterday" / "Mon 6 Jul" — same grain as chat's day labels. */
export function timelineDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const dayDelta = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / DAY_MS);
  if (dayDelta === 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Group entries (any face) into newest-first items with day headers. The
 * caller supplies the timestamp accessor, so OwnerSighting and the public
 * entry shape share one grouping truth. The first ENTRY overall is flagged
 * `newest` — the rail renders its dot emphasised.
 */
export function buildTimelineItems<TEntry>(
  entries: TEntry[],
  timestampOf: (entry: TEntry) => string,
  now: Date = new Date(),
): TimelineItem<TEntry>[] {
  const descending = [...entries].sort(
    (a, b) => new Date(timestampOf(b)).getTime() - new Date(timestampOf(a)).getTime(),
  );

  const items: TimelineItem<TEntry>[] = [];
  let previousDay: string | null = null;
  let first = true;
  for (const entry of descending) {
    const date = new Date(timestampOf(entry));
    const day = `day-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (day !== previousDay) {
      items.push({ kind: 'day', id: day, label: timelineDayLabel(timestampOf(entry), now) });
      previousDay = day;
    }
    items.push({ kind: 'entry', entry, newest: first });
    first = false;
  }
  return items;
}

/** "…and 4 earlier sightings" — the capped public view's tail line. Null
 *  when nothing was cut (the line must not render as "…and 0 earlier"). */
export function earlierCountLabel(earlierCount: number): string | null {
  if (earlierCount <= 0) return null;
  return earlierCount === 1
    ? '…and 1 earlier sighting'
    : `…and ${earlierCount} earlier sightings`;
}

// --- Movement hint + trail (owner-only) ----------------------------------------

/** A located point pulled from a sighting's first GPS-bearing photo. */
interface LocatedPoint {
  lat: number;
  lng: number;
  createdAt: string;
}

/** One pin on the owner's sightings-trail map. */
export interface TrailPoint {
  sightingId: string;
  lat: number;
  lng: number;
  createdAt: string;
}

/**
 * The trail the owner's map draws: every LOCATED sighting, OLDEST-FIRST (a
 * path is walked forward in time, unlike the list). Un-located sightings
 * simply aren't on it — the caller says so honestly in copy. // SAFETY:
 * owner-face only by construction — these coordinates exist solely in the
 * owner's get_post_sightings payload (ADR-0008 keeps them from every other
 * face, so no other face could even call this).
 */
export function locatedTrail(sightings: OwnerSighting[]): TrailPoint[] {
  return sightings
    .flatMap((sighting) => {
      const photo = sighting.photos.find((p) => p.lat !== null && p.lng !== null);
      return photo
        ? [
            {
              sightingId: sighting.id,
              lat: photo.lat as number,
              lng: photo.lng as number,
              createdAt: sighting.createdAt,
            },
          ]
        : [];
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** Padding factor around the trail's bounding box, and the tightest zoom a
 *  one-point trail may reach (~a neighbourhood, not a doorstep). */
const REGION_PADDING = 1.5;
const MIN_DELTA = 0.02;

/** The map region that frames every trail point (and the origin, when it has
 *  coordinates), centred on the bounding box with breathing room. */
export function trailRegion(
  points: { lat: number; lng: number }[],
): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null {
  if (points.length === 0) return null;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * REGION_PADDING, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * REGION_PADDING, MIN_DELTA),
  };
}

function firstLocatedPoint(sighting: OwnerSighting): LocatedPoint | null {
  const photo = sighting.photos.find((p) => p.lat !== null && p.lng !== null);
  return photo
    ? { lat: photo.lat as number, lng: photo.lng as number, createdAt: sighting.createdAt }
    : null;
}

const EARTH_RADIUS_MI = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles (haversine). */
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

const WINDS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const;

/** Initial great-circle bearing from a to b, folded to an 8-wind name. */
export function windDirection(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): (typeof WINDS)[number] {
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return WINDS[Math.round(bearing / 45) % 8];
}

/**
 * The owner's movement hint: earliest located sighting → most recent located
 * sighting, as plain factual copy. Null when fewer than two sightings carry
 * a fix, or when the two points are effectively the same place (< 0.1 mi —
 * "0.0 mi north" is noise, not information).
 */
export function movementHint(sightings: OwnerSighting[]): string | null {
  const located = sightings
    .map(firstLocatedPoint)
    .filter((point): point is LocatedPoint => point !== null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (located.length < 2) return null;

  const first = located[0];
  const latest = located[located.length - 1];
  const miles = distanceMiles(first, latest);
  if (miles < 0.1) return null;

  return `Most recent sighting is ${miles.toFixed(1)} mi ${windDirection(first, latest)} of the first`;
}
