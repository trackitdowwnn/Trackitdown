/**
 * WHAT:  Barrel for cross-feature domain types.
 * WHY:   Features import from '@/shared/types' (one path) rather than
 *        reaching into individual files, matching the other shared barrels.
 * LINKS: docs/ARCHITECTURE.md (shared/types).
 */

export type {
  ForwardGeocodeResult,
  GeoCoord,
  GeoRegion,
  LocationServices,
  LocationValue,
} from './location';
export type { PostPhoto, PostStatus, PostSummary } from './posts';
