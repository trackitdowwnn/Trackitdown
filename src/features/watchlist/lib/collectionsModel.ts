/**
 * WHAT:  collectionsModel — turns one watchlist payload plus the caller's list
 *        names into the tiles the grid renders: the implicit "Saved" bucket
 *        first, then each named list, each with a count and a cover.
 * WHY:   Pure, so the rules that decide what a user sees on the Watchlist tab
 *        can be tested without a renderer (house habit — cf. appTabBarModel,
 *        garageNudgeRules). Counts and covers are derived from the SAME entries
 *        the collection screen will render, never from a separate count: a tile
 *        promising 12 cars that opens onto 9 is the kind of small lie that
 *        makes people stop trusting a list.
 * LINKS: src/features/watchlist/screens/CollectionsGridScreen.tsx;
 *        src/features/watchlist/types.ts (why "Saved" is not a row).
 */

import type { CollectionId, WatchlistCollection, WatchlistEntry } from '../types';

/**
 * Route param standing in for the implicit bucket. A uuid can never equal this
 * string, so `/collection/saved` is unambiguous.
 */
export const SAVED_ROUTE_ID = 'saved';

/** The implicit bucket's label. Not stored anywhere — it has no row. */
export const SAVED_NAME = 'Saved';

export interface CollectionTile {
  /** null for the implicit "Saved" bucket. */
  id: CollectionId;
  /** What to put in the route: a uuid, or SAVED_ROUTE_ID. */
  routeId: string;
  name: string;
  count: number;
  /** First available photo among the tile's entries; null renders a placeholder. */
  coverUrl: string | null;
  /** The implicit bucket can't be renamed or deleted — it isn't a row. */
  editable: boolean;
}

function coverOf(entry: WatchlistEntry): string | null {
  return entry.kind === 'tombstone' ? entry.thumbnailUrl : (entry.post.photos[0]?.uri ?? null);
}

/** The entries filed in one collection, in the payload's order (newest first). */
export function entriesInCollection(
  entries: WatchlistEntry[],
  collectionId: CollectionId,
): WatchlistEntry[] {
  return entries.filter((entry) => entry.collectionId === collectionId);
}

/**
 * Build the grid.
 *
 * "Saved" is shown when it holds something, OR when there are no named lists at
 * all — the second case is what makes this work with zero migration: every
 * watch made before collections existed is null, so on first launch everyone
 * sees exactly one tile holding everything they already had.
 *
 * It is hidden only when it is empty AND a named list exists: nobody should
 * stare at an empty junk drawer next to the lists they actually made.
 */
export function buildCollectionTiles(
  entries: WatchlistEntry[],
  collections: WatchlistCollection[],
): CollectionTile[] {
  const tiles: CollectionTile[] = [];

  const saved = entriesInCollection(entries, null);
  if (saved.length > 0 || collections.length === 0) {
    tiles.push({
      id: null,
      routeId: SAVED_ROUTE_ID,
      name: SAVED_NAME,
      count: saved.length,
      coverUrl: saved.map(coverOf).find((url) => url !== null) ?? null,
      editable: false,
    });
  }

  for (const collection of collections) {
    const mine = entriesInCollection(entries, collection.id);
    tiles.push({
      id: collection.id,
      routeId: collection.id,
      name: collection.name,
      count: mine.length,
      coverUrl: mine.map(coverOf).find((url) => url !== null) ?? null,
      // An empty named list still shows — the user made it deliberately, and
      // hiding it would look like the create silently failed.
      editable: true,
    });
  }

  return tiles;
}

/** Resolve a route param back to a collection id. Unknown ids fall to Saved. */
export function collectionIdFromRoute(routeId: string | undefined): CollectionId {
  return routeId === undefined || routeId === SAVED_ROUTE_ID ? null : routeId;
}
