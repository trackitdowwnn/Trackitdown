/**
 * WHAT:  Clustering for the search map — a thin, typed wrapper around
 *        supercluster: build an index from the viewport's posts, ask it
 *        what to draw (pins vs cluster bubbles) for a region, and get a
 *        cluster's member coordinates for zoom-to-fit on tap.
 * WHY:   Pins crowd fast in dense areas; supercluster is the standard
 *        Airbnb-style answer and is pure JS, so this whole layer is unit-
 *        testable without a map. The wrapper exists so screen code never
 *        touches GeoJSON — it speaks MapPost/MapPinItem only.
 * LINKS: src/features/search-map/types.ts (MapPinItem);
 *        src/features/search-map/lib/regionMath.ts (regionZoom);
 *        https://github.com/mapbox/supercluster.
 */

import Supercluster from 'supercluster';

import type { GeoCoord, GeoRegion } from '@/shared/types';

import type { MapPinItem, MapPost } from '../types';
import { regionToBbox, regionZoom } from './regionMath';

/** Cluster reach in screen pixels; supercluster's sane default territory. */
const CLUSTER_RADIUS_PX = 60;
/** Beyond this zoom everything renders as individual pins. */
const CLUSTER_MAX_ZOOM = 16;

type PostFeature = Supercluster.PointFeature<{ post: MapPost }>;

export type ClusterIndex = Supercluster<{ post: MapPost }>;

/** Build the index once per result set — cheap for ≤100 posts. */
export function buildClusterIndex(posts: MapPost[]): ClusterIndex {
  const index: ClusterIndex = new Supercluster({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM,
  });
  index.load(
    posts.map(
      (post): PostFeature => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [post.longitude, post.latitude] },
        properties: { post },
      }),
    ),
  );
  return index;
}

/** What to draw for the current region: bounty pins and cluster bubbles. */
export function pinsForRegion(index: ClusterIndex, region: GeoRegion): MapPinItem[] {
  const bbox = regionToBbox(region);
  const clusters = index.getClusters(
    [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat],
    regionZoom(region),
  );
  return clusters.map((feature): MapPinItem => {
    const [longitude, latitude] = feature.geometry.coordinates;
    if (feature.properties && 'cluster' in feature.properties && feature.properties.cluster) {
      const clusterId = feature.properties.cluster_id as number;
      return {
        type: 'cluster',
        key: `cluster_${clusterId}`,
        clusterId,
        count: feature.properties.point_count as number,
        latitude,
        longitude,
      };
    }
    const post = (feature.properties as { post: MapPost }).post;
    return { type: 'post', key: post.id, post };
  });
}

/** Member coordinates of a cluster — feeds frameCoords for zoom-to-fit. */
export function clusterMemberCoords(index: ClusterIndex, clusterId: number): GeoCoord[] {
  return index
    .getLeaves(clusterId, Infinity)
    .map((leaf) => ({
      latitude: leaf.geometry.coordinates[1],
      longitude: leaf.geometry.coordinates[0],
    }));
}
