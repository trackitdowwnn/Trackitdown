/**
 * WHAT:  Tests for collectionsModel — which tiles appear, in what order, and
 *        with what count and cover.
 * WHY:   The "Saved" rules are the whole zero-migration story: every watch made
 *        before collections existed is null, so getting the show/hide wrong
 *        either strands someone's entire watchlist behind no tile at all, or
 *        leaves an empty junk drawer next to the lists they actually made.
 *        The count is asserted against the same entries the collection screen
 *        renders — a tile promising 12 that opens onto 9 is exactly the kind of
 *        small lie this model exists to prevent.
 * LINKS: src/features/watchlist/lib/collectionsModel.ts; docs/TESTING.md.
 */

import type { PostSummary } from '@/shared/types';

import type { WatchedPost, WatchedTombstone, WatchlistCollection } from '../types';

import {
  SAVED_ROUTE_ID,
  buildCollectionTiles,
  collectionIdFromRoute,
  entriesInCollection,
} from './collectionsModel';

const COMMUTE: WatchlistCollection = {
  id: 'cccccccc-0000-0000-0000-00000000000c',
  name: 'My commute',
  createdAt: '2026-07-01T10:00:00Z',
};
const NEAR_WORK: WatchlistCollection = {
  id: 'dddddddd-0000-0000-0000-00000000000d',
  name: 'Near work',
  createdAt: '2026-07-02T10:00:00Z',
};

function post(id: string, collectionId: string | null, photo: string | null): WatchedPost {
  return {
    kind: 'post',
    watchedAt: '2026-07-21T10:00:00Z',
    collectionId,
    post: {
      id,
      photos: photo ? [{ uri: photo }] : [],
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      plate: 'AB12 CDE',
      status: 'active',
      lastSeenAt: '2026-07-20T10:00:00Z',
      bountyPence: 50000,
    } as PostSummary,
  };
}

function tombstone(id: string, collectionId: string | null, thumb: string | null): WatchedTombstone {
  return {
    kind: 'tombstone',
    watchedAt: '2026-07-01T10:00:00Z',
    collectionId,
    postId: id,
    status: 'expired',
    make: 'Ford',
    model: 'Focus',
    colour: 'Red',
    resolvedAt: '2026-07-22T10:00:00Z',
    thumbnailUrl: thumb,
  };
}

describe('the Saved bucket', () => {
  it('holds everything on a first launch, with no lists and no migration', () => {
    // Every watch made before collections existed is null. This is the case
    // that must work with zero backfill.
    const tiles = buildCollectionTiles([post('p1', null, null), post('p2', null, null)], []);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ id: null, routeId: SAVED_ROUTE_ID, name: 'Saved', count: 2 });
  });

  it('shows even when empty if the user has no named lists', () => {
    // Otherwise the tab would render nothing at all for someone mid-way
    // through removing their last save.
    const tiles = buildCollectionTiles([], []);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.count).toBe(0);
  });

  it('hides once it is empty and a named list exists', () => {
    const tiles = buildCollectionTiles([post('p1', COMMUTE.id, null)], [COMMUTE]);

    expect(tiles.map((t) => t.name)).toEqual(['My commute']);
  });

  it('reappears as soon as something is filed back into it', () => {
    const tiles = buildCollectionTiles(
      [post('p1', COMMUTE.id, null), post('p2', null, null)],
      [COMMUTE],
    );

    expect(tiles.map((t) => t.name)).toEqual(['Saved', 'My commute']);
  });

  it('can never be renamed or deleted', () => {
    const [savedTile] = buildCollectionTiles([post('p1', null, null)], []);

    expect(savedTile?.editable).toBe(false);
  });
});

describe('named lists', () => {
  it('shows an empty list rather than hiding a deliberate creation', () => {
    // Hiding it would read as "the create silently failed".
    const tiles = buildCollectionTiles([], [COMMUTE]);

    expect(tiles.map((t) => t.name)).toEqual(['My commute']);
    expect(tiles[0]?.count).toBe(0);
  });

  it('keeps the order the API returned, after Saved', () => {
    const tiles = buildCollectionTiles([post('p1', null, null)], [COMMUTE, NEAR_WORK]);

    expect(tiles.map((t) => t.name)).toEqual(['Saved', 'My commute', 'Near work']);
  });

  it('routes by uuid, and is editable', () => {
    const tiles = buildCollectionTiles([], [COMMUTE]);

    expect(tiles[0]).toMatchObject({ id: COMMUTE.id, routeId: COMMUTE.id, editable: true });
  });
});

describe('counts and covers', () => {
  it('counts exactly what opening the tile will show', () => {
    const entries = [
      post('p1', COMMUTE.id, null),
      tombstone('p2', COMMUTE.id, null),
      post('p3', null, null),
    ];

    const [tile] = buildCollectionTiles(entries, [COMMUTE]).filter((t) => t.id === COMMUTE.id);

    // Tombstones are rendered by the collection screen under "No longer
    // active", so they count — the tile must not promise 1 and open onto 2.
    expect(tile?.count).toBe(2);
    expect(entriesInCollection(entries, COMMUTE.id)).toHaveLength(2);
  });

  it('takes the first available photo as the cover', () => {
    const tiles = buildCollectionTiles(
      [post('p1', null, null), post('p2', null, 'https://x/photo.jpg')],
      [],
    );

    // Skips the photoless entry rather than showing a blank cover when the
    // list does contain a picture.
    expect(tiles[0]?.coverUrl).toBe('https://x/photo.jpg');
  });

  it('falls back to a tombstone thumbnail', () => {
    const tiles = buildCollectionTiles([tombstone('p1', null, 'https://x/thumb.jpg')], []);

    expect(tiles[0]?.coverUrl).toBe('https://x/thumb.jpg');
  });

  it('reports no cover rather than an empty string', () => {
    // The screen branches on null to draw a designed placeholder; an empty
    // string would be passed to the image loader as a URL.
    const tiles = buildCollectionTiles([post('p1', null, null)], []);

    expect(tiles[0]?.coverUrl).toBeNull();
  });
});

describe('route params', () => {
  it('maps the Saved sentinel back to null', () => {
    expect(collectionIdFromRoute(SAVED_ROUTE_ID)).toBeNull();
  });

  it('passes a uuid through', () => {
    expect(collectionIdFromRoute(COMMUTE.id)).toBe(COMMUTE.id);
  });

  it('treats a missing param as Saved', () => {
    expect(collectionIdFromRoute(undefined)).toBeNull();
  });
});
