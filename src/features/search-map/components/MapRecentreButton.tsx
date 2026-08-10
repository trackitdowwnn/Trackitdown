/**
 * WHAT:  MapRecentreButton — the map's "show me where I am" control. Flies
 *        the camera to the device's position, asking for permission only if
 *        the user presses it.
 * WHY:   Once you have panned away there was previously no way back to your
 *        own area except leaving the screen and re-entering it. Every map the
 *        user has ever used has this control; its absence reads as a bug.
 *
 *        NEVER COLD-FIRES THE OS DIALOG. The prompt is only ever raised from
 *        inside onPress — the user has just tapped a button whose whole
 *        meaning is "use my location", which is the same sanctioned in-flow
 *        ask the feed's location primer makes. The status is read silently on
 *        mount so the button can render correctly without asking anything.
 *
 *        Uses feedDeviceLocation, NOT shared/lib's expoLocationServices: that
 *        adapter's getCurrentPosition calls requestForegroundPermissionsAsync
 *        and would prompt as a side effect of merely reading a position. This
 *        one is silent-guarded and falls back to the last known fix.
 * LINKS: src/features/permissions (useDevicePermission — live status +
 *        request); src/features/search-map/lib/feedDeviceLocation.ts (the
 *        silent fix); src/features/search-map/screens/MapSearchScreen.tsx.
 */

import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, Linking } from 'react-native';

import { useDevicePermission } from '@/features/permissions';
import { usePalette } from '@/shared/theme';
import type { GeoCoord } from '@/shared/types';
import { useToast } from '@/shared/ui';

import { expoFeedDeviceLocation } from '../lib/feedDeviceLocation';
import { MapCircleButton } from './MapCircleButton';

export interface MapRecentreButtonProps {
  /** Fly the camera here. Only ever called with a real fix. */
  onLocate: (coord: GeoCoord) => void;
}

export const MapRecentreButton = memo(function MapRecentreButton({
  onLocate,
}: MapRecentreButtonProps) {
  const palette = usePalette();
  const toast = useToast();
  const permission = useDevicePermission('location');
  const [locating, setLocating] = useState(false);

  const findAndFly = useCallback(async () => {
    setLocating(true);
    try {
      const coord = await expoFeedDeviceLocation.getCurrentPosition();
      if (coord) {
        onLocate(coord);
      } else {
        // Granted but no fix — indoors, airplane mode, a cold GPS.
        toast.show("Couldn't find your location.", 'error');
      }
    } finally {
      setLocating(false);
    }
  }, [onLocate, toast]);

  const onPress = useCallback(() => {
    if (locating) {
      return;
    }
    const state = permission.status?.state;

    if (state === 'granted') {
      void findAndFly();
      return;
    }

    // Turned off for good: the OS shows nothing for a repeat request, so
    // asking again would look like a dead button. Send them where it CAN be
    // changed instead.
    if (state === 'denied' && !permission.status?.canAskAgain) {
      toast.show('Location is off for Trackitdown.', 'error', {
        label: 'Open settings',
        onPress: () => void Linking.openSettings(),
      });
      return;
    }

    // Undetermined, or denied-but-askable: THE sanctioned prompt. They
    // pressed a button that means "use my location".
    void permission.request().then((next) => {
      if (next.state === 'granted') {
        void findAndFly();
      }
      // A fresh "don't allow" needs no toast — they just chose it.
    });
  }, [locating, permission, findAndFly, toast]);

  // Nothing to offer: no native module, or the first silent check hasn't
  // landed. Rendering nothing beats flashing a button that then disappears —
  // and because this sits in its own absolute layer rather than the top-bar
  // row, appearing later never reflows the search pill.
  if (permission.status === null || permission.status.state === 'unavailable') {
    return null;
  }

  return (
    <MapCircleButton
      icon="navigation"
      accessibilityLabel="Show my location"
      busy={locating}
      onPress={onPress}
      testID="map-recentre"
    >
      {locating ? <ActivityIndicator size="small" color={palette.textPrimary} /> : undefined}
    </MapCircleButton>
  );
});
