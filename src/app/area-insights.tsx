/**
 * WHAT:  Route for the theft-stats screen, reached from a feed section's
 *        stats button. Carries the section's scope as params: `area` (a named
 *        town — "Recently stolen in St Albans") OR `lat`/`lng`/`radiusMiles`
 *        (the feed's own circle — Near you) plus `label`, the feed area's
 *        human name, so the page can be titled "Thefts near St Albans". With
 *        none of these, the screen falls back to the device's default centre,
 *        so an old deep link still works.
 * WHY:   The stats used to be one whole-feed row with nothing to say about
 *        WHICH area; per-section entry (2026-09-21) means the screen has to
 *        be told, and route params are how a push tells a screen anything.
 *        Numbers are parsed here so the screen takes typed props, and a
 *        malformed number reads as absent rather than as NaN downstream.
 * LINKS: src/features/search-map/screens/AreaInsightsScreen.tsx;
 *        src/features/search-map/screens/HomeFeedScreen.tsx (openStats).
 */

import { useLocalSearchParams } from 'expo-router';

import { AreaInsightsScreen } from '@/features/search-map';

function numberParam(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function AreaInsightsRoute() {
  const { area, label, lat, lng, radiusMiles } = useLocalSearchParams<{
    area?: string;
    label?: string;
    lat?: string;
    lng?: string;
    radiusMiles?: string;
  }>();
  return (
    <AreaInsightsScreen
      area={area || undefined}
      label={label || undefined}
      lat={numberParam(lat)}
      lng={numberParam(lng)}
      radiusMiles={numberParam(radiusMiles)}
    />
  );
}
