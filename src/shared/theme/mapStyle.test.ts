/**
 * WHAT:  Tests for mapStyleFor — that the dark basemap is the one the dark
 *        scheme gets, that the two arrays stay structurally identical, and that
 *        the dark canvas is actually darker than the overlays drawn on it.
 * WHY:   The dark basemap shipped WRITTEN BUT NEVER WIRED: `mapStyleFor` had no
 *        caller and AppMap still hardcoded the light array. Nothing failed —
 *        not typecheck, not lint, not 2101 tests — because an unused export is
 *        perfectly valid code. What it produced was near-white overlays on a
 *        near-white map at ~1:1: the selected pin, the sighting trail, and the
 *        alert-zone circle all invisible, which for the zone means a spotter
 *        setting a radius with no visible radius.
 *
 *        That is the failure this file exists to make loud. The basemap and the
 *        overlays drawn on it are ONE decision, and a test is the only thing
 *        that notices when half of it goes missing.
 * LINKS: src/shared/theme/mapStyle.ts; src/shared/ui/AppMap.tsx (the caller);
 *        src/features/notifications/components/AlertZoneMap.tsx and
 *        src/features/search-map/components/MapPins.tsx (the overlays).
 */

import { darkColors, colors } from './colors';
import { mapStyle, mapStyleDark, mapStyleFor } from './mapStyle';

/**
 * The land colour — the `{ elementType: 'geometry' }` entry every style opens
 * with.
 *
 * Typed loosely on purpose: both arrays are `as const`, so their stylers are
 * readonly tuples of DIFFERENT shapes (`{color}` here, `{visibility}` there) and
 * no single precise signature accepts both. The narrowing happens at the
 * property read instead.
 */
function landColour(style: readonly Record<string, unknown>[]): string | undefined {
  const geometry = style.find((rule) => rule.elementType === 'geometry' && !('featureType' in rule));
  const stylers = geometry?.stylers as { color?: string }[] | undefined;
  return stylers?.[0]?.color;
}

function luminance(hex: string): number {
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

describe('mapStyleFor', () => {
  it('gives the dark scheme the dark basemap', () => {
    expect(mapStyleFor('dark')).toBe(mapStyleDark);
    expect(mapStyleFor('light')).toBe(mapStyle);
  });
});

describe('the two basemaps', () => {
  it('describe the same features in the same order', () => {
    // A structural twin, not a re-design: if one array gains a rule the other
    // must too, or the schemes disagree about what a map even shows.
    const shape = (style: readonly Record<string, unknown>[]) =>
      style.map((rule) => `${rule.featureType ?? '*'}|${rule.elementType ?? '*'}`);

    expect(shape(mapStyleDark)).toEqual(shape(mapStyle));
  });

  it('keep every visibility rule identical', () => {
    // The suppressed clutter (POI, transit, arterial/local road labels, water
    // labels) is a product decision — "calm, never a busy crime map" — not a
    // colour one, so it must not drift between schemes.
    const visibility = (style: readonly Record<string, unknown>[]) =>
      JSON.stringify(
        style.map((rule) =>
          (rule.stylers as { visibility?: string }[] | undefined)?.map((s) => s.visibility ?? null),
        ),
      );

    expect(visibility(mapStyleDark)).toEqual(visibility(mapStyle));
  });
});

describe('the dark canvas versus the overlays drawn on it', () => {
  it('is darker than the near-white ink the overlays invert to', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. `surfaceInverse` (map pins) and
    // `primary` (the sighting trail) invert to near-white in dark mode
    // precisely because the land beneath them is meant to be dark. Assert the
    // premise rather than the wiring: if the dark land ever drifts light, the
    // overlays vanish and no other test notices.
    const land = landColour(mapStyleDark);
    expect(land).toBeDefined();

    const landLuminance = luminance(land as string);
    expect(landLuminance).toBeLessThan(luminance(darkColors.surfaceInverse));
    expect(landLuminance).toBeLessThan(luminance(darkColors.primary));
  });

  it('sits BELOW the card surface, so pills drawn on it still lift', () => {
    // The half the first version of this file missed. It asserted the land was
    // darker than `surfaceInverse`/`primary` — which only covers the SELECTED
    // pin. Every UNSELECTED pin and every floating map control is painted with
    // `surface`, and the land was originally LIGHTER than that: the pill
    // measured 1.22:1 against its own canvas, inverting the page's
    // background < surface ladder on the one surface that can't rely on shadow.
    expect(luminance(landColour(mapStyleDark) as string)).toBeLessThan(
      luminance(darkColors.surface),
    );
  });

  it('gives floating map chrome an edge that clears the 3:1 graphic floor', () => {
    // The pill barely separates from the land by FILL in either theme, so the
    // hairline IS the pill. `shadows` casts a literal black and contributes
    // nothing on dark tiles, which is why this has to hold on its own.
    const land = landColour(mapStyleDark) as string;
    const hi = Math.max(luminance(darkColors.borderStrong), luminance(land));
    const lo = Math.min(luminance(darkColors.borderStrong), luminance(land));

    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(3);
  });

  it('inverts relative to the light canvas, which is lighter than ITS ink', () => {
    // The mirror image, so the pairing is asserted in both schemes rather than
    // only the new one.
    const land = landColour(mapStyle);
    expect(luminance(land as string)).toBeGreaterThan(luminance(colors.surfaceInverse));
    expect(luminance(land as string)).toBeGreaterThan(luminance(colors.primary));
  });
});
