/**
 * WHAT:  What the search map draws: the posts inside the current viewport,
 *        ranked so only the top few bounties carry a £ pill and the rest come
 *        back as mini-pins (the same lozenge, price hidden).
 * WHY:   Two jobs that must stay together, because both need the same thing —
 *        the exact set of posts about to be drawn:
 *          1. CULLING to the viewport. `result.posts` only refreshes when a
 *             search LANDS, which is ~600ms behind the gesture, so without this
 *             a pan would keep drawing markers that are no longer on screen.
 *          2. RANKING. Which posts earn a price depends on who else is in view,
 *             so it cannot be decided per-marker inside the renderer.
 *
 *        Was mapClustering.ts (a supercluster wrapper) until 2026-08-06.
 *        Clustering was removed on the owner's call — every car in the area now
 *        gets its own marker, and the pill/mini split does the de-cluttering a
 *        cluster bubble used to. Kept pure so it stays unit-testable without a
 *        map view.
 * LINKS: src/features/search-map/types.ts (MapPinItem);
 *        src/features/search-map/components/MapPins.tsx (the dumb renderer);
 *        src/features/search-map/lib/regionMath.ts (regionToBbox).
 */

import type { GeoRegion } from '@/shared/types';

import type { MapPinItem, MapPost } from '../types';
import { regionToBbox } from './regionMath';

/**
 * The CEILING on how many in-view posts keep a full £ pill. The rest render as
 * mini-pins — the same lozenge with the price hidden.
 *
 * WHY: a wall of price tags is unreadable, and the reference (Airbnb) demotes
 * all but its top-ranked listings for exactly this reason — the user only ever
 * taps a handful, so a crowded map means those taps miss the best options.
 * Twelve because a pill is ~64x26pt and the map band left by the top bar and
 * the resting sheet is ~390x640: twelve pills is ~8% ink, and past roughly 10%
 * it stops reading as a map.
 */
export const MAX_PRICE_PINS = 12;

/**
 * The share of visible posts that may carry a price, between the floor and the
 * ceiling. ~15% is roughly the reference's own ratio (it prices 30-50 of 200+).
 *
 * The ceiling alone was chosen when supercluster still thinned dense areas. It
 * doesn't any more, so a flat 12 priced a third of a 36-post view and every
 * single post of a 12-post one — a wall of price tags in exactly the middle
 * band where the map is most useful.
 */
const PRICED_SHARE = 0.15;

/**
 * ...but never fewer than this. A share alone would price ONE post out of four,
 * which is mean rather than calm: four markers cost ~3% ink whatever they are,
 * so there is nothing to save by hiding three prices. The floor is what keeps
 * a quiet area readable instead of coy.
 */
const MIN_PRICED_PINS = 4;

/**
 * The markers to draw for `region`: every post inside it, the top
 * `maxPricePins` by bounty marked `'full'` and the rest `'mini'`.
 *
 * The tie-break on id is not decoration: the server's ordering varies between
 * searches, so an unstable sort would flip a post between pill and mini on
 * identical data as the user pans. Same rule, same reason, as the screen's
 * `sortedPosts`.
 */
export function pinsForRegion(
  posts: MapPost[],
  region: GeoRegion,
  maxPricePins: number = MAX_PRICE_PINS,
): MapPinItem[] {
  const bbox = regionToBbox(region);
  const inView = posts.filter(
    (post) =>
      post.latitude >= bbox.minLat &&
      post.latitude <= bbox.maxLat &&
      post.longitude >= bbox.minLng &&
      post.longitude <= bbox.maxLng,
  );

  // Decided across the whole in-view set before anything is mapped — this
  // function is the only place that knows the exact population being drawn.
  // Floor, then share, then ceiling: 4 posts price all four, 30 price five,
  // 100 price twelve. Slicing past the end is harmless, so the floor never
  // over-prices a tiny set.
  const pricedCount = Math.min(
    maxPricePins,
    Math.max(MIN_PRICED_PINS, Math.ceil(inView.length * PRICED_SHARE)),
  );
  const priced = new Set(
    [...inView]
      .sort((a, b) => b.bountyPence - a.bountyPence || a.id.localeCompare(b.id))
      .slice(0, pricedCount)
      .map((post) => post.id),
  );

  return inView.map(
    (post): MapPinItem => ({
      type: 'post',
      key: post.id,
      post,
      emphasis: priced.has(post.id) ? 'full' : 'mini',
    }),
  );
}

/**
 * The slice of `pins` to MOUNT right now — every priced pin, plus `miniBudget`
 * of the demoted ones. The caller grows the budget over a few frames.
 *
 * WHY: nothing thins the marker population any more, so a dense area mounts up
 * to VIEWPORT_POST_LIMIT (100) custom markers in ONE commit, and each one then
 * holds tracksViewChanges open for 500ms while it rasterises. That is the exact
 * Android jank MapPins was written to avoid, and clustering used to hide it by
 * keeping the count small. Staggering the mount staggers those 500ms windows
 * too, which is the part that actually costs frames.
 *
 * Priced pins are NEVER withheld: they are the ranked few worth tapping, and a
 * price that fades in late would read as the map changing its mind.
 *
 * Neither is the SELECTED post, whatever its emphasis. Selection is promoted to
 * a pill downstream in the renderer, which never sees a pin this function drops
 * — so without the guard the promote-to-pill and z-index-3 logic silently does
 * nothing and the card describes a car with no marker under it. Reachable via
 * the pager, not a pin tap: `selectByIndex` walks every result post, not just
 * the drawn ones, so swiping to a neighbour during the reveal can land on one
 * still withheld — and the camera then follows it to an empty patch of map.
 *
 * Returns `pins` ITSELF when nothing is withheld — MapPins is memoised, so a
 * fresh array every tick would re-render every marker and undo the point.
 */
export function revealPins(
  pins: MapPinItem[],
  miniBudget: number,
  selectedPostId: string | null = null,
): MapPinItem[] {
  // Cheap upper bound: the budget only counts minis, so pins.length is a safe
  // over-estimate of what it takes to reveal everything.
  if (miniBudget >= pins.length) {
    return pins;
  }
  let shown = 0;
  const revealed = pins.filter((pin) => {
    if (pin.emphasis === 'full' || pin.post.id === selectedPostId) {
      return true;
    }
    shown += 1;
    return shown <= miniBudget;
  });
  return revealed.length === pins.length ? pins : revealed;
}
