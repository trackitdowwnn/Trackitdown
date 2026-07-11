/**
 * WHAT:  Route for the map-search surface (v1: a stub). Pushed from the home
 *        feed's search pill, Map pill, and "See all →" links with optional
 *        { area?, query? } params.
 * WHY:   Thin wrapper per ARCHITECTURE.md — screens live in features.
 * LINKS: src/features/search-map/screens/MapSearchScreen.tsx.
 */

import { MapSearchScreen } from '@/features/search-map';

export default function SearchMapRoute() {
  return <MapSearchScreen />;
}
