/**
 * WHAT:  Tests for AppMap's fixed native props — the ones whose absence
 *        cannot be seen in a simulator and was only ever found on device.
 * WHY:   poiClickEnabled defaults to TRUE in react-native-maps' Android code,
 *        and on Google's latest renderer a POI (any map label) wins a tap over
 *        a custom marker. Drop the prop and pills over town or road names
 *        stop answering taps — "inconsistent", with no error anywhere.
 * LINKS: src/shared/ui/AppMap.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { AppMap } from './AppMap';

const mockMapProps = jest.fn();

jest.mock('react-native-maps', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  const MapView = React.forwardRef(function MockMapView(props: Record<string, unknown>, _ref: unknown) {
    mockMapProps(props);
    return null;
  });
  return {
    __esModule: true,
    default: MapView,
    PROVIDER_GOOGLE: 'google',
    Marker: () => null,
    Polyline: () => null,
    Circle: () => null,
  };
});

const REGION = { latitude: 51.75, longitude: -0.34, latitudeDelta: 0.1, longitudeDelta: 0.1 };

describe('AppMap', () => {
  it('⚠️ never registers the POI click listener — labels would steal marker taps', async () => {
    await render(
      <AppMap
        region={REGION}
        animateDurationMs={0}
        onRegionChangeStart={() => {}}
        onRegionChangeComplete={() => {}}
      />,
    );

    expect(mockMapProps).toHaveBeenCalledWith(expect.objectContaining({ poiClickEnabled: false }));
  });

  it('never lets a marker press re-centre the camera', async () => {
    await render(
      <AppMap
        region={REGION}
        animateDurationMs={0}
        onRegionChangeStart={() => {}}
        onRegionChangeComplete={() => {}}
      />,
    );

    expect(mockMapProps).toHaveBeenCalledWith(expect.objectContaining({ moveOnMarkerPress: false }));
  });
});
