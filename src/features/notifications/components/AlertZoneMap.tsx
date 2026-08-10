/**
 * WHAT:  The map surface for the alert-settings screen — AppMap with the
 *        user's zone drawn as a translucent circle that scales live with the
 *        radius slider.
 * WHY:   This is the payoff visual: "this is the area you're watching". The
 *        circle is centred on the map's CURRENT centre, which is exactly where
 *        LocationPicker pins the location, so panning moves the zone with the
 *        pin and dragging the slider grows it in place.
 *
 *        The radius arrives through CONTEXT rather than a prop, because
 *        LocationPicker takes a component TYPE (`MapComponent`). An inline
 *        arrow closing over the radius would be a new type on every change,
 *        and React would unmount and remount the entire native map each time
 *        the slider moved. A module-level component reading context keeps the
 *        type stable and still re-renders.
 *
 *        THE MAP NOW AUTO-ZOOMS TO FIT THE CIRCLE, reversing a limitation this
 *        header used to record. It is done by LocationPicker's `fitRadiusMiles`
 *        prop, NOT here: the picker owns the region, and this component only
 *        receives it. The old objection — that re-fitting fights the user's pan
 *        — was answered rather than avoided: re-framing follows the map's
 *        CURRENT centre, so a pan is preserved, and only the span is overridden.
 *        Losing a manual pinch is the accepted cost of the circle always
 *        meaning the same thing on screen.
 *
 *        The circle is inset from the viewport edge by the picker's
 *        CIRCLE_FIT_PADDING. Without it the fill would touch the frame at every
 *        radius and read as overflowing rather than as a measured area.
 * LINKS: src/shared/ui/AppMap.tsx (AppMapCircle), src/shared/ui/LocationPicker.tsx
 *        (MapComponentProps + fitRadiusMiles);
 *        src/shared/lib/mapRegion.ts (the radius → viewport maths);
 *        src/shared/theme/colors.ts (mapZoneFill / mapZoneStroke).
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { AppMap, AppMapCircle } from '@/shared/ui/AppMap';
import type { MapComponentProps } from '@/shared/ui/LocationPicker';
import { usePalette } from '@/shared/theme';

interface AlertZoneMapValue {
  radiusMetres: number;
  /** Paused zone: the circle stays (the area is still theirs) but recedes. */
  dimmed: boolean;
}

const AlertZoneMapContext = createContext<AlertZoneMapValue>({
  radiusMetres: 0,
  dimmed: false,
});

export function AlertZoneMapProvider({
  radiusMetres,
  dimmed,
  children,
}: AlertZoneMapValue & { children: ReactNode }) {
  const value = useMemo(() => ({ radiusMetres, dimmed }), [radiusMetres, dimmed]);
  return <AlertZoneMapContext.Provider value={value}>{children}</AlertZoneMapContext.Provider>;
}

/**
 * Drop-in for LocationPicker's `MapComponent` slot. Module-level so its
 * identity never changes — see the header.
 */
export function AlertZoneMap(props: MapComponentProps) {
  const { radiusMetres, dimmed } = useContext(AlertZoneMapContext);
  const palette = usePalette();
  return (
    <AppMap {...props}>
      {radiusMetres > 0 ? (
        <AppMapCircle
          // The picker's pin sits at the map centre, so the zone follows it.
          center={{ latitude: props.region.latitude, longitude: props.region.longitude }}
          radius={radiusMetres}
          fillColor={dimmed ? 'transparent' : palette.mapZoneFill}
          strokeColor={palette.mapZoneStroke}
          strokeWidth={1}
        />
      ) : null}
    </AppMap>
  );
}
