/**
 * WHAT:  Tests for mapClustering — posts cluster when crowded and zoomed
 *        out, resolve to individual pins zoomed in, and cluster member
 *        lookup returns the right coordinates. Uses the REAL supercluster
 *        (pure JS) — no mocks.
 * WHY:   The map draws exactly what this layer says; a broken zoom mapping
 *        would show one giant cluster forever or a thousand overlapping
 *        pins — both unusable.
 * LINKS: src/features/search-map/lib/mapClustering.ts, docs/TESTING.md.
 */

import type { GeoRegion } from '@/shared/types';

import type { MapPost } from '../types';
import {
  buildClusterIndex,
  clusterMemberCoords,
  clusterMemberPosts,
  pinsForRegion,
} from './mapClustering';

const post = (id: string, latitude: number, longitude: number): MapPost => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 15000,
  latitude,
  longitude,
});

// Two tight groups ~25km apart in Hertfordshire.
const ST_ALBANS = [
  post('a1', 51.752, -0.339),
  post('a2', 51.753, -0.338),
  post('a3', 51.751, -0.34),
];
const LUTON = [post('l1', 51.878, -0.42), post('l2', 51.879, -0.418)];

const wideRegion: GeoRegion = {
  latitude: 51.8,
  longitude: -0.37,
  latitudeDelta: 1.5,
  longitudeDelta: 1.5,
};
const tightStAlbans: GeoRegion = {
  latitude: 51.752,
  longitude: -0.339,
  latitudeDelta: 0.005,
  longitudeDelta: 0.005,
};

describe('pinsForRegion', () => {
  it('clusters crowded posts when zoomed out', () => {
    const index = buildClusterIndex([...ST_ALBANS, ...LUTON]);
    const pins = pinsForRegion(index, wideRegion);

    const clusters = pins.filter((p) => p.type === 'cluster');
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    // Every post is accounted for: pins + summed cluster counts.
    const pinCount = pins.filter((p) => p.type === 'post').length;
    const clustered = clusters.reduce((sum, c) => sum + (c.type === 'cluster' ? c.count : 0), 0);
    expect(pinCount + clustered).toBe(5);
  });

  it('resolves to individual pins when zoomed in', () => {
    const index = buildClusterIndex([...ST_ALBANS, ...LUTON]);
    const pins = pinsForRegion(index, tightStAlbans);

    const posts = pins.filter((p) => p.type === 'post');
    expect(posts.length).toBe(3); // the St Albans three, no clusters here
    expect(pins.some((p) => p.type === 'cluster')).toBe(false);
  });

  it('gives every pin a stable unique key', () => {
    const index = buildClusterIndex([...ST_ALBANS, ...LUTON]);
    const keys = pinsForRegion(index, wideRegion).map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('clusterMemberCoords', () => {
  it('returns the member coordinates of a tapped cluster', () => {
    const index = buildClusterIndex([...ST_ALBANS, ...LUTON]);
    const cluster = pinsForRegion(index, wideRegion).find((p) => p.type === 'cluster');
    expect(cluster).toBeDefined();
    if (cluster?.type !== 'cluster') throw new Error('unreachable');

    const coords = clusterMemberCoords(index, cluster.clusterId);
    expect(coords.length).toBe(cluster.count);
    for (const c of coords) {
      expect(c.latitude).toBeGreaterThan(51.7);
      expect(c.longitude).toBeLessThan(-0.3);
    }
  });
});

describe('clusterMemberPosts', () => {
  it('returns exactly the tapped cluster’s posts — the pager scope', () => {
    const index = buildClusterIndex([...ST_ALBANS, ...LUTON]);
    // Zoomed to St Albans' area only, but wide enough that its trio clusters.
    const stAlbansArea: GeoRegion = {
      latitude: 51.752,
      longitude: -0.339,
      latitudeDelta: 0.3,
      longitudeDelta: 0.3,
    };
    // Luton's pair may cluster too — pick the St Albans trio by count.
    const cluster = pinsForRegion(index, stAlbansArea).find(
      (p) => p.type === 'cluster' && p.count === 3,
    );
    expect(cluster).toBeDefined();
    if (cluster?.type !== 'cluster') throw new Error('unreachable');

    const members = clusterMemberPosts(index, cluster.clusterId);
    expect(members.map((m) => m.id).sort()).toEqual(['a1', 'a2', 'a3']);
    // Full posts, not stubs — the pager renders these directly.
    expect(members[0].plate).toBe('AB12 CDE');
  });
});
