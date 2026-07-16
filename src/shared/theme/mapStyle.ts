/**
 * WHAT:  mapStyle — a custom light Google Maps style array that harmonises the
 *        base map with the app's cool near-white palette (light-grey land,
 *        cool blue-grey water, quiet labels, POI/transit clutter removed).
 * WHY:   DESIGN_SYSTEM.md calls for "a light map style (muted natural tones)",
 *        but the map rendered stock Google colours (bright greens/blues) that
 *        clashed with our surfaces under the on-brand pins. Re-derived to the
 *        Airbnb-orange cool neutrals (ADR-0005) so the canvas matches the rest
 *        of the UI — land = surfaceSubtle, road borders = border, labels =
 *        textSecondary with a near-white halo — and strips POI/transit noise so
 *        the map reads calm (the anti-"Citizen" direction: never busy or alarming).
 *        Colours are hard-coded hex here because the Google Maps style schema
 *        takes raw colour strings, not token refs; keep in sync with colors.ts.
 * LINKS: src/shared/ui/AppMap.tsx (the only consumer, via customMapStyle);
 *        docs/DESIGN_SYSTEM.md (Colour palette; Screen conventions — Map).
 */

/** Google Maps JSON style. Token mirrors (keep in sync with colors.ts):
 *  #EEEEEE surfaceSubtle (land) · #FFFFFF surface (roads) · #DDDDDD border
 *  (road edges) · #6A6A6A textSecondary (labels) · #F7F7F7 background (label
 *  halo) · #E3EAE3 cool green-grey (parks) · #D6DEE2 cool blue-grey (water). */
export const mapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#EEEEEE' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6A6A6A' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F7F7F7' }] },
  // Administrative boundaries: quiet labels, no heavy fills.
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  // POI clutter off — a stolen-car map stays calm and uncluttered.
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#E3EAE3' }, { visibility: 'on' }],
  },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#DDDDDD' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D6DEE2' }] },
  // Water labels off — quiet-label intent, and they'd be low-contrast on water.
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
] as const;
