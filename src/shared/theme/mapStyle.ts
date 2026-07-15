/**
 * WHAT:  mapStyle — a custom light Google Maps style array that harmonises the
 *        base map with the app's warm palette (cream land, muted sage-grey
 *        water, quiet labels, POI/transit clutter removed).
 * WHY:   DESIGN_SYSTEM.md calls for "a light map style (muted natural tones)",
 *        but the map rendered stock Google colours (bright greens/blues) that
 *        clashed with the cream surfaces under our on-brand pins (theme audit,
 *        2026-07-15). This ties the canvas to the same tokens the rest of the
 *        UI uses — land = surfaceSubtle, road borders = border, labels =
 *        textSecondary with a cream halo — and strips POI/transit noise so the
 *        map reads calm (the anti-"Citizen" direction: never busy or alarming).
 *        Colours are hard-coded hex here because the Google Maps style schema
 *        takes raw colour strings, not token refs; keep in sync with colors.ts.
 * LINKS: src/shared/ui/AppMap.tsx (the only consumer, via customMapStyle);
 *        docs/DESIGN_SYSTEM.md (Colour palette; Screen conventions — Map).
 */

/** Google Maps JSON style. Token mirrors (keep in sync with colors.ts):
 *  #F3EEE6 surfaceSubtle (land) · #FFFFFF surface (roads) · #E7E0D6 border
 *  (road edges) · #6F6A62 textSecondary (labels) · #FAF7F2 background (label
 *  halo) · #E4E8DA muted sage tint (parks) · #C9D2CE muted sage-grey (water). */
export const mapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#F3EEE6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6F6A62' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FAF7F2' }] },
  // Administrative boundaries: quiet labels, no heavy fills.
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  // POI clutter off — a stolen-car map stays calm and uncluttered.
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#E4E8DA' }, { visibility: 'on' }],
  },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E7E0D6' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#C9D2CE' }] },
  // Water labels off — quiet-label intent, and they'd be low-contrast on water.
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
] as const;
