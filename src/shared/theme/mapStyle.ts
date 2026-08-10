/**
 * WHAT:  mapStyle / mapStyleDark / mapStyleFor — the custom Google Maps style
 *        arrays that harmonise the base map with the app's palette (quiet
 *        labels, POI/transit clutter removed), one per colour scheme, and the
 *        picker that chooses between them.
 *
 *        `mapStyleFor(scheme)` is the ONLY thing components should call. The
 *        dark array shipped once written-but-unwired — AppMap still imported
 *        the light one — and nothing failed: not typecheck, not lint, not 2101
 *        tests, because an unused export is valid code. What it produced was
 *        near-white overlays on a near-white map. See mapStyle.test.ts.
 * WHY:   DESIGN_SYSTEM.md calls for "a light map style (muted natural tones)",
 *        but the map rendered stock Google colours (bright greens/blues) that
 *        clashed with our surfaces under the on-brand pins. Re-derived to the
 *        app's cool neutrals (ADR-0005 / ADR-0006) so the canvas matches the rest
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

/**
 * The DARK twin, structurally identical to the array above — same features,
 * same visibility rules, same "calm canvas" intent — with every colour moved
 * to the dark palette's equivalent role.
 *
 * Token mirrors (keep in sync with darkColors in colors.ts):
 *  #141619 land · #1E2226 roads · #2A2F35 road edges · #9CA2AA labels
 *  (textSecondary role) · #0C0E10 label halo · #18211A parks · #1C242B water.
 *
 * THE LAND IS THE MAP'S PAGE, and it has to be darker than `surface` —
 * originally it was #2A2E33, LIGHTER than the #1E1E1E pills drawn on it, which
 * inverted the whole elevation story: an unselected bounty pill measured
 * 1.22:1 against its own canvas and its hairline 1.08:1, with `shadows` casting
 * a black that contributes nothing on dark tiles. Every floating map control
 * lost its edge at once. At #141619 the map mirrors the page's
 * `background < surface` ladder, and a `borderStrong` hairline on that chrome
 * clears the 3:1 graphic floor at 3.55:1. Pinned by mapStyle.test.ts.
 *
 * The two bespoke hues keep their RELATIONSHIP to the land rather than their
 * values. In light, parks and water sit slightly DARKER than the land (1.06 and
 * 1.17); inverted on a near-black canvas they sit slightly LIGHTER by the same
 * margins (1.10 and 1.15), because there is no room to go darker and a feature
 * you cannot see is not a feature. (An earlier version of this note claimed the
 * light ones were lighter than the land. They are not — check before trusting.)
 *
 * Not derived from tokens at runtime for the same reason as the light array:
 * the Google Maps style schema takes raw colour strings, not token refs.
 */
export const mapStyleDark = [
  { elementType: 'geometry', stylers: [{ color: '#141619' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9CA2AA' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0C0E10' }] },

  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },

  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#18211A' }, { visibility: 'on' }],
  },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1E2226' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2A2F35' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#1C242B' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
] as const;

/** The style array for a scheme — AppMap is the only caller. */
export function mapStyleFor(scheme: 'light' | 'dark') {
  return scheme === 'dark' ? mapStyleDark : mapStyle;
}
