/**
 * WHAT:  What the search map draws: the posts inside the current viewport,
 *        each carrying its own £ pill, ranked by bounty for paint order.
 * WHY:   Two jobs that must stay together, because both need the same thing —
 *        the exact set of posts about to be drawn:
 *          1. CULLING to the viewport. `result.posts` only refreshes when a
 *             search LANDS, which is ~600ms behind the gesture, so without this
 *             a pan would keep drawing markers that are no longer on screen.
 *          2. RANKING. Paint order and the assistive-tech cap need a total
 *             order over the exact population being drawn, so neither can be
 *             decided per-marker inside the renderer.
 *
 *        Was mapClustering.ts (a supercluster wrapper) until 2026-08-06, when
 *        clustering was removed on the owner's call. The price-less second
 *        tier that replaced it went on 2026-08-07 for the same reason a cluster
 *        bubble did: a marker that does not show its own price is read as
 *        several cars. Kept pure so it stays unit-testable without a map view.
 * LINKS: src/features/search-map/types.ts (MapPinItem);
 *        src/features/search-map/components/MapPins.tsx (the dumb renderer);
 *        src/features/search-map/lib/regionMath.ts (regionToBbox).
 */

import type { GeoCoord, GeoRegion } from '@/shared/types';

import type { MapPinItem, MapPost } from '../types';
import { distanceMeters, regionToBbox } from './regionMath';

/**
 * How many markers stay in the ASSISTIVE-TECH tree, by bounty rank.
 *
 * Every marker is drawn and every marker is tappable; this caps only how many
 * a screen reader stops on. Without a cap that is up to VIEWPORT_POST_LIMIT
 * (100) swipes to get past the map, and the sheet below lists every car with
 * more detail and a live count — it is the intended path, not a consolation.
 *
 * ⚠️ This makes the DRAWN set and the REACHABLE set differ, which they did not
 * when the cap also decided appearance. Deliberate; see MapPins' call site.
 */
export const AT_MARKER_LIMIT = 12;

/**
 * The markers to draw for `region`: every post inside it, ranked by bounty.
 *
 * EVERY post gets the same £ pill. `rank` no longer picks an appearance — it
 * decides paint order and the assistive-tech cap, both of which still need a
 * total order over the exact population being drawn, which is why they are
 * decided here rather than per-marker in the renderer.
 *
 * The tie-break on id is not decoration: the server's ordering varies between
 * searches, so an unstable sort would make markers swap paint order on
 * identical data as the user pans — and under heavy overlap paint order is what
 * decides which marker a tap hits. Same rule, same reason, as the screen's
 * `sortedPosts`.
 */
export function pinsForRegion(posts: MapPost[], region: GeoRegion): MapPinItem[] {
  const bbox = regionToBbox(region);
  const inView = posts.filter(
    (post) =>
      post.latitude >= bbox.minLat &&
      post.latitude <= bbox.maxLat &&
      post.longitude >= bbox.minLng &&
      post.longitude <= bbox.maxLng,
  );

  const rankById = new Map(
    [...inView]
      .sort((a, b) => b.bountyPence - a.bountyPence || a.id.localeCompare(b.id))
      .map((post, index) => [post.id, index] as const),
  );

  return inView.map(
    (post): MapPinItem => ({
      type: 'post',
      key: post.id,
      post,
      rank: rankById.get(post.id) ?? 0,
    }),
  );
}

/**
 * How far apart two markers must sit, in points, before they read as two.
 *
 * Deliberately well BELOW a pill's ~72pt width. Demanding full clearance would
 * fan a group of five onto a ring ~64pt in radius — around 1.9km of
 * displacement at a 19km view, a far bigger lie than the overlap it fixes. At
 * 34 they STAGGER: you can see there are three pills and hit each one, which is
 * how the reference looks (docs/design-refs/map/ shot 2 has four pills piled on
 * each other). Overlapping pills stay readable; it was overlapping identical
 * DOTS that merged into a featureless blob.
 */
const MARKER_SEPARATION_DP = 34;

/** Metres per degree of latitude. Longitude shrinks by cos(lat). */
const METRES_PER_DEGREE_LAT = 111_320;

/**
 * Spread markers that would otherwise land on top of each other into a small
 * ring around their shared centre, so each one is separately visible and
 * tappable.
 *
 * WHY: this is what clustering used to hide, and clustering was removed on the
 * owner's call (2026-08-06). Cars a few hundred metres apart draw a few points
 * apart at any view wide enough to be useful, so they stack and only the
 * topmost is tappable. Observed on device at Hatfield, 2026-08-07: four pins
 * within a few hundred metres drew as one mark with the ones behind showing
 * as thin crescents of their own edge.
 *
 * ⚠️ THIS DRAWS A MARKER AWAY FROM ITS CAR. That is the accepted cost of the
 * owner's "no grouping, every marker standalone" call: the alternative at this
 * zoom is showing one marker for four cars. The displacement is bounded by the
 * ring radius (a small multiple of MARKER_SEPARATION_DP, so it shrinks to
 * nothing as you zoom in and the group dissolves), it only ever applies to
 * markers that ALREADY could not be told apart, and it touches the `draw`
 * coordinate ONLY — post.latitude/longitude stay exact for the card, the sort,
 * the sighting wizard and every RPC.
 *
 * Deterministic: groups are formed in the array's existing (id-tie-broken)
 * order and members are placed by index, so the same input always produces the
 * same layout and markers never jitter between renders.
 */
export function fanOutOverlaps(
  pins: MapPinItem[],
  region: GeoRegion,
  mapWidthDp: number,
): MapPinItem[] {
  if (pins.length < 2 || mapWidthDp <= 0) {
    return pins;
  }
  const cosLat = Math.max(0.2, Math.cos((region.latitude * Math.PI) / 180));
  const metresPerDp = (region.longitudeDelta * METRES_PER_DEGREE_LAT * cosLat) / mapWidthDp;
  const separationM = MARKER_SEPARATION_DP * metresPerDp;
  if (!Number.isFinite(separationM) || separationM <= 0) {
    return pins;
  }

  // Greedy grouping: each pin joins the first group whose centre it would
  // collide with. O(n²) at n <= VIEWPORT_POST_LIMIT is trivial, and greedy
  // keeps it order-stable where a centroid-recentring pass would not.
  const groups: { lat: number; lng: number; members: MapPinItem[] }[] = [];
  for (const pin of pins) {
    const { latitude, longitude } = pin.post;
    const hit = groups.find(
      (g) =>
        distanceMeters({ latitude: g.lat, longitude: g.lng }, { latitude, longitude }) <
        separationM,
    );
    if (hit) {
      hit.members.push(pin);
    } else {
      groups.push({ lat: latitude, lng: longitude, members: [pin] });
    }
  }
  if (groups.every((g) => g.members.length === 1)) {
    return pins; // nothing collides — keep the array identity for the memo
  }

  const fanned = new Map<string, GeoCoord>();
  for (const group of groups) {
    const count = group.members.length;
    if (count === 1) {
      continue;
    }
    // Radius grows with the ring's population so neighbours on it stay a full
    // separation apart: circumference >= count * separation.
    const radiusM = Math.max(separationM * 0.7, (count * separationM) / (2 * Math.PI));
    group.members.forEach((pin, index) => {
      const angle = (index / count) * 2 * Math.PI;
      const dLat = (radiusM * Math.cos(angle)) / METRES_PER_DEGREE_LAT;
      const dLng = (radiusM * Math.sin(angle)) / (METRES_PER_DEGREE_LAT * cosLat);
      fanned.set(pin.key, {
        latitude: group.lat + dLat,
        longitude: group.lng + dLng,
      });
    });
  }
  return pins.map((pin) => {
    const draw = fanned.get(pin.key);
    return draw ? { ...pin, draw } : pin;
  });
}

/**
 * Roughly how wide a marker draws, in points — a £ pill at four digits. Only
 * ever used to keep one off the viewport edge, so an approximation is fine;
 * erring high just nudges a little sooner. A five-digit bounty draws wider and
 * could still lose a point or two at the very edge.
 */
const MARKER_WIDTH_DP = 72;

/**
 * Shift the anchor of any marker close enough to a LEFT or RIGHT viewport edge
 * to be cut in half by it, so the whole marker stays on screen.
 *
 * WHY: a marker is drawn centred on its coordinate, so a car near the edge gets
 * half its pill clipped — and a clipped price reads "£1,3…", which is worse
 * than useless: £1,300 and £13,000 are indistinguishable. Observed on device
 * 2026-08-07. The anchor moves the BOX relative to the point rather than moving
 * the point, so the coordinate the marker is pinned to stays exact.
 *
 * Horizontal only. Vertical clipping is hidden by the top bar and the sheet —
 * chrome the camera already insets for — so the visible failure is sideways.
 */
export function keepMarkersOnScreen(
  pins: MapPinItem[],
  region: GeoRegion,
  mapWidthDp: number,
): MapPinItem[] {
  if (pins.length === 0 || mapWidthDp <= 0 || region.longitudeDelta <= 0) {
    return pins;
  }
  const westEdge = region.longitude - region.longitudeDelta / 2;
  let changed = false;
  const next = pins.map((pin) => {
    const width = MARKER_WIDTH_DP;
    const lng = pin.draw?.longitude ?? pin.post.longitude;
    const x = ((lng - westEdge) / region.longitudeDelta) * mapWidthDp;
    // Default 0.5. Near the west edge the box must start at 0 or later, so the
    // anchor can be at most x/width of the way across it; near the east edge it
    // must END by mapWidthDp, so the anchor is at least 1 - (remaining/width).
    let anchorX = 0.5;
    if (x < width / 2) {
      anchorX = Math.max(0, Math.min(0.5, x / width));
    } else if (x > mapWidthDp - width / 2) {
      anchorX = Math.min(1, Math.max(0.5, 1 - (mapWidthDp - x) / width));
    }
    if (anchorX === 0.5) {
      return pin;
    }
    changed = true;
    return { ...pin, anchor: { x: anchorX, y: 0.5 } };
  });
  // Identity preserved when nothing needed nudging — MapPins is memoised.
  return changed ? next : pins;
}

/**
 * The slice of `pins` to MOUNT right now — the `budget` highest-ranked markers,
 * plus the selected one. The caller grows the budget over a few frames.
 *
 * WHY: nothing thins the marker population any more, so a dense area mounts up
 * to VIEWPORT_POST_LIMIT (100) custom markers in ONE commit, and each one then
 * holds tracksViewChanges open for 500ms while it rasterises. That is the exact
 * Android jank MapPins was written to avoid, and clustering used to hide it by
 * keeping the count small. Staggering the mount staggers those 500ms windows
 * too, which is the part that actually costs frames.
 *
 * BY RANK, so the biggest bounties are in the first commit and the fill-in adds
 * the ones a user is least likely to be reaching for. (This used to withhold
 * only the price-less tier, which stopped meaning anything once every marker
 * became a £ pill — it would have withheld nothing at all.)
 *
 * The SELECTED post is never withheld. The renderer never sees a pin this
 * function drops, so without the guard its selected styling and z-index-3
 * silently do nothing and the card describes a car with no marker under it.
 * Reachable via the pager, not a pin tap: `selectByIndex` walks every result
 * post, not just the drawn ones, so swiping to a neighbour during the reveal
 * can land on one still withheld — and the camera then follows it to an empty
 * patch of map.
 *
 * Returns `pins` ITSELF when nothing is withheld — MapPins is memoised, so a
 * fresh array every tick would re-render every marker and undo the point.
 */
export function revealPins(
  pins: MapPinItem[],
  budget: number,
  selectedPostId: string | null = null,
): MapPinItem[] {
  if (budget >= pins.length) {
    return pins;
  }
  const revealed = pins.filter(
    (pin) => pin.rank < budget || pin.post.id === selectedPostId,
  );
  return revealed.length === pins.length ? pins : revealed;
}
